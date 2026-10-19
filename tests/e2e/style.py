"""Level, XP and the dust wardrobe through the UI. Run: python3 tests/e2e/style.py"""
import subprocess, time, os
from playwright.sync_api import sync_playwright
root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
srv = subprocess.Popen(['node', 'scripts/serve.js'], env={'PORT': '5198', 'PATH': os.environ['PATH']}, cwd=root)
time.sleep(1.2)
errors = []
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 390, 'height': 844}); pg.set_default_timeout(6000)
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto('http://localhost:5198/'); pg.wait_for_selector('.menu'); time.sleep(.5)
        r = pg.evaluate("""async () => {
          const a = window.__app; const p = await a.repo.createProfile({ name: 'Ana' });
          const x = await a.repo.addXp(p.id, 's1', 500); const again = await a.repo.addXp(p.id, 's1', 500);
          const prof = await a.repo.getProfile(p.id); prof.hexes = { ...prof.hexes, dust: 400 };
          await a.repo.storage.transact([{ op: 'put', store: 'profiles', value: prof }]);
          return { x, again: again.gained };
        }""")
        print(r); assert r['x']['after'] >= 3 and r['again'] == 0
        pg.click('.menu button:has-text("Hexes")', no_wait_after=True); time.sleep(.6)
        pg.click('.tab:has-text("Style")', no_wait_after=True); time.sleep(.4)
        pg.screenshot(path='/tmp/style-tab.png')
        pg.locator('.ward:has-text("Amber Glow")').click(no_wait_after=True); time.sleep(.5)
        pg.locator('.ward:has-text("Spotlight")').click(no_wait_after=True); time.sleep(.5)
        pg.locator('.ward:has-text("Flat Cap")').click(no_wait_after=True); time.sleep(.5)
        pg.locator('.ward:has-text("Embers")').click(no_wait_after=True); time.sleep(.5)
        assert pg.locator('.lvl-card .av-wrap.fr-amber.bg-spot .av-hat').count() == 1
        # dust is the only gate: Gold Leaf (280) was buyable at level 5, but after spending only 90 dust is left
        assert pg.locator('.ward:has-text("Gold Leaf")').first.is_disabled(), 'not enough dust left'
        assert pg.locator('.ward:has-text("House Seal")').first.is_disabled(), 'too expensive for the dust left'
        pg.evaluate('window.scrollTo(0,0)'); pg.screenshot(path='/tmp/style-top.png')
        d = pg.evaluate("async()=>{const a=window.__app; const ps=await a.repo.listProfiles(); const m=await a.repo.getMeta(ps[0].id); return [m.hexes.dust, m.cos.owned.length]}")
        print('dust/owned', d); assert d[0] < 400 and d[1] == 4
        assert not errors, errors
        print('OK'); b.close()
finally:
    srv.terminate()
