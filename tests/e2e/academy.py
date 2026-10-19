"""Champion's Academy: every module end to end, the plan, the timer, insights, library, persistence and the boss.
Screenshots in /tmp/academy-*.png. Run: python3 tests/e2e/academy.py"""
import subprocess, time, os, re
from playwright.sync_api import sync_playwright
root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
srv = subprocess.Popen(['node', 'scripts/serve.js'], env={'PORT': '5191', 'PATH': os.environ['PATH']}, cwd=root)
time.sleep(1.2)
errors = []
CORRECT = """(wrong) => {
  const app = window.__app;
  const text = document.querySelector('#app').innerText;
  const q = [...app.bank.questions, ...app.bank.variants].find((x) => text.includes(x.question) && x.choices.every((c) => text.includes(String(c))));
  if (!q) return 'noq';
  const want = String(q.choices[q.answer]);
  const els = [...document.querySelectorAll('.choice:not(:disabled)')];
  const el = wrong ? els.find((c) => !c.innerText.includes(want)) : els.find((c) => c.innerText.includes(want));
  if (!el) return 'nochoice';
  el.click(); return 'ok';
}"""

def play(pg, wrong=False, limit=400, until='.learn-sum'):
    for _ in range(limit):
        if pg.locator(until).count(): return
        if pg.locator('.choice:not(:disabled)').count():
            r = pg.evaluate(CORRECT, wrong); assert r == 'ok', r; time.sleep(.12); continue
        if pg.locator('.stick-bottom .btn:has-text("Continue"), .stick-bottom .btn:has-text("See result")').count():
            pg.locator('.stick-bottom .btn:has-text("Continue"), .stick-bottom .btn:has-text("See result")').first.click(no_wait_after=True); time.sleep(.15); continue
        time.sleep(.2)
    pg.screenshot(path='/tmp/academy-stuck.png'); print(pg.inner_text('#app')[:600]); raise AssertionError('session did not finish')

def acad(pg):
    return pg.evaluate("async()=>{const a=window.__app; const [p]=await a.repo.listProfiles(); const m=await a.repo.getMeta(p.id); return {n:m.acad.answers.length, sessions:m.acad.sessions.map(s=>s.mode), achv:Object.keys(m.acad.achv), plan:m.acad.plan.id, timer:m.acad.timer, items:Object.keys(m.learn.items).length, packs:p.packs.map(k=>k.type), timed:m.acad.answers.filter(a=>a.timed).length, ms:m.acad.answers.filter(a=>a.ms!=null).length}}")

def back(pg):
    pg.click('.btn:text-is("Back")', no_wait_after=True); pg.wait_for_selector('.mode-card')

def clues(pg, answer_first=True):
    for _ in range(40):
        if pg.locator('.learn-sum').count() or pg.locator('.big-score').count(): return
        if pg.locator('.stick-bottom .btn:has-text("Next puzzle"), .stick-bottom .btn:has-text("See result")').count():
            pg.locator('.stick-bottom .btn:has-text("Next puzzle"), .stick-bottom .btn:has-text("See result")').first.click(no_wait_after=True); time.sleep(.2); continue
        ok = pg.evaluate("""async()=>{const f=await window.__app.readJson('data/academy/clues.json'); const items=f.items||f; const txt=document.querySelector('#app').innerText;
          const it=items.find(i=>(i.clues||[]).some(c=>txt.includes(c.en)||txt.includes(c.fr||'@@'))); if(!it) return 'none';
          const ans=[it.answer.en, it.answer.fr].filter(Boolean); const el=[...document.querySelectorAll('.choice:not(:disabled)')].find(c=>ans.some(a=>c.innerText.trim()===a)); if(!el) return 'noel'; el.click(); return 'ok'}""")
        assert ok == 'ok', ok
        time.sleep(.2)
    raise AssertionError('clues did not finish')

try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 390, 'height': 844}); pg.set_default_timeout(8000)
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto('http://localhost:5191/'); pg.wait_for_selector('.menu')
        pg.evaluate("async()=>{await window.__app.repo.createProfile({name:'Ana'}); await window.__app.repo.createProfile({name:'Ben'});}")
        pg.reload(); pg.wait_for_selector('.menu'); time.sleep(3.8)
        pg.click('.menu button:has-text("Champion")', no_wait_after=True); pg.wait_for_selector('.mode-card'); time.sleep(.4)
        pg.screenshot(path='/tmp/academy-hub.png')
        assert 'Daily Knowledge Workout' in pg.inner_text('#app') and 'Beat the Champion' in pg.inner_text('#app')
        assert acad(pg)['n'] == 0
        # insights with nothing recorded say so instead of inventing numbers
        pg.click('.btn:text-is("Insights")', no_wait_after=True); pg.wait_for_selector('text=Nothing recorded yet')
        pg.click('.topbar .back, .back', no_wait_after=True); pg.wait_for_selector('.mode-card')
        # the daily workout, answered wrongly on purpose so there is something to learn
        pg.click('.btn:text-is("Start")', no_wait_after=True); pg.wait_for_selector('.qcard')
        pg.screenshot(path='/tmp/academy-q.png')
        play(pg, wrong=True)
        print('workout:', pg.inner_text('.panel.center').replace(chr(10), ' | '))
        st = acad(pg); print(st); assert st['n'] == 8 and st['sessions'] == ['workout'] and st['items'] >= 6 and 'bronze' in st['packs'], st
        pg.screenshot(path='/tmp/academy-done.png')
        back(pg)
        # timer on: rapid fire records the speed of every answer
        pg.click('.chip:has-text("Timer: off")', no_wait_after=True); pg.wait_for_selector('.chip:has-text("Timer: on")')
        pg.locator('.mode-card:has(b:text-is("Rapid Fire"))').click(no_wait_after=True); pg.wait_for_selector('.qcard'); pg.wait_for_selector('.q-timer')
        play(pg)
        st = acad(pg); print(st); assert st['sessions'][-1] == 'rapid' and st['timed'] > 0 and st['ms'] > 0, st
        back(pg)
        for name, mode in [('Associations', 'assoc'), ('Precision', 'trick'), ('Dates and Chronology', 'chrono')]:
            pg.locator(f'.mode-card:has-text("{name}")').first.click(no_wait_after=True); pg.wait_for_selector('.qcard, .panel.inset')
            if pg.locator('.qcard').count():
                play(pg); assert acad(pg)['sessions'][-1] == mode
                print(mode, pg.inner_text('.panel.center').replace(chr(10), ' | ')); back(pg)
            else:
                print(mode, 'empty:', pg.inner_text('.panel.inset')); pg.click('.btn:text-is("Back")', no_wait_after=True); pg.wait_for_selector('.mode-card')
        # progressive clues
        pg.locator('.mode-card:has-text("Progressive Clues")').click(no_wait_after=True); pg.wait_for_selector('.clue')
        pg.screenshot(path='/tmp/academy-clue.png')
        clues(pg)
        txt = pg.inner_text('#app'); print('clues:', txt[:200].replace(chr(10), ' | '))
        assert 'clues' in acad(pg)['sessions']
        back(pg)
        # the examination: no hints, report with the four measures kept apart
        pg.locator('.mode-card:has-text("Champion Examination")').click(no_wait_after=True); pg.wait_for_selector('.qcard')
        assert pg.locator('.hint, button:has-text("Hint")').count() == 0
        play(pg)
        txt = pg.inner_text('#app'); assert 'Examination report' in txt and 'Delayed retention' in txt and 'Transfer' in txt, txt[:600]
        pg.screenshot(path='/tmp/academy-exam.png')
        back(pg)
        # plan
        pg.click('.chip:has-text("Plan:")', no_wait_after=True); pg.wait_for_selector('text=Training plan')
        pg.locator('.mode-card:has-text("Science and nature")').click(no_wait_after=True); time.sleep(.2)
        pg.screenshot(path='/tmp/academy-plan.png')
        pg.click('.btn:text-is("Save plan")', no_wait_after=True); pg.wait_for_selector('.btn:text-is("Insights")')
        assert acad(pg)['plan'] == 'sciencenature'
        # insights now exist and keep the four measures apart; no single mastery figure
        pg.click('.btn:text-is("Insights")', no_wait_after=True); pg.wait_for_selector('.stat-grid')
        t = pg.inner_text('#app')
        for needle in ['Game results', 'Independent recall', 'Delayed retention', 'Transfer', 'Accuracy by subject', 'Confidence calibration', 'Hint dependence']: assert needle in t, needle
        assert 'mastery percentage' in t.lower() and not re.search(r'mastery:\s*\d+%', t.lower()), t[:900]
        pg.screenshot(path='/tmp/academy-insights.png')
        pg.click('.back', no_wait_after=True); pg.wait_for_selector('.mode-card')
        # library: timeline and connections
        pg.click('.btn:text-is("Library")', no_wait_after=True); pg.wait_for_selector('.timeline')
        assert pg.locator('.tl-row').count() > 30
        pg.click('.chip:text-is("Connections")', no_wait_after=True); pg.wait_for_selector('table.comp')
        pg.screenshot(path='/tmp/academy-library.png')
        pg.click('.back', no_wait_after=True); pg.wait_for_selector('.mode-card')
        # persistence and profile isolation across a reload
        before = acad(pg); pg.reload(); pg.wait_for_selector('.menu'); time.sleep(.5)
        after = acad(pg); assert after['n'] == before['n'] and after['plan'] == 'sciencenature' and after['timer'] is True, (before, after)
        other = pg.evaluate("async()=>{const a=window.__app; const ps=await a.repo.listProfiles(); const m=await a.repo.getMeta(ps[1].id); return m.acad.answers.length}")
        assert other == 0, 'the other player must not see these answers'
        # the boss
        pg.click('.menu button:has-text("Champion")', no_wait_after=True); pg.wait_for_selector('.mode-card')
        pg.locator('.mode-card:has-text("Beat the Champion")').click(no_wait_after=True)
        pg.wait_for_selector('text=/Face the Reigning Champion/i', timeout=15000); time.sleep(.6)
        assert 'reigning champion' in pg.inner_text('#app').lower()
        pg.locator('.stick-bottom .btn.primary').first.click(no_wait_after=True); pg.wait_for_selector('.qcard', timeout=15000)
        pg.screenshot(path='/tmp/academy-boss.png')
        print('OK academy flow; console errors:', errors)
        assert not errors, errors
finally:
    srv.terminate()
