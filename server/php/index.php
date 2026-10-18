<?php
/**
 * THE HOUSE KNOWS: room relay in plain PHP, for ordinary web hosting (OVH, etc.). No database, no Node.
 *
 * Same job as server/relay.js: it only passes messages between the phones of one room. The host's phone runs the
 * game. Phones "poll" this file about once a second instead of holding a live connection (shared hosting cannot
 * hold one open), which is plenty for a turn-based quiz.
 *
 * Calls look like  index.php?p=/api/rooms/ABCD/send . State lives in small JSON files under ./data (blocked from the
 * web by data/.htaccess and deleted automatically after a few hours).
 * Access code: config.php returns ['access_hash' => sha256 of the code]; empty = open to everyone.
 */
declare(strict_types=1);

const MAX_PLAYERS = 4;
const MAX_BODY = 524288;
const MAX_SAVE = 4194304;   // cloud save: 4 MB per player key (compressed)
const ROOM_TTL = 10800;      // seconds without activity before a room is swept away
const CONNECTED_WITHIN = 12; // a phone counts as connected if it polled this recently
const LOG_KEEP = 80;
const HOST_ONLY = ['state', 'start', 'end', 'kick', 'lobby'];

$cfg = @include __DIR__ . '/config.php';
$cfg = is_array($cfg) ? $cfg : [];
$ACCESS = strtolower((string) ($cfg['access_hash'] ?? ''));
$DATA = (string) ($cfg['data_dir'] ?? (__DIR__ . '/data'));

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function reply(int $status, array $body) {
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
function clean($s, int $n): string {
    $s = preg_replace('/[\x00-\x1f<>]/u', '', (string) $s) ?? '';
    return mb_substr(trim($s), 0, $n);
}
function rid(int $n = 6): string { return rtrim(strtr(base64_encode(random_bytes($n)), '+/', '-_'), '='); }
function body(int $max = MAX_BODY): array {
    $raw = file_get_contents('php://input', false, null, 0, $max + 1);
    if ($raw === false || $raw === '') return [];
    if (strlen($raw) > $max) reply(413, ['error' => 'too large']);
    $j = json_decode($raw, true);
    if (!is_array($j)) reply(400, ['error' => 'bad json']);
    return $j;
}
function ip(): string { return (string) ($_SERVER['REMOTE_ADDR'] ?? ''); }

if (!is_dir($DATA)) {
    @mkdir($DATA, 0755, true);
}
if (!is_dir($DATA) || !is_writable($DATA)) reply(500, ['error' => 'the server folder is not writable']);
if (!file_exists($DATA . '/.htaccess')) @file_put_contents($DATA . '/.htaccess', "Require all denied\nDeny from all\n");
if (!file_exists($DATA . '/index.html')) @file_put_contents($DATA . '/index.html', '');

/* ---------- access code (with lock-out after repeated wrong tries) ---------- */
function access_ok($supplied): array {
    global $ACCESS, $DATA;
    if ($ACCESS === '') return [true, 200, ''];
    $f = $DATA . '/fails-' . substr(sha1(ip()), 0, 16) . '.json';
    $fails = [];
    if (is_file($f)) { $j = json_decode((string) @file_get_contents($f), true); if (is_array($j)) $fails = $j; }
    $now = time();
    $fails = array_values(array_filter($fails, fn($t) => $now - (int) $t < 600));
    if (count($fails) >= 10) return [false, 429, 'too many wrong codes, try again in 10 minutes'];
    if (hash_equals($ACCESS, hash('sha256', (string) $supplied))) return [true, 200, ''];
    $fails[] = $now;
    @file_put_contents($f, json_encode($fails), LOCK_EX);
    return [false, 401, 'wrong access code'];
}

/* ---------- rooms ---------- */
function room_path(string $code): string { global $DATA; return $DATA . '/room-' . $code . '.json'; }

/** Run $fn(&$room) with the room locked. Returns [found, result]. $fn may return false to skip saving. */
function with_room(string $code, callable $fn): array {
    $path = room_path($code);
    if (!is_file($path)) return [false, null];
    $h = @fopen($path, 'c+');
    if (!$h) return [false, null];
    flock($h, LOCK_EX);
    rewind($h);
    $raw = stream_get_contents($h);
    $room = json_decode($raw ?: '', true);
    if (!is_array($room)) { flock($h, LOCK_UN); fclose($h); return [false, null]; }
    $dirty = true;
    $res = $fn($room, $dirty);
    if ($dirty) {
        rewind($h);
        ftruncate($h, 0);
        fwrite($h, json_encode($room, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        fflush($h);
    }
    flock($h, LOCK_UN);
    fclose($h);
    return [true, $res];
}

function sweep(): void {
    global $DATA;
    $now = time();
    foreach (glob($DATA . '/room-*.json') ?: [] as $f) {
        $age = $now - (int) @filemtime($f);
        if ($age > ROOM_TTL) @unlink($f);
    }
    foreach (glob($DATA . '/fails-*.json') ?: [] as $f) {
        if ($now - (int) @filemtime($f) > 900) @unlink($f);
    }
}

function public_members(array $room): array {
    $now = time();
    $out = [];
    foreach ($room['members'] as $m) {
        $out[] = ['id' => $m['id'], 'name' => $m['name'], 'avatar' => $m['avatar'], 'language' => $m['language'], 'profileId' => $m['profileId'],
            'host' => $m['id'] === $room['hostId'], 'connected' => ($now - (int) ($m['seen'] ?? 0)) < CONNECTED_WITHIN];
    }
    return $out;
}
function find_member(array $room, $token): ?array {
    if (!is_string($token) || $token === '') return null;
    foreach ($room['members'] as $m) if (hash_equals((string) $m['token'], $token)) return $m;
    return null;
}
function new_code(): string {
    $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    for ($i = 0; $i < 60; $i++) {
        $c = '';
        for ($k = 0; $k < 4; $k++) $c .= $chars[random_int(0, strlen($chars) - 1)];
        if (!is_file(room_path($c))) return $c;
    }
    reply(503, ['error' => 'no room code available']);
}

/* ---------- routing ---------- */
$path = (string) ($_GET['p'] ?? '');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$parts = array_values(array_filter(explode('/', $path), fn($x) => $x !== ''));
// parts: ['api', 'health'] | ['api','check'] | ['api','rooms'] | ['api','rooms',CODE,action]
if (($parts[0] ?? '') !== 'api') reply(404, ['error' => 'not found']);
$what = $parts[1] ?? '';

if ($what === 'health') {
    sweep();
    $n = count(glob($DATA . '/room-*.json') ?: []);
    reply(200, ['ok' => true, 'rooms' => $n, 'time' => time() * 1000, 'gated' => $ACCESS !== '']);
}
if ($what === 'check') {
    [$ok, $st, $err] = access_ok($_GET['access'] ?? '');
    $ok ? reply(200, ['ok' => true]) : reply($st, ['error' => $err]);
}

/* ---------- cloud save: one JSON blob per random save key (the key is the secret) ---------- */
if ($what === 'save') {
    $b = $method === 'POST' ? body(MAX_SAVE + 4096) : [];
    [$ok, $st, $err] = access_ok($method === 'POST' ? ($b['access'] ?? '') : ($_GET['access'] ?? ''));
    if (!$ok) reply($st, ['error' => $err]);
    $key = $method === 'POST' ? (string) ($b['key'] ?? '') : (string) ($_GET['key'] ?? '');
    if (!preg_match('/^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){3}$/', $key)) reply(400, ['error' => 'that save code is not valid']);
    $file = $DATA . '/save-' . hash('sha256', strtoupper($key)) . '.json';
    if ($method === 'GET') {
        if (!is_file($file)) reply(404, ['error' => 'no save found for that code']);
        $j = json_decode((string) file_get_contents($file), true);
        if (!is_array($j)) reply(500, ['error' => 'the save is damaged']);
        reply(200, $j);
    }
    if ($method === 'POST') {
        $data = $b['data'] ?? null;
        if (!is_string($data) || $data === '' || strlen($data) > MAX_SAVE) reply(413, ['error' => 'the save is too large']);
        // Never let an older device overwrite a newer save.
        $updatedAt = (int) ($b['updatedAt'] ?? 0);
        if (is_file($file)) {
            $cur = json_decode((string) file_get_contents($file), true);
            if (is_array($cur) && (int) ($cur['updatedAt'] ?? 0) > $updatedAt && empty($b['force'])) reply(409, ['error' => 'a newer save exists', 'updatedAt' => $cur['updatedAt']]);
        }
        $enc = ($b['enc'] ?? '') === 'gzip-b64' ? 'gzip-b64' : 'json';
        file_put_contents($file, json_encode(['updatedAt' => $updatedAt ?: time() * 1000, 'enc' => $enc, 'data' => $data]), LOCK_EX);
        reply(200, ['ok' => true, 'updatedAt' => $updatedAt]);
    }
    reply(405, ['error' => 'method']);
}
/* ---------- friends: a small public stat card per friend code. Publishing needs the secret that goes with the code. ---------- */
if ($what === 'friend') {
    $b = $method === 'POST' ? body(16384) : [];
    [$ok, $st, $err] = access_ok($method === 'POST' ? ($b['access'] ?? '') : ($_GET['access'] ?? ''));
    if (!$ok) reply($st, ['error' => $err]);
    $code = strtoupper($method === 'POST' ? (string) ($b['code'] ?? '') : (string) ($_GET['code'] ?? ''));
    if (!preg_match('/^[A-Z0-9]{4}-[A-Z0-9]{4}$/', $code)) reply(400, ['error' => 'that friend code is not valid']);
    $file = $DATA . '/friend-' . hash('sha256', $code) . '.json';
    if ($method === 'GET') {
        if (!is_file($file)) reply(404, ['error' => 'nobody has that friend code yet']);
        $j = json_decode((string) file_get_contents($file), true);
        if (!is_array($j) || !is_array($j['card'] ?? null)) reply(500, ['error' => 'the card is damaged']);
        reply(200, ['code' => $code, 'card' => $j['card'], 'updatedAt' => (int) ($j['updatedAt'] ?? 0)]);
    }
    if ($method === 'POST') {
        $secret = (string) ($b['secret'] ?? '');
        if (strlen($secret) < 16 || strlen($secret) > 80) reply(400, ['error' => 'missing secret']);
        $in = $b['card'] ?? null;
        if (!is_array($in)) reply(400, ['error' => 'missing card']);
        $num = fn($v, int $max = 1000000000) => max(0, min($max, (int) $v));
        $cats = [];
        foreach ((is_array($in['cats'] ?? null) ? $in['cats'] : []) as $k => $v) {
            if (count($cats) >= 24 || !is_string($k) || !preg_match('/^[a-z]{2,16}$/', $k) || !is_array($v)) continue;
            $n = $num($v[0] ?? 0, 100000); $c = min($n, $num($v[1] ?? 0, 100000));
            $cats[$k] = [$n, $c];
        }
        $card = [
            'v' => 1,
            'name' => clean($in['name'] ?? '', 20) ?: 'Player',
            'avatar' => clean($in['avatar'] ?? '', 16),
            'games' => $num($in['games'] ?? 0), 'wins' => $num($in['wins'] ?? 0), 'best' => $num($in['best'] ?? 0),
            'streak' => $num($in['streak'] ?? 0, 100000), 'answered' => $num($in['answered'] ?? 0), 'correct' => $num($in['correct'] ?? 0),
            'bosses' => $num($in['bosses'] ?? 0), 'rush' => $num($in['rush'] ?? 0), 'maps' => $num($in['maps'] ?? 0),
            'hexes' => $num($in['hexes'] ?? 0, 500), 'cards' => $num($in['cards'] ?? 0, 500), 'cats' => $cats,
        ];
        $hash = hash('sha256', $secret);
        $h = @fopen($file, 'c+');
        if (!$h) reply(500, ['error' => 'could not save the card']);
        flock($h, LOCK_EX);
        $cur = json_decode((string) stream_get_contents($h), true);
        if (is_array($cur) && !hash_equals((string) ($cur['hash'] ?? ''), $hash)) { flock($h, LOCK_UN); fclose($h); reply(403, ['error' => 'that friend code belongs to someone else']); }
        rewind($h); ftruncate($h, 0);
        fwrite($h, json_encode(['hash' => $hash, 'card' => $card, 'updatedAt' => time() * 1000], JSON_UNESCAPED_UNICODE));
        fflush($h); flock($h, LOCK_UN); fclose($h);
        reply(200, ['ok' => true, 'code' => $code]);
    }
    reply(405, ['error' => 'method']);
}
if ($what !== 'rooms') reply(404, ['error' => 'not found']);

/* create */
if (count($parts) === 2 && $method === 'POST') {
    $b = body();
    [$ok, $st, $err] = access_ok($b['access'] ?? '');
    if (!$ok) reply($st, ['error' => $err]);
    sweep();
    $code = new_code();
    $hostId = 'm_' . rid(6);
    $host = ['id' => $hostId, 'token' => rid(18), 'name' => clean($b['name'] ?? '', 20) ?: 'Host', 'avatar' => clean($b['avatar'] ?? '', 16),
        'language' => clean($b['language'] ?? '', 5), 'profileId' => clean($b['profileId'] ?? '', 80), 'seen' => time()];
    $room = ['code' => $code, 'hostId' => $hostId, 'locked' => false, 'closed' => false, 'seq' => 0, 'latest' => null, 'log' => [], 'members' => [$hostId => $host]];
    file_put_contents(room_path($code), json_encode($room, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX);
    reply(200, ['code' => $code, 'memberId' => $hostId, 'token' => $host['token'], 'hostId' => $hostId, 'members' => public_members($room)]);
}

$code = strtoupper((string) ($parts[2] ?? ''));
$action = (string) ($parts[3] ?? '');
if (!preg_match('/^[A-Z]{4}$/', $code) || !is_file(room_path($code))) reply(404, ['error' => 'room not found']);

/* join */
if ($action === 'join' && $method === 'POST') {
    $b = body();
    [$ok, $st, $err] = access_ok($b['access'] ?? '');
    if (!$ok) reply($st, ['error' => $err]);
    $out = null;
    with_room($code, function (&$room) use ($b, $code, &$out) {
        if ($room['closed']) { $out = [404, ['error' => 'room not found']]; return false; }
        if ($room['locked']) { $out = [403, ['error' => 'the game has already started']]; return false; }
        if (count($room['members']) >= MAX_PLAYERS) { $out = [403, ['error' => 'room is full (4 players max)']]; return false; }
        $pid = clean($b['profileId'] ?? '', 80);
        $name = clean($b['name'] ?? '', 20) ?: 'Player';
        foreach ($room['members'] as $m) {
            if ($pid !== '' && $m['profileId'] === $pid) { $out = [409, ['error' => 'that player is already in this room']]; return false; }
            if (mb_strtolower($m['name']) === mb_strtolower($name)) { $out = [409, ['error' => "\"$name\" is already taken in this room, pick another player"]]; return false; }
        }
        $id = 'm_' . rid(6);
        $m = ['id' => $id, 'token' => rid(18), 'name' => $name, 'avatar' => clean($b['avatar'] ?? '', 16), 'language' => clean($b['language'] ?? '', 5), 'profileId' => $pid, 'seen' => time()];
        $room['members'][$id] = $m;
        $out = [200, ['code' => $code, 'memberId' => $id, 'token' => $m['token'], 'hostId' => $room['hostId'], 'members' => public_members($room)]];
    });
    reply($out[0], $out[1]);
}

/* poll: GET events?token=..&after=N   (after = -1 on the first call) */
if ($action === 'events' && $method === 'GET') {
    $token = (string) ($_GET['token'] ?? '');
    $after = (int) ($_GET['after'] ?? -1);
    $out = null;
    [$found] = with_room($code, function (&$room, &$dirty) use ($token, $after, &$out) {
        $me = find_member($room, $token);
        if (!$me) { $out = [403, ['error' => 'bad token']]; $dirty = false; return null; }
        $now = time();
        $dirty = false;
        if ($now - (int) ($room['members'][$me['id']]['seen'] ?? 0) >= 3) { $room['members'][$me['id']]['seen'] = $now; $dirty = true; }
        $resp = ['seq' => $room['seq'], 'hostId' => $room['hostId'], 'members' => public_members($room), 'locked' => $room['locked'], 'closed' => (bool) $room['closed'], 'events' => []];
        if ($after < 0) {
            $resp['hello'] = ['you' => ['id' => $me['id'], 'name' => $me['name'], 'avatar' => $me['avatar'], 'language' => $me['language'], 'profileId' => $me['profileId']], 'latest' => $room['latest']];
        } else {
            foreach ($room['log'] as $e) {
                if ($e['msg']['seq'] > $after && ($e['to'] === 'all' || in_array($me['id'], $e['to'], true))) $resp['events'][] = $e['msg'];
            }
        }
        $out = [200, $resp];
        return null;
    });
    if (!$found) reply(404, ['error' => 'room not found']);
    reply($out[0], $out[1]);
}

/* send */
if ($action === 'send' && $method === 'POST') {
    $b = body();
    $out = null;
    with_room($code, function (&$room) use ($b, &$out) {
        $me = find_member($room, $b['token'] ?? '');
        if (!$me) { $out = [403, ['error' => 'bad token']]; return false; }
        $type = clean($b['type'] ?? '', 24);
        if ($type === '') { $out = [400, ['error' => 'missing type']]; return false; }
        $isHost = $me['id'] === $room['hostId'];
        if (in_array($type, HOST_ONLY, true) && !$isHost) { $out = [403, ['error' => 'host only']]; return false; }
        if ($type === 'start') $room['locked'] = true;
        $room['seq']++;
        $msg = ['seq' => $room['seq'], 'from' => $me['id'], 'type' => $type, 'payload' => $b['payload'] ?? null];
        if (in_array($type, ['state', 'start', 'lobby'], true)) $room['latest'] = $msg;
        $to = $b['to'] ?? ($isHost ? 'all' : 'host');
        if ($to === 'all') $targets = array_keys($room['members']);
        elseif ($to === 'host') $targets = [$room['hostId']];
        elseif (is_string($to) && isset($room['members'][$to])) $targets = [$to];
        else $targets = [];
        // a newer state replaces older ones; everything else is kept until it ages out
        if ($type === 'state') $room['log'] = array_values(array_filter($room['log'], fn($e) => $e['msg']['type'] !== 'state'));
        $room['log'][] = ['to' => $targets, 'msg' => $msg];
        if (count($room['log']) > LOG_KEEP) $room['log'] = array_slice($room['log'], -LOG_KEEP);
        if ($type === 'end') $room['locked'] = true;
        $out = [200, ['ok' => true, 'seq' => $msg['seq'], 'delivered' => count($targets)]];
    });
    reply($out[0] ?? 404, $out[1] ?? ['error' => 'room not found']);
}

/* leave */
if ($action === 'leave' && $method === 'POST') {
    $b = body();
    $out = [403, ['error' => 'bad token']];
    with_room($code, function (&$room) use ($b, &$out) {
        $me = find_member($room, $b['token'] ?? '');
        if (!$me) return false;
        if ($me['id'] === $room['hostId']) { $room['closed'] = true; }
        elseif (!$room['locked']) { unset($room['members'][$me['id']]); }
        else { $room['members'][$me['id']]['seen'] = 0; }
        $out = [200, ['ok' => true]];
    });
    reply($out[0], $out[1]);
}

reply(404, ['error' => 'not found']);
