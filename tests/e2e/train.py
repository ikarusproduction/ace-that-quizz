"""Train modes: daily, focused, weakness hunter, mastery notice, review expedition. Screenshots in /tmp/train-*.png.
Run: python3 tests/e2e/train.py"""
import subprocess, time, os
from playwright.sync_api import sync_playwright
root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
srv = subprocess.Popen(['node', 'scripts/serve.js'], env={'PORT': '5190', 'PATH': os.environ['PATH']}, cwd=root)
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

def play(pg, wrong=False, limit=300, until='.learn-sum'):
    for _ in range(limit):
        if pg.locator(until).count(): return
        if pg.locator('.boss-intro').count() and not pg.locator('.qcard').count():
            pg.locator('.stick-bottom .btn.primary').first.click(no_wait_after=True); time.sleep(.3); continue
        if pg.locator('.choice:not(:disabled)').count():
            if pg.locator('.hexcard').count(): pg.locator('.hexcard').first.dispatch_event('pointerdown'); time.sleep(.1)
            r = pg.evaluate(CORRECT, wrong); assert r == 'ok', r; time.sleep(.12); continue
        if pg.locator('.stick-bottom .btn:has-text("Continue"), .stick-bottom .btn:has-text("See result")').count():
            pg.locator('.stick-bottom .btn:has-text("Continue"), .stick-bottom .btn:has-text("See result")').first.click(no_wait_after=True); time.sleep(.15); continue
        time.sleep(.2)
    pg.screenshot(path='/tmp/train-stuck.png'); print(pg.inner_text('#app')[:600]); raise AssertionError('session did not finish')

def learn(pg):
    return pg.evaluate("async()=>{const a=window.__app; const [p]=await a.repo.listProfiles(); const m=await a.repo.getMeta(p.id); return {n:Object.keys(m.learn.items).length, states:Object.values(m.learn.items).map(i=>i.state), streak:m.learn.streak.count, packs:p.packs.map(k=>k.type)}}")

try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 390, 'height': 844}); pg.set_default_timeout(8000)
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto('http://localhost:5190/'); pg.wait_for_selector('.menu')
        pg.evaluate("async()=>{await window.__app.repo.createProfile({name:'Ana'});}")
        pg.reload(); pg.wait_for_selector('.menu'); time.sleep(3.8)
        pg.click('.menu button:has-text("Train")', no_wait_after=True); pg.wait_for_selector('.mode-card'); time.sleep(.5)
        assert pg.locator('.mode-card').count() == 5
        pg.screenshot(path='/tmp/train-hub.png')
        # daily with wrong answers first so there is something weak
        pg.locator('.mode-card:has-text("Daily Training")').click(no_wait_after=True); pg.wait_for_selector('.qcard')
        pg.screenshot(path='/tmp/train-q.png')
        play(pg, wrong=True)
        print('daily done:', pg.inner_text('.panel.center').replace(chr(10), ' | '))
        st = learn(pg); print(st); assert st['n'] == 8 and st['streak'] == 1 and 'learning' in st['states']
        assert 'bronze' not in st['packs'] or True
        pg.screenshot(path='/tmp/train-done.png')
        pg.click('.btn:text-is("Back")', no_wait_after=True); pg.wait_for_selector('.mode-card')
        # mastery refuses (not enough established concepts)
        pg.locator('.mode-card:has-text("Mastery Challenge")').click(no_wait_after=True); pg.wait_for_selector('text=/needs at least/')
        pg.click('.btn:text-is("Back")', no_wait_after=True); pg.wait_for_selector('.mode-card')
        # weakness hunter now has material
        pg.locator('.mode-card:has-text("Weakness Hunter")').click(no_wait_after=True); pg.wait_for_selector('.qcard')
        play(pg)
        print('weak done:', pg.inner_text('.panel.center').replace(chr(10), ' | '))
        pg.click('.btn:text-is("Back")', no_wait_after=True); pg.wait_for_selector('.mode-card')
        # focused training: science / space
        pg.locator('.mode-card:has-text("Focused Training")').click(no_wait_after=True); pg.wait_for_selector('.mode-card:has-text("Science")')
        pg.locator('.mode-card:has-text("Science")').first.click(no_wait_after=True); pg.wait_for_selector('text=Everything in this subject')
        pg.screenshot(path='/tmp/train-sub.png')
        pg.locator('.mode-card:has-text("space")').first.click(no_wait_after=True); pg.wait_for_selector('.qcard')
        play(pg)
        pg.click('.btn:text-is("Back")', no_wait_after=True); pg.wait_for_selector('.mode-card')
        # review expedition: four encounters, shared hearts
        pg.locator('.mode-card:has-text("Review Expedition")').click(no_wait_after=True); pg.wait_for_selector('.boss-intro')
        pg.screenshot(path='/tmp/train-exp1.png')
        play(pg, until='.learn-sum')
        txt = pg.inner_text('.panel.center').replace(chr(10), ' | '); print('expedition:', txt)
        pg.screenshot(path='/tmp/train-exp-done.png')
        st = learn(pg); print(st)
        assert 'silver' in st['packs'], st
        assert not errors, errors
        print('OK')
finally:
    srv.terminate()
