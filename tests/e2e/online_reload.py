"""Reload variant: the host and a guest reload their page mid-game and must land back in the same game.
PHP-relay variant. Online play e2e: three separate browser contexts (three phones) join one room through the relay and play a full
Versus game. Checks each phone only saves its own player's results, and that waiting phones don't see the question.
Run: python3 tests/e2e/online.py   (needs Python Playwright + Chromium)"""
import subprocess, time, sys, os, re
from playwright.sync_api import sync_playwright
root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
import tempfile, shutil, hashlib, json
PORT = '8797'
site = tempfile.mkdtemp(prefix='thk-site-')
play = os.path.join(site, 'play'); os.makedirs(os.path.join(play, 'api'))
for f in ('index.html','manifest.webmanifest','sw.js','icon.svg'): shutil.copy(os.path.join(root, f), play)
for d in ('src','data'): shutil.copytree(os.path.join(root, d), os.path.join(play, d))
shutil.copy(os.path.join(root, 'server/php/index.php'), os.path.join(play, 'api/index.php'))
open(os.path.join(play, 'api/config.php'), 'w').write("<?php return ['access_hash' => '%s'];" % hashlib.sha256(b'sesame').hexdigest())
open(os.path.join(play, 'config.json'), 'w').write(json.dumps({'relay': '/play/api/index.php', 'gate': True}))
srv = subprocess.Popen(['php', '-S', f'127.0.0.1:{PORT}', '-t', site], env={**os.environ, 'PHP_CLI_SERVER_WORKERS': '8'}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.2)
BASE = f'http://127.0.0.1:{PORT}/play/'
errors = []
def newphone(b, name, lang='en'):
    ctx = b.new_context(viewport={'width': 390, 'height': 844}); pg = ctx.new_page(); pg.set_default_timeout(8000)
    pg.on('console', lambda m: errors.append((name, m.text)) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    pg.on('pageerror', lambda e: errors.append((name, str(e))))
    pg.goto(BASE); pg.wait_for_selector('input[type=password]'); pg.fill('input[type=password]','sesame'); pg.click('button:text-is("Enter")'); pg.wait_for_selector('.menu')
    pg.evaluate("async([n,l])=>{await window.__app.repo.createProfile({name:n, language:l});}", [name, lang])
    return pg
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        ana, ben, cleo = newphone(b, 'Ana'), newphone(b, 'Ben', 'fr'), newphone(b, 'Cleo')
        # Host creates the room
        ana.click('text=Online', no_wait_after=True); ana.wait_for_selector('text=Create a room')
        ana.locator('.pick').first.click(no_wait_after=True)
        ana.wait_for_selector('text=/Game server:/')
        ana.click('text=Create a room', no_wait_after=True); ana.wait_for_selector('.room-code')
        code = ana.inner_text('.room-code').strip(); assert re.fullmatch(r'[A-Z]{4}', code), code
        print('room', code)
        for ph in (ben, cleo):
            ph.click('text=Online', no_wait_after=True); ph.wait_for_selector('text=Create a room')
            ph.locator('.pick').first.click(no_wait_after=True)
            ph.wait_for_selector('text=/Game server:/')
            ph.fill('.code-input', code); ph.click('button:text-is("Join")', no_wait_after=True); ph.wait_for_selector('.room-code')
        ana.wait_for_function('document.querySelectorAll(".pick.static").length===3')
        assert ana.locator('button:has-text("Choose themes")').count()==0 or ana.locator('button.primary.block').first.is_disabled(), 'host must not start before guests are ready'
        for ph in (ben, cleo):
            ph.click('text=I\'m ready', no_wait_after=True)
        ana.wait_for_selector('text=Choose themes')
        ana.click('text=Choose themes', no_wait_after=True); ana.wait_for_selector('.slots')
        ana.screenshot(path='/tmp/online-themes.png')
        ana.click('text=Start game', no_wait_after=True)
        # Drive all three phones until the game is over
        phones = {'Ana': ana, 'Ben': ben, 'Cleo': cleo}
        for pg_ in phones.values(): pg_.wait_for_function('document.querySelector("#app").innerText.includes("ROUND 1")', timeout=15000)
        waiting_seen = 0; hidden_ok = True; reloads = 0
        DRIVE = """() => {
          const $ = (s) => document.querySelector(s);
          if ($('.waiting-card')) return 'wait';
          if (document.querySelector('#app').textContent.includes('Final standings')) return 'done';
          const timer = $('.timer');
          if (timer) { const c = $('.choice:not(.removed)'); c && c.click(); return 'answer'; }
          const st = document.querySelector('.stake:not([disabled])');
          if (st) { st.click(); const lock = [...document.querySelectorAll('button')].find((b) => /Lock in/.test(b.textContent) && !b.disabled); lock && lock.click(); return 'stake'; }
          const nb = document.querySelector('.stick-bottom .btn:not([disabled])');
          if (nb) { nb.click(); return 'next'; }
          return 'idle';
        }"""
        for step in range(4000):
            if step in (40, 120):
                who = 'Ana' if step == 40 else 'Ben'
                phones[who].reload(); phones[who].wait_for_function('document.querySelector("#app").innerText.includes("ROUND")', timeout=20000)
                reloads += 1
            try:
                res = {name: pg.evaluate(DRIVE) for name, pg in phones.items()}
            except Exception:
                time.sleep(.3); continue
            if all(v == 'done' for v in res.values()): break
            for name, pg in phones.items():
                if res[name] == 'wait':
                    waiting_seen += 1
                    txt = pg.inner_text('#app')
                    if re.search(r'\nA\n', txt) and 'STAKE' not in txt: hidden_ok = False; print('LEAK', name, txt[:400].replace(chr(10),' | '), flush=True)
            time.sleep(.1)
        else:
            sys.exit('game did not finish: ' + str([pg.evaluate('document.querySelector("#app").innerText.slice(0,120)') for pg in phones.values()]))
        time.sleep(1)
        out = {}
        for name, pg in phones.items():
            out[name] = pg.evaluate("async()=>{const a=window.__app; const ps=await a.repo.listProfiles(); const r={}; for(const p of ps) r[p.name]=(await a.repo.listResults(p.id)).length; return r}")
        print(out, 'waiting views', waiting_seen)
        for name in phones: assert out[name][name] == 15 and sum(out[name].values()) == 15, out
        assert reloads == 2, reloads
        assert hidden_ok and waiting_seen > 20
        # fr player sees translated-or-fallback notice logic doesn't crash
        assert not errors, errors
        print('OK'); b.close()
finally:
    srv.terminate(); shutil.rmtree(site, ignore_errors=True)
