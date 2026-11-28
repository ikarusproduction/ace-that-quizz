#!/usr/bin/env python3
"""Builds web/dist/index.html: one self-contained page (content JSON, engine, app, images inlined).
Content comes from Packages/com.pockettoytactics.core/Content, the same files the C# core loads."""
import base64, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
CONTENT = os.path.join(HERE, "..", "Packages", "com.pockettoytactics.core", "Content")

def read(*p):
    with open(os.path.join(*p), encoding="utf-8") as f:
        return f.read()

def b64(name):
    with open(os.path.join(HERE, "assets", name), "rb") as f:
        return base64.b64encode(f.read()).decode("ascii")

troops = json.loads(read(CONTENT, "troops.json"))
terrains = [json.loads(read(CONTENT, "terrains", f)) for f in sorted(os.listdir(os.path.join(CONTENT, "terrains")))]
# Reference terrains first in rulebook order, then the originals.
order = ["castle_plain", "tropical_pool", "cloud_city", "volcano_jungle", "cursed_graveyard", "pirate_sea",
         "metalx_station", "battlefield", "toy_train", "bouncy_fair"]
terrains.sort(key=lambda t: order.index(t["id"]) if t["id"] in order else 99)
data = {
    "troops": troops,
    "terrains": terrains,
    "images": {t["id"]: b64(t["id"] + ".webp") for t in troops["troops"]},
    "keyart": b64("keyart.webp"),
}
blob = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
page = read(HERE, "src", "index.html")
for key, code in (("/*__CONTENT__*/", "window.PTT_DATA=" + blob + ";"),
                  ("/*__ENGINE__*/", read(HERE, "src", "engine.js")),
                  ("/*__APP__*/", read(HERE, "src", "app.js"))):
    assert "</script" not in code.lower()
    page = page.replace(key, code)
os.makedirs(os.path.join(HERE, "dist"), exist_ok=True)
out = os.path.join(HERE, "dist", "index.html")
with open(out, "w", encoding="utf-8") as f:
    f.write(page)
print(out, len(page) // 1024, "KB")
