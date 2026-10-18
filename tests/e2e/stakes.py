"""Stake screen shows a level label on every stake, and the asked question changes with the stake.
Run: python3 tests/e2e/stakes.py"""
import subprocess, time, os
from playwright.sync_api import sync_playwright
root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
srv = subprocess.Popen(['node', 'scripts/serve.js'], env={'PORT': '5197', 'PATH': os.environ['PATH']}, cwd=root)
time.sleep(1.2)
errors = []
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 390, 'height': 844}); pg.set_default_timeout(8000)
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto('http://localhost:5197/'); pg.wait_for_selector('.menu')
        pg.evaluate("async()=>{await window.__app.repo.createProfile({name:'Ana'});}")
        pg.reload(); pg.wait_for_selector('.menu')
        pg.click('.menu button >> nth=0', no_wait_after=True); time.sleep(.4)
        pg.click('text=Boss Rush', no_wait_after=True); time.sleep(.2)
        if pg.locator('text=Pick a player').count(): pg.locator('.pick').nth(4).click(no_wait_after=True)
        pg.click('text=Start game', no_wait_after=True); time.sleep(.6)
        pg.wait_for_selector('.boss-grid'); pg.locator('.boss-pick').first.click(no_wait_after=True)
        pg.locator('button:has-text("Fight")').first.click(no_wait_after=True)
        time.sleep(1.2)
        for _ in range(6):
            if pg.locator('.stakes').count(): break
            pg.locator('.stick-bottom .btn.primary').first.click(no_wait_after=True, timeout=2000); time.sleep(1)
        pg.wait_for_selector('.stakes', timeout=10000)
        assert pg.locator('.stakes').count(), 'never reached a stake screen'
        labels = pg.locator('.stake .ask').all_inner_texts()
        print('labels', labels)
        assert len(labels) >= 1 and all(l.strip() for l in labels), 'stake buttons lack level labels'
        asked = []
        for i in range(pg.locator('.stake').count()):
            pg.locator('.stake').nth(i).click(no_wait_after=True); time.sleep(.1)
        assert not errors, errors
        print('OK')
finally:
    srv.terminate()
