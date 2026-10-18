"""Friends through the UI on the PHP site layout: two phones swap codes, add each other, compare stats.
Run: python3 tests/e2e/friends.py"""
import subprocess, time, sys, os, tempfile, shutil, json
from playwright.sync_api import sync_playwright
root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PORT = '8798'
site = tempfile.mkdtemp(prefix='thk-site-')
play = os.path.join(site, 'play'); os.makedirs(os.path.join(play, 'api'))
for f in ('index.html', 'manifest.webmanifest', 'sw.js', 'icon.svg'): shutil.copy(os.path.join(root, f), play)
for d in ('src', 'data'): shutil.copytree(os.path.join(root, d), os.path.join(play, d))
shutil.copy(os.path.join(root, 'server/php/index.php'), os.path.join(play, 'api/index.php'))
open(os.path.join(play, 'api/config.php'), 'w').write("<?php return ['access_hash' => ''];")
open(os.path.join(play, 'config.json'), 'w').write(json.dumps({'relay': '/play/api/index.php', 'gate': False}))
srv = subprocess.Popen(['php', '-S', f'127.0.0.1:{PORT}', '-t', site], env={**os.environ, 'PHP_CLI_SERVER_WORKERS': '8'}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.2)
BASE = f'http://127.0.0.1:{PORT}/play/'
errors = []
def phone(b, name):
    ctx = b.new_context(viewport={'width': 390, 'height': 844}); pg = ctx.new_page(); pg.set_default_timeout(8000)
    pg.on('console', lambda m: errors.append((name, m.text)) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    pg.on('pageerror', lambda e: errors.append((name, str(e))))
    pg.goto(BASE); pg.wait_for_selector('.menu')
    pg.evaluate("async(n)=>{await window.__app.repo.createProfile({name:n});}", name)
    # give them a little history so the comparison has something to show
    pg.evaluate("""async()=>{const a=window.__app; const p=(await a.repo.listProfiles())[0];
      const cats=['science','history','geography','arts']; let i=0;
      for (const c of cats) for (let k=0;k<6;k++) await a.repo.storage.transact([{op:'put',store:'results',value:{resultId:'r'+(i++)+p.id,playerId:p.id,sessionId:'s1',questionId:'q'+i,category:c,difficulty:2,correct:k%3!==0,timestamp:Date.now()+i}}]);
      await a.repo.storage.transact([{op:'put',store:'sessions',value:{sessionId:'s1',mode:'solo',variant:'rush',status:'completed',startedAt:1,endedAt:2,players:[{playerId:p.id,result:'won',score:640,longestStreak:5,bossesCleared:1}]}}]);}""")
    return pg
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        ana, ben = phone(b, 'Ana'), phone(b, 'Ben')
        codes = {}
        for name, pg in (('Ana', ana), ('Ben', ben)):
            pg.locator('.menu button', has_text='compare stats').click(no_wait_after=True); pg.wait_for_selector('.code-box')
            time.sleep(1.2)
            codes[name] = pg.inner_text('.code-box').strip(); print(name, codes[name])
        ana.screenshot(path='/tmp/friends-list.png', full_page=True)
        ana.fill('input[aria-label="Friend code"]', codes['Ben'].lower()); ana.click('button:text-is("Add")', no_wait_after=True)
        ana.wait_for_selector('.friend-row'); print('FRIEND ROW:', ana.inner_text('.friend-row').replace(chr(10), ' | '))
        ana.click('button:text-is("Compare")', no_wait_after=True); ana.wait_for_selector('.cmp'); time.sleep(.4)
        ana.screenshot(path='/tmp/friends-compare.png', full_page=True)
        print('COMPARE:', ana.inner_text('.panel >> nth=0').replace(chr(10), ' | ')[:160])
        # the friends list is part of the profile data, so it survives a reload
        ana.reload(); ana.wait_for_selector('.menu'); ana.locator('.menu button', has_text='compare stats').click(no_wait_after=True); ana.wait_for_selector('.friend-row')
        assert ana.locator('.friend-row').count() == 1
        # bad and own codes
        ana.fill('input[aria-label="Friend code"]', codes['Ana']); ana.click('button:text-is("Add")', no_wait_after=True); time.sleep(.5)
        assert 'your own code' in ana.inner_text('body').lower(), ana.inner_text('body')[:300]
        ana.fill('input[aria-label="Friend code"]', 'ZZZZ-ZZZZ'); ana.click('button:text-is("Add")', no_wait_after=True); time.sleep(.6)
        assert 'nobody has that' in ana.inner_text('body').lower()
        b.close()
finally:
    srv.terminate(); shutil.rmtree(site, ignore_errors=True)
print('ERRORS:', errors)
sys.exit(1 if errors else 0)
