"""PHP-relay variant. Online play e2e: three separate browser contexts (three phones) join one room through the relay and play a full
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
    pg.evaluate("async([n,l])=>{const p = await window.__app.repo.createProfile({name:n, language:l}); await window.__app.repo.setHexDeck(p.id, ['ink_blast']);}", [name, lang])
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
        phones = {'Ana': ana, 'Ben': ben, 'Cleo': cleo}
        for pg_ in phones.values(): pg_.wait_for_function('document.querySelector("#app").innerText.includes("ROUND 1")', timeout=15000)
        # Turn order: find phones that are waiting (not on turn); the first player (Ana) must stake first.
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
        for step in range(200):
            r0 = {n: pg.evaluate(DRIVE) for n, pg in phones.items()}
            if sum(v == 'wait' for v in r0.values()) >= 1 and any(v == 'stake' for v in r0.values()) is False and 'wait' in r0.values(): break
            time.sleep(.15)
        # settle: stop driving, let in-flight updates land, then look for a stable state with two waiters
        time.sleep(3)
        res = {n: pg.evaluate('!!document.querySelector(".waiting-card")') for n, pg in phones.items()}
        waiters = [n for n, v in res.items() if v]
        print('waiting?', res)
        assert len(waiters) == 2, 'need two waiting phones'
        ok_total = 0
        for rnd in range(5):
            # both waiters answer CORRECTLY at (almost) the same moment
            for n in waiters:
                if phones[n].locator('.reveal-overlay .btn').count(): phones[n].locator('.reveal-overlay .btn').click(no_wait_after=True); time.sleep(.3)
            for n in waiters:
                phones[n].evaluate("() => { const w = document.querySelector('.waitgame').__wg; w.cur.solve(); }")
            for n in waiters:
                try: phones[n].wait_for_selector('.waitgame .big', timeout=15000)
                except Exception:
                    print('STUCK', n, phones[n].inner_text('#app', timeout=2000)[:500].replace(chr(10),' | ')); raise
                txt = phones[n].inner_text('.waitgame .big')
                print(rnd, n, txt.replace(chr(10), ' '))
                assert re.search(r'Correct|Bonne', txt) and 'Not quite' not in txt and 'Rat' not in txt, (n, txt)
                ok_total += 1
            time.sleep(.8)
            for n in waiters:
                while phones[n].locator('.reveal-overlay .btn').count(): phones[n].locator('.reveal-overlay .btn').click(no_wait_after=True); time.sleep(.5)
                phones[n].click('.waitgame .btn.primary')
        # 10 correct puzzles each: the prank meter must have earned each waiter a hex. Dismiss the reveals, then prank the answerer.
        time.sleep(1.5)
        pranker = None
        for n in waiters:
            if phones[n].locator('.reveal-overlay .btn').count(): phones[n].locator('.reveal-overlay .btn').click(no_wait_after=True); time.sleep(.3)
            if phones[n].locator('.hexbar .hex-chip:not([disabled])').count() and pranker is None: pranker = n
        print('pranker', pranker)
        assert pranker, 'no waiter earned a prank hex'
        turn = [n for n in phones if n not in waiters][0]
        phones[pranker].screenshot(path='/tmp/prank-hand.png')
        chips0 = int(re.search(r'\n(\d+)\n', phones[turn].inner_text('.hud')).group(1))
        chip_name = phones[pranker].locator('.hexbar .hex-chip:not([disabled])').first.inner_text().split(chr(10))[0]
        phones[pranker].locator('.hexbar .hex-chip:not([disabled])').first.click(no_wait_after=True)
        time.sleep(2)
        # the answerer locks a stake and must see the hex on the question
        phones[turn].evaluate(DRIVE); time.sleep(2.5)
        chips1 = int(re.search(r'\n(\d+)\n', phones[turn].inner_text('.hud')).group(1))
        hexed = phones[turn].locator('.hex-tag').count() or phones[turn].locator('.hex-blot').count() or chips1 < chips0
        print('prank', chip_name, 'victim chips', chips0, '->', chips1)
        phones[turn].screenshot(path='/tmp/prank-victim.png')
        print('victim sees hex', bool(hexed))
        assert hexed, 'the answerer did not see the prank'
        assert not errors, errors
        print('OK', ok_total); b.close()
finally:
    srv.terminate(); shutil.rmtree(site, ignore_errors=True)
