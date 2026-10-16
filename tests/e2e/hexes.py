"""Hex cards through the UI: equip, play on yourself, see ink, wipe it. Run: python3 tests/e2e/hexes.py"""
import subprocess, time, sys, os
from playwright.sync_api import sync_playwright
root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
srv = subprocess.Popen(['node', 'scripts/serve.js'], env={'PORT': '5197', 'PATH': os.environ['PATH']}, cwd=root)
time.sleep(1.2)
errors = []
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 390, 'height': 844}); pg.set_default_timeout(6000)
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto('http://localhost:5197/'); pg.wait_for_selector('.menu')
        pg.evaluate("async()=>{const a=window.__app; for (const n of ['Ana','Ben']) { const p = await a.repo.createProfile({name:n}); await a.repo.addCards(p.id, ['ink_blast','goo_splat','quake','blur_out','flip_table','pickpocket','heist','kraken']); }}")
        pg.click('.menu button >> nth=0', no_wait_after=True); time.sleep(.4)
        pg.click('text=Versus', no_wait_after=True)
        for i in range(2): pg.locator('.pick').nth(4 + i).click(no_wait_after=True)
        pg.click('text=Start game', no_wait_after=True); time.sleep(.6)
        pg.wait_for_selector('.slots'); pg.click('.spin-btn', no_wait_after=True); pg.wait_for_function('document.querySelectorAll(".slot.filled").length===5 && !document.querySelector(".slot.reeling .spinning")', timeout=9000); time.sleep(.8)
        time.sleep(1.5); pg.click('text=Start game', no_wait_after=True); time.sleep(1.5)
        # loadout: equip Ink Blast + Heist for Ana (tab 0)
        pg.screenshot(path='/tmp/hex-dbg.png'); print(pg.inner_text('#app')[:300].replace(chr(10),' | '))
        pg.wait_for_selector('.card-tile')
        for _ in range(2): pg.locator('.card-tile').first.evaluate('e=>e.click()'); time.sleep(.2)
        pg.locator('.card-tile', has_text='Ink Blast').first.evaluate('e=>e.click()')
        pg.locator('.card-tile', has_text='Heist').first.evaluate('e=>e.click()')
        pg.screenshot(path='/tmp/hex-loadout.png')
        pg.locator('button', has_text='Ben').first.click(no_wait_after=True)
        for _ in range(2): pg.locator('.card-tile').first.evaluate('e=>e.click()'); time.sleep(.2)
        pg.locator('.card-tile', has_text='Quake').first.evaluate('e=>e.click()')
        pg.locator('.card-tile', has_text='Flip the Table').first.evaluate('e=>e.click()')
        pg.click('text=/Start round|Go|Begin|Start/ >> nth=-1', no_wait_after=True); time.sleep(.8)
        # pass-the-phone gate
        if pg.locator('.gate').count(): pg.locator('.gate .btn').click(no_wait_after=True)
        pg.wait_for_selector('.card-mini')
        pg.screenshot(path='/tmp/hex-stake.png')
        pg.locator('.card-mini', has_text='Ink Blast').click(no_wait_after=True)
        pg.wait_for_selector('.pick'); pg.screenshot(path='/tmp/hex-target.png')
        pg.locator('.pick', has_text='Yourself').click(no_wait_after=True); time.sleep(.5)
        pg.locator('.stake:not([disabled])').first.click(no_wait_after=True); pg.locator('text=/Lock in/').click(no_wait_after=True); time.sleep(.6)
        n = pg.locator('.hex-blot').count(); print('blots', n); assert n >= 3
        pg.screenshot(path='/tmp/hex-ink.png')
        pg.locator('.hex-blot').first.dispatch_event('pointerdown'); time.sleep(.5)
        assert pg.locator('.hex-blot').count() == n - 1
        assert not errors, errors
        print('OK'); b.close()
finally:
    srv.terminate()
