"""End-to-end smoke test (needs Python Playwright + Chromium): plays a full 3-player Versus game through the UI
and checks pass-the-phone gates, no console errors, and per-player result isolation.  Run: python3 tests/e2e/versus.py"""
import subprocess, time, sys, os
from playwright.sync_api import sync_playwright
root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
srv = subprocess.Popen(['node', 'scripts/serve.js'], env={'PORT': '5198', 'PATH': os.environ['PATH']}, cwd=root)
time.sleep(1.2)
errors = []
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 390, 'height': 844}); pg.set_default_timeout(6000)
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'TUNNEL' not in m.text and 'Failed to load resource' not in m.text else None)
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto('http://localhost:5198/'); pg.wait_for_selector('.menu')
        pg.evaluate("async()=>{const a=window.__app; for (const n of ['Ana','Ben','Cleo']) await a.repo.createProfile({name:n});}")
        pg.click('.menu button >> nth=0', no_wait_after=True); time.sleep(.4)
        pg.click('text=Versus', no_wait_after=True)
        for i in range(3): pg.locator('.pick').nth(4 + i).click(no_wait_after=True)
        pg.click('text=Start game', no_wait_after=True); time.sleep(.6)
        pg.wait_for_selector('.slots'); pg.click('.spin-btn', no_wait_after=True); pg.wait_for_function('document.querySelectorAll(".slot.filled").length===5 && !document.querySelector(".slot.reeling .spinning")', timeout=9000); time.sleep(.8)
        pg.click('text=Start game', no_wait_after=True); time.sleep(1)
        gates = 0
        for step in range(900):
            t = pg.evaluate('document.querySelector("#app").textContent')
            if 'Final standings' in t: break
            if pg.locator('.reveal-overlay .btn').count(): pg.locator('.reveal-overlay .btn').first.click(no_wait_after=True, timeout=1500)
            elif pg.locator('.gate').count(): gates += 1; pg.locator('.gate .btn').click(no_wait_after=True)
            elif pg.locator('.timer').count(): pg.locator('.choice:not(.removed)').first.click(no_wait_after=True)
            elif pg.locator('.stake:not([disabled])').count(): pg.locator('.stake:not([disabled])').first.click(no_wait_after=True, timeout=1500); pg.locator('text=/Lock in/').click(no_wait_after=True, timeout=1500)
            elif pg.locator('.stick-bottom .btn').count(): pg.locator('.stick-bottom .btn').first.click(no_wait_after=True)
            time.sleep(.12)
        else:
            sys.exit('game did not finish')
        time.sleep(.5)
        counts = pg.evaluate("async()=>{const a=window.__app; const out={}; for (const p of await a.repo.listProfiles()) out[p.name]=(await a.repo.listResults(p.id)).length; return out;}")
        print('gates', gates, 'results per player', counts)
        assert gates >= 45 and all(v == 15 for v in counts.values()), counts
        assert not errors, errors
        print('OK'); b.close()
finally:
    srv.terminate()
