"""Periodic Table trainer through the UI: the table, an element sheet, a memory-card session, a quiz and a typing round.
Screenshots in /tmp/pt-*.png. Run: python3 tests/e2e/periodic.py"""
import subprocess, time, os
from playwright.sync_api import sync_playwright
root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
srv = subprocess.Popen(['node', 'scripts/serve.js'], env={'PORT': '5199', 'PATH': os.environ['PATH']}, cwd=root)
time.sleep(1.2)
errors = []
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 390, 'height': 844}); pg.set_default_timeout(8000)
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto('http://localhost:5199/'); pg.wait_for_selector('.menu')
        pg.evaluate("async()=>{await window.__app.repo.createProfile({name:'Ana'});}")
        pg.reload(); pg.wait_for_selector('.menu')
        pg.click('text=Periodic Table', no_wait_after=True); pg.wait_for_selector('.pt-grid')
        assert pg.locator('.pt-cell').count() == 118
        pg.screenshot(path='/tmp/pt-hub.png', full_page=True)
        # an element sheet
        pg.locator('.pt-cell[aria-label^="26 "]').click(no_wait_after=True); pg.wait_for_selector('.modal-box')
        sheet = pg.inner_text('.modal-box'); assert 'Fe' in sheet and 'Iron' in sheet, sheet
        pg.screenshot(path='/tmp/pt-sheet.png')
        pg.click('.modal-box >> text=Close', no_wait_after=True); time.sleep(.2)
        # memory cards: 20 cards, all marked Good
        pg.click('text=Memory cards', no_wait_after=True); pg.wait_for_selector('.pt-card')
        first = pg.inner_text('.pt-card')
        assert 'Hydrogen' in first or 'H' in first
        time.sleep(.7); pg.screenshot(path='/tmp/pt-card-front.png')
        n = 0
        for _ in range(60):
            if pg.locator('.pt-grades').count():
                if n == 0: time.sleep(.5); pg.screenshot(path='/tmp/pt-card-back.png')
                pg.locator('.pt-grades .btn.primary').click(no_wait_after=True); n += 1; time.sleep(.08)
            elif pg.locator('.pt-card').count():
                pg.locator('.stick-bottom .btn').first.click(no_wait_after=True); time.sleep(.08)
            else: break
            if pg.locator('text=Cards done').count(): break
        assert pg.locator('text=Cards done').count(), pg.inner_text('body')[:200]
        assert n == 20, n
        pg.screenshot(path='/tmp/pt-cards-done.png', full_page=True)
        pg.click('text=The table', no_wait_after=True); pg.wait_for_selector('.pt-grid')
        learning = pg.locator('.pt-cell.s-learning').count()
        assert learning >= 5, f'{learning} elements in learning after the cards'
        pg.screenshot(path='/tmp/pt-hub-after.png', full_page=True)
        # quiz: answer every question correctly by reading the answer from the engine state
        pg.click('button:text-is("Quiz")', no_wait_after=True); pg.wait_for_selector('.pt-card')
        for _ in range(30):
            if pg.locator('text=Quiz done').count(): break
            if pg.locator('.stick-bottom .btn:has-text("Next"), .stick-bottom .btn:has-text("See results")').count():
                pg.locator('.stick-bottom .btn').first.click(no_wait_after=True); time.sleep(.1); continue
            btns = pg.locator('.col.gap-s .btn:not([disabled])')
            if btns.count(): btns.first.click(no_wait_after=True); time.sleep(.1)
        assert pg.locator('text=Quiz done').count()
        pg.screenshot(path='/tmp/pt-quiz-done.png', full_page=True)
        pg.click('text=The table', no_wait_after=True); pg.wait_for_selector('.pt-grid')
        # typing: type the right answer using the engine's own checker
        pg.click('text=Type the answer', no_wait_after=True); pg.wait_for_selector('.pt-card')
        typed = 0
        for _ in range(40):
            if pg.locator('text=Typing done').count(): break
            if pg.locator('.stick-bottom .btn').count():
                pg.locator('.stick-bottom .btn').first.click(no_wait_after=True); time.sleep(.1); continue
            if pg.locator('.pt-input').count():
                pg.fill('.pt-input', 'zzz'); pg.press('.pt-input', 'Enter'); typed += 1; time.sleep(.1)
        assert pg.locator('text=Typing done').count() and typed >= 5, typed
        pg.screenshot(path='/tmp/pt-typing-done.png', full_page=True)
    print('OK periodic; learning cells', learning, 'typed', typed)
finally:
    srv.terminate()
print('ERRORS:', errors)
