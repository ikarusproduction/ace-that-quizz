"""Solo duels through the UI: Boss Rush (pick a boss, fight, win/lose) and the Map run (pick rooms, rest, deal, shop).
Screenshots go to /tmp/duel-*.png. Run: python3 tests/e2e/duel.py"""
import subprocess, time, sys, os
from playwright.sync_api import sync_playwright
root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
srv = subprocess.Popen(['node', 'scripts/serve.js'], env={'PORT': '5198', 'PATH': os.environ['PATH']}, cwd=root)
time.sleep(1.2)
errors = []
CORRECT = """(wrong) => {
  const app = window.__app;
  const text = document.querySelector('#app').innerText;
  const q = app.bank.questions.find((x) => text.includes(x.question));
  if (!q) return 'noq';
  const want = String(q.choices[q.answer]);
  const els = [...document.querySelectorAll('.choice:not(.removed)')];
  const el = wrong ? els.find((c) => !c.innerText.includes(want)) : els.find((c) => c.innerText.includes(want));
  if (!el) return 'nochoice';
  el.click(); return 'ok';
}"""

def pick_player(pg):
    if pg.locator('text=Pick a player').count(): pg.locator('.pick').nth(4).click(no_wait_after=True)

def drive(pg, tag, accuracy_wrong_every=0, max_steps=900, until=None):
    n = 0; shots = set()
    for step in range(max_steps):
        if until and until(pg): return True
        if pg.locator('.reveal-overlay').count():
            pg.locator('.reveal-overlay .btn').first.click(no_wait_after=True); time.sleep(.4); continue
        if pg.locator('.timer').count():
            n += 1
            if 'q' not in shots: pg.screenshot(path=f'/tmp/duel-{tag}-question.png'); shots.add('q')
            pg.evaluate(CORRECT, bool(accuracy_wrong_every and n % accuracy_wrong_every == 0)); time.sleep(.15)
        elif pg.locator('.stake:not([disabled])').count():
            if 's' not in shots: time.sleep(1.5); pg.screenshot(path=f'/tmp/duel-{tag}-stake.png'); shots.add('s')
            try:
                pg.locator('.stake:not([disabled])').first.click(no_wait_after=True, timeout=1500)
                pg.locator('button:has-text("Lock in"):not([disabled])').first.click(no_wait_after=True, timeout=1500)
            except Exception: pass
        elif pg.locator('.reveal-banner').count():
            if 'r' not in shots: time.sleep(.5); pg.screenshot(path=f'/tmp/duel-{tag}-reveal-a.png'); time.sleep(1.2); pg.screenshot(path=f'/tmp/duel-{tag}-reveal-b.png'); shots.add('r')
            time.sleep(.3)
            try: pg.locator('.stick-bottom .btn').first.click(no_wait_after=True, timeout=1500)
            except Exception: pass
        elif pg.locator('.stick-bottom .btn').count():
            lab = pg.locator('.stick-bottom .btn').first.inner_text().lower()
            if 'see results' in lab or 'back to the map' in lab or 'face' in lab or 'start' in lab or 'continue' in lab:
                if 'l' not in shots and 'face' in lab: time.sleep(2); pg.screenshot(path=f'/tmp/duel-{tag}-loadout.png', full_page=True); shots.add('l')
                try: pg.locator('.stick-bottom .btn').first.click(no_wait_after=True, timeout=1500)
                except Exception: pass
            else: return True
        time.sleep(.15)
    return False
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 390, 'height': 844}); pg.set_default_timeout(6000)
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto('http://localhost:5198/'); pg.wait_for_selector('.menu')
        pg.evaluate("async()=>{const a=window.__app; await a.repo.createProfile({name:'Ana'});}")
        pg.screenshot(path='/tmp/duel-menu.png')
        # ---- boss rush
        pg.click('.menu button >> nth=0', no_wait_after=True); time.sleep(.4)
        pg.click('text=Boss Rush', no_wait_after=True); time.sleep(.2)
        pick_player(pg)
        pg.click('text=Start game', no_wait_after=True); time.sleep(.6)
        pg.wait_for_selector('.boss-grid'); pg.screenshot(path='/tmp/duel-bosses.png', full_page=True)
        pg.locator('.boss-pick').first.click(no_wait_after=True)
        pg.locator('button:has-text("Fight")').first.click(no_wait_after=True); time.sleep(.8)
        ok = drive(pg, 'rush', accuracy_wrong_every=4)
        time.sleep(.6); print('RUSH finished:', ok, pg.inner_text('#app')[:200].replace(chr(10), ' | '))
        pg.screenshot(path='/tmp/duel-rush-end.png', full_page=True)
        # ---- map
        pg.close(); pg = b.new_context(viewport={'width': 390, 'height': 844}).new_page(); pg.set_default_timeout(6000)
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto('http://localhost:5198/'); pg.wait_for_selector('.menu')
        pg.evaluate("async()=>{const a=window.__app; await a.repo.createProfile({name:'Ana'});}")
        pg.click('.menu button >> nth=0', no_wait_after=True); time.sleep(.4)
        pg.click('text=Map run', no_wait_after=True); time.sleep(.2)
        pick_player(pg)
        pg.click('text=Start game', no_wait_after=True); time.sleep(.8)
        pg.wait_for_selector('.map-wrap'); pg.screenshot(path='/tmp/duel-map.png', full_page=True)
        visited = set()
        for step in range(120):
            if pg.locator('.map-wrap').count():
                nodes = pg.locator('.map-node.avail')
                if not nodes.count(): break
                kind = nodes.first.get_attribute('class'); visited.add(kind.split()[1])
                nodes.first.click(no_wait_after=True); time.sleep(.2)
                pg.locator('.stick-bottom .btn.primary').click(no_wait_after=True); time.sleep(.5)
            elif pg.locator('.crossroads-opt:not([disabled])').count():
                pg.screenshot(path=f'/tmp/duel-room-{step}.png'); pg.locator('.crossroads-opt:not([disabled])').first.click(no_wait_after=True); time.sleep(.4)
            elif pg.locator('text=Back to the map').count() and pg.locator('.shop-item').count():
                pg.screenshot(path='/tmp/duel-shop.png', full_page=True); pg.click('text=Back to the map', no_wait_after=True); time.sleep(.3)
            else:
                drive(pg, f'map{step}', accuracy_wrong_every=5, until=lambda q: q.locator('.map-wrap').count() > 0 or q.locator('.crossroads-opt').count() > 0 or q.locator('.shop-item').count() > 0)
            t = pg.inner_text('#app')
            if 'beat the House' in t or 'lights go out' in t: break
        print('MAP visited kinds:', visited); print(pg.inner_text('#app')[:300].replace(chr(10), ' | '))
        pg.screenshot(path='/tmp/duel-map-end.png', full_page=True)
        b.close()
finally:
    srv.terminate()
print('ERRORS:', errors)
sys.exit(1 if errors else 0)
