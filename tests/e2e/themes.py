"""Theme picker e2e: pick 5 themes by tapping, spin random, start a solo game, and check every question of round 1 comes from the chosen themes.
Run: python3 tests/e2e/themes.py   (needs Python Playwright + Chromium)"""
import subprocess, time, sys, os, json
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
        pg.evaluate("async()=>{await window.__app.repo.createProfile({name:'Ana'});}")
        pg.click('.menu button >> nth=0', no_wait_after=True); time.sleep(.4)
        pg.click('text=Solo run', no_wait_after=True); time.sleep(.2)
        pg.locator('.pick').nth(4).click(no_wait_after=True)
        pg.click('text=Start game', no_wait_after=True)
        pg.wait_for_selector('.slots')
        # clear all slots, then tap five themes (including a repeat)
        for i in range(5): pg.locator('.slot.filled').first.click(no_wait_after=True)
        for t in ['f1', 'cooking', 'manga', 'hockey', 'f1']:
            pg.locator(f'.theme[data-theme="{t}"]').click(no_wait_after=True); time.sleep(.05)
        assert pg.locator('.slot.filled').count() == 5
        pg.screenshot(path='/tmp/themes.png')
        # random spin fills all five
        pg.click('.spin-btn', no_wait_after=True)
        pg.wait_for_function('document.querySelectorAll(".slot.filled").length===5 && !document.querySelector(".slot.reeling")', timeout=12000)
        # go back to deterministic picks and start
        for i in range(5): pg.locator('.slot.filled').first.click(no_wait_after=True)
        for t in ['f1', 'cooking', 'manga', 'hockey', 'finance']:
            pg.locator(f'.theme[data-theme="{t}"]').click(no_wait_after=True); time.sleep(.05)
        pg.click('text=Start game', no_wait_after=True); time.sleep(1.2)
        st = pg.evaluate("()=>{const g=window.__app.current; return null}")
        saved = pg.evaluate("async()=>{const a=window.__app; const g=await a.repo.loadActiveGame(); return {themes:g.config.themes, cats:g.round.slots.map(s=>a.ctx.byId.get(s.questionId).category), th:g.round.slots.map(s=>s.theme)}}")
        print(saved)
        assert sorted(saved['cats']) == sorted(['f1', 'cooking', 'manga', 'hockey', 'finance']), saved
        assert not errors, errors
        print('OK'); b.close()
finally:
    srv.terminate()
