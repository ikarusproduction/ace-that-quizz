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

def play_level(pg, wrong_first=False, hint_first=False):
    n = 0
    for _ in range(160):
        if pg.locator('text=/Face the boss/').count(): pg.locator('text=/Face the boss/').first.click(no_wait_after=True); time.sleep(.3); continue
        if pg.locator('.choice:not(:disabled)').count():
            if hint_first and n == 1 and pg.locator('.btn.hint:not(:disabled)').count():
                pg.locator('.btn.hint').click(no_wait_after=True); time.sleep(.1)
                pg.locator('.conf .chip').first.click(no_wait_after=True); time.sleep(.1)
                assert pg.locator('.choice.elim').count() == 1, 'a hint removes one wrong choice'
            r = pg.evaluate(CORRECT, bool(wrong_first and n == 0)); n += 1; assert r == 'ok', r; time.sleep(.12); continue
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
        pg.click('.menu button:has-text("Adventure")', no_wait_after=True); pg.wait_for_selector('.adv-node')
        assert pg.locator('.adv-card').count() == 0, 'no theme hub: only Science is open'
        assert pg.locator('.scene.sc-bench').count() == 1, 'chapter 1 has the bench scene'
        assert pg.locator('.adv-node:not([disabled])').count() == 1, 'only step 1 should be open'
        pg.screenshot(path='/tmp/adv-map.png')
        pg.locator('.adv-node:not([disabled])').click(no_wait_after=True, force=True); pg.wait_for_selector('.qcard'); time.sleep(.4)
        assert pg.locator('.learn-card').count() == 0, 'no learn cards'
        assert pg.locator('.conf .chip').count() == 3 and pg.locator('.btn.hint').count() == 1
        pg.screenshot(path='/tmp/adv-q.png')
        play_level(pg, wrong_first=True, hint_first=True)
        assert pg.locator('.big-stars').count(), 'level not won'
        print('result:', pg.inner_text('.panel.center').replace(chr(10), ' | '))
        assert pg.locator('.learn-sum').count() == 1
        pg.screenshot(path='/tmp/adv-result.png')
        learn = pg.evaluate("async()=>{const a=window.__app; const [p]=await a.repo.listProfiles(); const m=await a.repo.getMeta(p.id); return {n:Object.keys(m.learn.items).length, hinted:Object.values(m.learn.items).filter(i=>i.hinted>0).length, streak:m.learn.streak.count, states:Object.values(m.learn.items).map(i=>i.state)}}")
        print('learn', learn); assert learn['n'] >= 5 and learn['hinted'] >= 1 and learn['streak'] == 1
        pg.click('text=Back to the path', no_wait_after=True); pg.wait_for_selector('.adv-node')
        assert pg.locator('.adv-node.done').count() == 1 and pg.locator('.adv-node:not([disabled])').count() == 2
        xp = pg.evaluate("async()=>{const a=window.__app; const [p]=await a.repo.listProfiles(); return p.xp}")
        assert xp > 0, xp
        # the lab accident (step 5): jump to it
        pg.evaluate("async()=>{const a=window.__app; const [p]=await a.repo.listProfiles(); for (let s=2;s<=4;s++) await a.repo.completeAdventureStep(p.id,'science',s,s===3?'safe':'main',3);}")
        pg.reload(); pg.wait_for_selector('.menu')
        pg.click('.menu button:has-text("Adventure")', no_wait_after=True); pg.wait_for_selector('.adv-node')
        pg.locator('.adv-node.event').click(no_wait_after=True, force=True); pg.wait_for_selector('.arena-strip.event')
        saw_card = False
        for _ in range(60):
            if pg.locator('.hexcard').count(): saw_card = True; break
            if pg.locator('.choice:not(:disabled)').count():
                if pg.locator('.qcard').count() and 'Question' not in pg.inner_text('.row.between') and False: pass
                time.sleep(.9)
                if pg.locator('.hexcard').count(): saw_card = True; break
                pg.evaluate(CORRECT, False); time.sleep(.1)
                if pg.locator('.stick-bottom .btn:has-text("Continue")').count(): pg.locator('.stick-bottom .btn:has-text("Continue")').click(no_wait_after=True)
            time.sleep(.3)
        print('event hex card seen', saw_card)
        # jump to the first boss
        pg.evaluate("async()=>{const a=window.__app; const [p]=await a.repo.listProfiles(); for (let s=4;s<=9;s++) await a.repo.completeAdventureStep(p.id,'science',s,s===6?'safe':'main',3);}")
        pg.reload(); pg.wait_for_selector('.menu')
        pg.click('.menu button:has-text("Adventure")', no_wait_after=True); pg.wait_for_selector('.adv-node')
        pg.screenshot(path='/tmp/adv-fork.png', full_page=True)
        assert pg.locator('.adv-row.fork').count() == 2
        boss = pg.locator('.adv-node.boss:not([disabled])'); assert boss.count() == 1
        boss.click(no_wait_after=True, force=True); pg.wait_for_selector('.boss-intro'); pg.screenshot(path='/tmp/adv-boss.png')
        pg.locator('text=Face the boss').click(no_wait_after=True); pg.wait_for_selector('.arena-strip.boss')
        assert pg.locator('.scene.arena').count() == 1
        # play the boss; look for thrown cards and deflect the first one
        deflected = 0; seen = 0
        for _ in range(400):
            if pg.locator('.big-stars').count() or pg.locator('text=/wins this time/').count(): break
            hc = pg.locator('.hexcard')
            if hc.count():
                seen += 1
                if deflected == 0:
                    pg.screenshot(path='/tmp/adv-hex.png')
                    hc.first.dispatch_event('pointerdown'); deflected += 1; time.sleep(.2); continue
            if pg.locator('.choice:not(:disabled)').count():
                time.sleep(1.0)
                if pg.locator('.hexcard').count() and deflected == 0: continue
                if pg.locator('.hex-layer i').count() or pg.locator('.hex-blur').count():
                    pg.screenshot(path='/tmp/adv-hexed.png')
                pg.evaluate(CORRECT, False); time.sleep(.15)
            if pg.locator('.stick-bottom .btn:has-text("Continue")').count(): pg.locator('.stick-bottom .btn:has-text("Continue")').click(no_wait_after=True)
            time.sleep(.2)
        assert pg.locator('.big-stars').count(); print('boss:', pg.inner_text('.panel.center').replace(chr(10), ' | '), 'cards seen', seen)
        assert seen > 0, 'the boss should throw hex cards'
        packs = pg.evaluate("async()=>{const a=window.__app; const [p]=await a.repo.listProfiles(); return p.packs.map(k=>k.type)}")
        assert 'silver' in packs, packs
        # chapter 2 has another scene
        pg.click('text=Next step', no_wait_after=True); time.sleep(.6)
        assert pg.locator('.scene.sc-greenhouse').count() == 1, 'chapter 2 changes the backdrop'
        pg.screenshot(path='/tmp/adv-ch2.png')
        # losing: wrong answers on step 11
        for _ in range(60):
            if pg.locator('.choice:not(:disabled)').count(): pg.evaluate(CORRECT, True); time.sleep(.1)
            if pg.locator('.stick-bottom .btn:has-text("Continue"), .stick-bottom .btn:has-text("See result")').count(): pg.locator('.stick-bottom .btn:has-text("Continue"), .stick-bottom .btn:has-text("See result")').first.click(no_wait_after=True); time.sleep(.15)
            if pg.locator('text=No hearts left').count(): break
            time.sleep(.2)
        assert pg.locator('text=No hearts left').count(), 'should have lost'
        pg.screenshot(path='/tmp/adv-lost.png')
        assert not errors, errors
        print('OK')
finally:
    srv.terminate()
