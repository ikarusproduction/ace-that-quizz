"""The Atlas (geography adventure): opens from the Adventure hub, plays step 1 with no country/capital/flag question.
Run: python3 tests/e2e/atlas.py"""
import subprocess, time, os
from playwright.sync_api import sync_playwright
root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
srv = subprocess.Popen(['node', 'scripts/serve.js'], env={'PORT': '5197', 'PATH': os.environ['PATH']}, cwd=root)
time.sleep(1.2)
CORRECT = """() => {
  const app = window.__app; const text = document.querySelector('#app').innerText;
  const q = [...app.bank.questions, ...app.bank.variants].find((x) => text.includes(x.question) && x.choices.every((c) => text.includes(String(c))));
  if (!q) return 'noq:' + q;
  const want = String(q.choices[q.answer]);
  const el = [...document.querySelectorAll('.choice:not(:disabled)')].find((c) => c.innerText.includes(want));
  if (!el) return 'nochoice';
  window.__seen = (window.__seen || []).concat([q.subcategory]); el.click(); return 'ok';
}"""
try:
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(viewport={'width': 390, 'height': 780}); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto('http://localhost:5197/'); pg.wait_for_selector('.menu')
        pg.evaluate("async()=>{await window.__app.repo.createProfile({name:'Ana'});}")
        pg.reload(); pg.wait_for_selector('.menu')
        pg.click('.menu button:has-text("Adventure")', no_wait_after=True)
        pg.wait_for_selector('.mode-card:has-text("The Atlas")')
        pg.click('.mode-card:has-text("The Atlas")', no_wait_after=True); pg.wait_for_selector('.adv-node')
        pg.locator('.adv-node:not([disabled])').first.click(no_wait_after=True, force=True)
        done = 0
        for _ in range(120):
            if pg.locator('.choice:not(:disabled)').count():
                r = pg.evaluate(CORRECT); assert r == 'ok', r; done += 1; time.sleep(.15)
            elif pg.locator('text=/right/').count() and done >= 5: break
            else:
                for t in ('Start', 'Next', 'Continue', 'Got it', 'Go'):
                    if pg.locator(f'button:has-text("{t}")').count(): pg.locator(f'button:has-text("{t}")').first.click(no_wait_after=True); break
                time.sleep(.2)
        seen = pg.evaluate('window.__seen || []')
        assert done >= 5, done
        assert not set(seen) & {'countries', 'capitals', 'flags'}, seen
        assert not errs, errs
        print('seen', seen); print('OK atlas'); b.close()
finally:
    srv.terminate()
