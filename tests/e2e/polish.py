"""Boss HUD and rig, last-bulb pressure, house phases, music, interactive menu bulb, opening lights, bulb pack ritual and the
Fog focus dial. Screenshots go to /tmp/polish-*.png. Run: python3 tests/e2e/polish.py"""
import subprocess, time, sys, os
from playwright.sync_api import sync_playwright
root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
srv = subprocess.Popen(['node', 'scripts/serve.js'], env={'PORT': '5196', 'PATH': os.environ['PATH']}, cwd=root)
time.sleep(1.2)
errors = []
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 390, 'height': 844}); pg.set_default_timeout(8000)
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto('http://localhost:5196/'); pg.wait_for_selector('.menu')
        # opening lights: the room starts dark
        pg.screenshot(path='/tmp/polish-intro.png')
        time.sleep(3.4)
        assert pg.evaluate("getComputedStyle(document.querySelector('.light-dark')).opacity") in ('0', '0.0'), 'lights did not come on'
        # the bulb is a toy: flicker, then break, then it lights back on
        pg.click('.bulb-btn', no_wait_after=True, force=True); time.sleep(.2)
        assert not pg.locator('.bulb-btn.broken').count()
        for _ in range(6): pg.click('.bulb-btn', no_wait_after=True, force=True); time.sleep(.08)
        assert pg.locator('.bulb-btn.broken').count(), 'bulb did not break'
        pg.screenshot(path='/tmp/polish-bulb-broken.png')
        pg.wait_for_function("!document.querySelector('.bulb-btn.broken')", timeout=8000)
        print('bulb: broke and relit')
        # music tracks start and stop without errors
        r = pg.evaluate("""async () => {
          const a = await import('/src/ui/audio.js');
          a.unlockAudio(); a.startMusic('boss'); await new Promise(r => setTimeout(r, 400));
          const k1 = a.musicKind(); a.startMusic('house', { intensity: 2 }); await new Promise(r => setTimeout(r, 600));
          const k2 = a.musicKind(); a.stopMusic(0); return [k1, k2, a.musicKind()];
        }""")
        assert r == ['boss', 'house', None], r
        # stage: last bulb pressure, a miss with each attack, the house changing face
        res = pg.evaluate("""async () => {
          const { createStage } = await import('/src/ui/stage.js');
          const { makeEncounter, advancePhase } = await import('/src/engine/duel.js');
          document.querySelector('#app').replaceChildren();
          const enc = makeEncounter({ kind: 'boss', enemyId: 'house' });
          enc.kind = 'final';
          const st = createStage({ enc, hp: enc.hp, lives: 2, heat: 3, intent: 'strike', enraged: false });
          document.querySelector('#app').append(st.el);
          window.__st = st; window.__enc = enc;
          const out = {};
          out.sprite0 = st.el.querySelector('.rig-body').src.length > 10;
          await st.play({ intent: 'strike', dmg: 0, hpBefore: enc.hp, hpAfter: enc.hp, heal: 0, bulbsLost: 1, over: null, phaseFrom: 0, phaseTo: 0, misses: 0 }, { livesBefore: 2, livesAfter: 1 });
          out.lastBulb = st.root.classList.contains('last-bulb');
          out.pressure = document.documentElement.classList.contains('pressure');
          enc.hp = Math.floor(enc.maxHp * 0.5);
          const ph = advancePhase(enc);
          await st.play({ intent: 'strike', dmg: 4, hpBefore: 20, hpAfter: enc.hp, heal: 0, bulbsLost: 0, over: null, phaseFrom: ph.from, phaseTo: ph.to, crit: false, misses: 0 }, {});
          out.phase1 = enc.sprite;
          enc.hp = 8; const ph2 = advancePhase(enc);
          await st.play({ intent: 'ink', dmg: 5, hpBefore: 17, hpAfter: 8, heal: 0, bulbsLost: 0, over: null, phaseFrom: ph2.from, phaseTo: ph2.to, misses: 0 }, {});
          out.phase2 = enc.sprite; out.parts = st.el.querySelectorAll('.part').length; out.eyes = st.el.querySelectorAll('.eye').length;
          return out;
        }""")
        print('stage', res)
        assert res['lastBulb'] and res['phase1'] == 'boss_house_open' and res['phase2'] == 'boss_jester' and res['parts'] >= 6 and res['eyes'] == 2, res
        pg.screenshot(path='/tmp/polish-jester.png')
        # pack ritual: three taps on the bulb
        pg.goto('http://localhost:5196/'); pg.wait_for_selector('.menu'); time.sleep(3.3)
        r = pg.evaluate("""async () => {
          const { createBulbRite } = await import('/src/ui/bulbrite.js');
          const rite = createBulbRite({ name: 'Gold Pack', from: 'test', light: '#ffd24a' });
          document.body.append(rite.el);
          return rite.el.querySelectorAll('.rite-ring').length;
        }""")
        assert r == 1
        bx = pg.locator('.rite-bulb').bounding_box(); pg.mouse.move(bx['x'] + bx['width'] / 2, bx['y'] + bx['height'] * .6); pg.mouse.down(); time.sleep(1.0)
        pg.screenshot(path='/tmp/polish-rite2.png'); pg.mouse.up()
        # releasing early drains the charge
        time.sleep(1.0); assert float(pg.evaluate("document.querySelector('.rite').style.getPropertyValue('--p')")) < .2
        print('pack rite ok')
        # Fog: trace a circle, or tap four times
        pg.goto('http://localhost:5196/'); pg.wait_for_selector('.menu'); time.sleep(3.3)
        pg.evaluate("""async () => {
          const { fogFocus } = await import('/src/ui/focus.js');
          document.querySelector('#app').replaceChildren();
          for (const id of ['fogA', 'fogB']) {
            const el = document.createElement('div'); el.className = 'choices'; el.id = id;
            for (const t of ['One', 'Two', 'Three', 'Four']) { const c = document.createElement('button'); c.className = 'choice'; c.textContent = t; c.onclick = () => (window.__answered = t); el.append(c); }
            const w = fogFocus(el, {}); w.style.marginBottom = '30px'; document.querySelector('#app').append(w);
          }
          window.__answered = null;
        }""")
        pg.screenshot(path='/tmp/polish-fog.png')
        import math
        seen = set()
        for attempt in range(8):  # the dial hops every quarter of the way, so re-grab it each time
            if not pg.evaluate("document.querySelector('#fogA').classList.contains('hex-blur')"): break
            time.sleep(.35)
            d = pg.locator('.fog-wrap').first.locator('.fog-dial')
            box = d.bounding_box(); cx, cy = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
            seen.add((round(cx / 20), round(cy / 20)))
            pg.mouse.move(cx + 40, cy); pg.mouse.down()
            for i in range(40):
                a = i / 40 * 2 * math.pi * 0.7
                pg.mouse.move(cx + 40 * math.cos(a), cy + 40 * math.sin(a)); time.sleep(.01)
            pg.mouse.up()
        assert len(seen) >= 2, 'the dial never moved'
        assert not pg.evaluate("document.querySelector('#fogA').classList.contains('hex-blur')"), 'circles did not focus'
        for i in range(4): pg.locator('#fogB .choice').first.click(no_wait_after=True, force=True); time.sleep(.1)
        assert not pg.evaluate("document.querySelector('#fogB').classList.contains('hex-blur')"), 'taps did not focus'
        assert pg.evaluate('window.__answered') is None, 'a focus tap answered the question'
        print('fog ok')
        assert not errors, errors
        print('OK'); b.close()
finally:
    srv.terminate()
