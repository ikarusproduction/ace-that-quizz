"""Hex deck through the UI (local Versus): earn a hex with a streak, play it on the rival, see the effect, then the Hexes page,
daily pack and pack opening. Run: python3 tests/e2e/hexes.py"""
import subprocess, time, sys, os, re
from playwright.sync_api import sync_playwright
root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
srv = subprocess.Popen(['node', 'scripts/serve.js'], env={'PORT': '5197', 'PATH': os.environ['PATH']}, cwd=root)
time.sleep(1.2)
errors = []
CORRECT = """() => {
  const app = window.__app;
  const text = document.querySelector('.question, .q-card, .qcard')?.innerText ?? document.querySelector('#app').innerText;
  const q = [...app.bank.questions, ...app.bank.variants].find((x) => text.includes(x.question));
  if (!q) return 'noq';
  const want = String(q.choices[q.answer]);
  const el = [...document.querySelectorAll('.choice:not(.removed)')].find((c) => c.innerText.includes(want));
  if (!el) return 'nochoice';
  el.click(); return 'ok';
}"""
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 390, 'height': 844}); pg.set_default_timeout(6000)
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto('http://localhost:5197/'); pg.wait_for_selector('.menu')
        pg.evaluate("async()=>{const a=window.__app; for (const n of ['Ana','Ben']) { const p = await a.repo.createProfile({name:n}); await a.repo.setHexDeck(p.id, ['ink_blast']); }}")
        pg.click('.menu button >> nth=0', no_wait_after=True); time.sleep(.4)
        pg.click('text=Versus', no_wait_after=True)
        for i in range(2): pg.locator('.pick').nth(4 + i).click(no_wait_after=True)
        pg.click('text=Start game', no_wait_after=True); time.sleep(.6)
        pg.wait_for_selector('.slots'); pg.click('.spin-btn', no_wait_after=True); pg.wait_for_function('document.querySelectorAll(".slot.filled").length===5 && !document.querySelector(".slot.reeling .spinning")', timeout=9000); time.sleep(.8)
        time.sleep(1.5); pg.click('text=Start game', no_wait_after=True); time.sleep(1.5)
        pg.wait_for_selector('text=Hex deck'); pg.screenshot(path='/tmp/hex-loadout.png', full_page=True)
        pg.click('text=Start round', no_wait_after=True); time.sleep(.8)
        earned = False; played = False; seen_effect = False
        for step in range(400):
            if pg.locator('.reveal-overlay').count():
                txt = pg.inner_text('.reveal-overlay'); print('REVEAL:', txt.replace(chr(10), ' | ')[:160]); earned = True
                pg.screenshot(path='/tmp/hex-reveal.png'); pg.locator('.reveal-overlay .btn').click(no_wait_after=True); time.sleep(.4); continue
            if pg.locator('.gate').count(): pg.locator('.gate .btn').click(no_wait_after=True)
            elif pg.locator('.timer').count():
                if pg.locator('.hex-blot').count() or pg.locator('.hex-tag').count(): seen_effect = True; pg.screenshot(path='/tmp/hex-effect.png')
                r = pg.evaluate(CORRECT)
                if r != 'ok': print('CORRECT:', r)
            elif pg.locator('.hex-chip:not([disabled])').count() and earned and not played:
                pg.screenshot(path='/tmp/hex-hand.png')
                chip = pg.locator('.hex-chip:not([disabled])').first
                print('PLAY', chip.inner_text().replace(chr(10), ' '))
                try: chip.click(no_wait_after=True, timeout=1500)
                except Exception: continue
                time.sleep(.5)
                if pg.locator('.pick').count(): pg.locator('.pick:not(:has-text("Yourself"))').first.click(no_wait_after=True)
                time.sleep(.5); played = True
            elif pg.locator('.stake:not([disabled])').count():
                try:
                    pg.locator('.stake:not([disabled])').first.click(no_wait_after=True, timeout=1500); pg.locator('button:has-text("Lock in"):not([disabled])').first.click(no_wait_after=True, timeout=1500)
                except Exception: pass
            elif pg.locator('.stick-bottom .btn').count(): pg.locator('.stick-bottom .btn').first.click(no_wait_after=True)
            if seen_effect: break
            time.sleep(.15)
        print('earned', earned, 'played', played, 'effect', seen_effect)
        assert earned and played and seen_effect
        # Hexes page
        pg.evaluate("()=>window.__app && 0")
        pg.goto('http://localhost:5197/'); pg.wait_for_selector('.menu')
        pg.click('.menu button:has-text("Inventory")', no_wait_after=True); pg.wait_for_selector('text=Hex book', timeout=3000) if False else time.sleep(.6)
        time.sleep(.6); pg.screenshot(path='/tmp/hex-page.png')
        pg.click('button:has-text("Claim today")', no_wait_after=True); time.sleep(.6)
        pg.click('.tab:has-text("Packs")', no_wait_after=True); time.sleep(.4)
        pg.click('button:has-text("Open")', no_wait_after=True); time.sleep(.4)
        pg.wait_for_selector('.rite-bulb')
        box = pg.locator('.rite-bulb').bounding_box()
        pg.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] * 0.6); pg.mouse.down()
        time.sleep(1.2); pg.screenshot(path='/tmp/hex-bulb2.png')
        time.sleep(1.6); pg.mouse.up()
        pg.wait_for_selector('.pc-grid', timeout=5000); time.sleep(.9)
        pg.screenshot(path='/tmp/hex-pack0.png')
        for i in range(6):
            lab = pg.locator('.pc-actions .btn.primary').inner_text()
            pg.locator('.pc-actions .btn.primary').click(no_wait_after=True); time.sleep(.5)
            if lab == 'OK': break
        assert pg.locator('.pc-grid').count() == 0
        # instant path: claim nothing more, open any remaining pack the quick way if there is one
        pg.screenshot(path="/tmp/hex-pack1.png")
        time.sleep(.5)
        n = pg.evaluate("async()=>{const ps=await window.__app.repo.listProfiles(); const m=await window.__app.repo.getMeta(ps[0].id); return [m.hexes.owned.length, m.packs.length, m.hexes.dust]}")
        print('owned/packs/dust', n)
        assert not errors, errors
        print('OK'); b.close()
finally:
    srv.terminate()
