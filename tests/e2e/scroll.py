"""mount() keeps the scroll position when a screen is rebuilt (another player's move must never throw you to the top).
Run: python3 tests/e2e/scroll.py"""
import subprocess, time, os
from playwright.sync_api import sync_playwright
root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
srv = subprocess.Popen(['node', 'scripts/serve.js'], env={'PORT': '5189', 'PATH': os.environ['PATH']}, cwd=root)
time.sleep(1.2)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(viewport={'width': 390, 'height': 700})
        pg.goto('http://localhost:5189/'); pg.wait_for_selector('.menu')
        r = pg.evaluate("""async () => {
          const { mount, h } = await import('/src/ui/dom.js');
          const box = document.createElement('div'); document.body.replaceChildren(box);
          const tall = () => h('div', { style: { height: '3000px' } }, 'x');
          mount(box, tall()); window.scrollTo(0, 900);
          const before = window.scrollY;
          mount(box, tall());
          return [before, window.scrollY];
        }""")
        print(r); assert r[0] == 900 and r[1] == 900, r
        print('OK'); b.close()
finally:
    srv.terminate()
