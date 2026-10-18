"""Adventure: hub, map, learn cards, practice with hearts, results, progress and a boss. Screenshots in /tmp/adv-*.png.
Run: python3 tests/e2e/adventure.py"""
import subprocess, time, sys, os
from playwright.sync_api import sync_playwright
root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
srv = subprocess.Popen(['node', 'scripts/serve.js'], env={'PORT': '5195', 'PATH': os.environ['PATH']}, cwd=root)
time.sleep(1.2)
errors = []
CORRECT = """(wrong) => {
  const app = window.__app;
  const text = document.querySelector('#app').innerText;
  const q = [...app.bank.questions, ...app.bank.variants].find((x) => text.includes(x.question));
  if (!q) return 'noq';
  const want = String(q.choices[q.answer]);
  const els = [...document.querySelectorAll('.choice:not(:disabled)')];
  const el = wrong ? els.find((c) => !c.innerText.includes(want)) : els.find((c) => c.innerText.includes(want));
  if (!el) return 'nochoice';
  el.click(); return 'ok';
}"""

def play_level(pg, wrong_first=False):
    n = 0
    for _ in range(80):
        if pg.locator('text=/Next fact/').count(): pg.locator('text=/Next fact/').click(no_wait_after=True); time.sleep(.15); continue
        if pg.locator('text=/Start practising|Face the boss/').count(): pg.locator('text=/Start practising|Face the boss/').first.click(no_wait_after=True); time.sleep(.3); continue
        if pg.locator('.choice:not(:disabled)').count():
            r = pg.evaluate(CORRECT, bool(wrong_first and n == 0)); n += 1; assert r == 'ok', r; time.sleep(.1); continue
        if pg.locator('.stick-bottom .btn:has-text("Continue")').count(): pg.locator('.stick-bottom .btn:has-text("Continue")').click(no_wait_after=True); time.sleep(.15); continue
        if pg.locator('.big-stars').count() or pg.locator('text=/No hearts left|wins this time/').count(): return
        time.sleep(.2)
    raise AssertionError('level did not finish')

try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 390, 'height': 844}); pg.set_default_timeout(8000)
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto('http://localhost:5195/'); pg.wait_for_selector('.menu')
        pg.evaluate("async()=>{await window.__app.repo.createProfile({name:'Ana'});}")
        pg.reload(); pg.wait_for_selector('.menu')
        pg.click('.menu button:has-text("Adventure")', no_wait_after=True); pg.wait_for_selector('.adv-card')
        assert pg.locator('.adv-card').count() == 5
        pg.screenshot(path='/tmp/adv-hub.png')
        pg.locator('.adv-card').first.click(no_wait_after=True); pg.wait_for_selector('.adv-node')
        assert pg.locator('.adv-node:not([disabled])').count() == 1, 'only step 1 should be open'
        pg.screenshot(path='/tmp/adv-map.png', full_page=True)
        pg.locator('.adv-node:not([disabled])').click(no_wait_after=True, force=True); time.sleep(.5)
        pg.wait_for_selector('.learn-card'); pg.screenshot(path='/tmp/adv-learn.png')
        play_level(pg, wrong_first=True)
        assert pg.locator('.big-stars').count(), 'level not won'
        print('result:', pg.inner_text('.panel.center').replace(chr(10), ' | '))
        pg.screenshot(path='/tmp/adv-result.png')
        pg.click('text=Back to the path', no_wait_after=True); pg.wait_for_selector('.adv-node')
        assert pg.locator('.adv-node.done').count() == 1 and pg.locator('.adv-node:not([disabled])').count() == 2
        # XP landed on the profile
        xp = pg.evaluate("async()=>{const a=window.__app; const [p]=await a.repo.listProfiles(); return p.xp}")
        assert xp > 0, xp
        # jump to the first fork and the first boss
        pg.evaluate("async()=>{const a=window.__app; const [p]=await a.repo.listProfiles(); for (let s=2;s<=9;s++) await a.repo.completeAdventureStep(p.id,'science',s,s===3||s===6?'safe':'main',3);}")
        pg.reload(); pg.wait_for_selector('.menu')
        pg.click('.menu button:has-text("Adventure")', no_wait_after=True); pg.wait_for_selector('.adv-card'); pg.locator('.adv-card').first.click(no_wait_after=True); pg.wait_for_selector('.adv-node')
        pg.screenshot(path='/tmp/adv-fork.png', full_page=True)
        assert pg.locator('.adv-row.fork').count() == 2
        boss = pg.locator('.adv-node.boss:not([disabled])'); assert boss.count() == 1
        boss.click(no_wait_after=True, force=True); pg.wait_for_selector('.boss-intro'); pg.screenshot(path='/tmp/adv-boss.png')
        play_level(pg)
        assert pg.locator('.big-stars').count(); print('boss:', pg.inner_text('.panel.center').replace(chr(10), ' | '))
        packs = pg.evaluate("async()=>{const a=window.__app; const [p]=await a.repo.listProfiles(); return p.packs.map(k=>k.type)}")
        assert 'silver' in packs, packs
        # losing: three wrong answers on step 11
        pg.click('text=Next step', no_wait_after=True); time.sleep(.5)
        for _ in range(40):
            if pg.locator('text=/Next fact/').count(): pg.locator('text=/Next fact/').click(no_wait_after=True); time.sleep(.1); continue
            if pg.locator('text=/Start practising/').count(): pg.locator('text=/Start practising/').click(no_wait_after=True); time.sleep(.3); continue
            if pg.locator('.choice:not(:disabled)').count(): pg.evaluate(CORRECT, True); time.sleep(.1); continue
            if pg.locator('.stick-bottom .btn:has-text("Continue"), .stick-bottom .btn:has-text("See result")').count(): pg.locator('.stick-bottom .btn:has-text("Continue"), .stick-bottom .btn:has-text("See result")').first.click(no_wait_after=True); time.sleep(.15); continue
            if pg.locator('text=No hearts left').count(): break
            time.sleep(.2)
        assert pg.locator('text=No hearts left').count(), 'should have lost'
        pg.screenshot(path='/tmp/adv-lost.png')
        assert not errors, errors
        print('OK')
finally:
    srv.terminate()
