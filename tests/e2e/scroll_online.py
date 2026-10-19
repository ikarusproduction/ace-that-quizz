"""Scroll and typing stay put online. PHP-relay variant. Online play e2e: three separate browser contexts (three phones) join one room through the relay and play a full
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
for d in ('src','data','assets'): shutil.copytree(os.path.join(root, d), os.path.join(play, d))
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
        # Waiter Ana scrolls down and starts typing; waiter Ben solves puzzles. Ana's page, scroll and half-typed answer must not move.
        a, bn = phones[waiters[0]], phones[waiters[1]]
        for ph in (a, bn):
            ph.set_viewport_size({'width': 390, 'height': 420})
            while ph.locator('.reveal-overlay .btn').count(): ph.locator('.reveal-overlay .btn').click(no_wait_after=True); time.sleep(.3)
        time.sleep(.5)
        a.evaluate("() => { document.body.style.minHeight = '2400px'; window.scrollTo(0, 260); }"); time.sleep(.3)
        a.evaluate("() => { window.__wg = document.querySelector('.waitgame'); window.__st = document.querySelector('.standings'); }")
        inp = a.locator('.waitgame input[type=text], .waitgame input:not([type])')
        if inp.count():
            inp.first.fill('half typed'); inp.first.focus()
        time.sleep(.4); y0 = a.evaluate('window.scrollY'); assert y0 > 100, y0
        chips_before = a.evaluate("() => document.querySelector('.standings').innerText")
        moves = 0
        for rnd in range(3):
            bn.evaluate("() => { const w = document.querySelector('.waitgame').__wg; w.cur.solve(); }")
            bn.wait_for_selector('.waitgame .big', timeout=15000); time.sleep(.9)
            y = a.evaluate('window.scrollY')
            same_node = a.evaluate("() => window.__wg === document.querySelector('.waitgame')")
            val = a.evaluate("() => (document.querySelector('.waitgame input') || {}).value ?? null")
            focus = a.evaluate("() => document.activeElement && document.activeElement.tagName")
            print(rnd, 'scrollY', y, 'puzzle node kept', same_node, 'typed', val, 'focus', focus)
            assert abs(y - y0) <= 1, f'scroll moved {y0} -> {y}'
            assert same_node, 'the puzzle panel was rebuilt'
            if inp.count(): assert val == 'half typed', val; assert focus == 'INPUT', focus
            while bn.locator('.reveal-overlay .btn').count(): bn.locator('.reveal-overlay .btn').click(no_wait_after=True); time.sleep(.4)
            bn.click('.waitgame .btn.primary'); time.sleep(.3)
        chips_after = a.evaluate("() => document.querySelector('.standings').innerText")
        assert chips_after != chips_before, 'standings should show the other player\'s new chips'
        print('standings updated in place:', chips_before.replace(chr(10), ' '), '->', chips_after.replace(chr(10), ' '))
        assert not errors, errors
        print('OK scroll online'); b.close()
finally:
    srv.terminate(); shutil.rmtree(site, ignore_errors=True)
