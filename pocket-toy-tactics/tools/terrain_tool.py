#!/usr/bin/env python3
"""Pocket Toy Tactics - terrain validator and SVG renderer.

Usage:
    python3 tools/terrain_tool.py validate [terrain.json ...]
    python3 tools/terrain_tool.py render <out_dir> [terrain.json ...]

With no file arguments, every file in Packages/com.pockettoytactics.core/Content/terrains is used.

Checks performed by `validate`:
  * ids are unique, edges reference existing nodes, no duplicate or self edges
  * the straight-line drawing is planar (no crossing paths, no node lying on a path)
  * the graph is connected
  * every region lists only bases/special bases (an HQ is not a base) and its bases,
    in the given order, form a bounded face of the planar drawing
  * total medals <= 16 (the physical game ships 16 medal tokens)
  * medal goals exist for each side owning an HQ
  * reports whether the board is symmetric under a 180 degree rotation
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DIR = os.path.join(HERE, "..", "Packages", "com.pockettoytactics.core", "Content", "terrains")
MAX_MEDALS = 16


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _orient(a, b, c):
    v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    return 0 if abs(v) < 1e-9 else (1 if v > 0 else -1)


def _on_segment(a, b, p):
    return (min(a[0], b[0]) - 1e-9 <= p[0] <= max(a[0], b[0]) + 1e-9 and
            min(a[1], b[1]) - 1e-9 <= p[1] <= max(a[1], b[1]) + 1e-9 and _orient(a, b, p) == 0)


def _segments_cross(p1, p2, p3, p4):
    o1, o2, o3, o4 = _orient(p1, p2, p3), _orient(p1, p2, p4), _orient(p3, p4, p1), _orient(p3, p4, p2)
    return o1 * o2 < 0 and o3 * o4 < 0


def faces(nodes, edges):
    """Return the faces of a planar straight-line embedding as lists of node ids."""
    pos = {n["id"]: (n["x"], n["y"]) for n in nodes}
    nbrs = {n["id"]: [] for n in nodes}
    for a, b in edges:
        nbrs[a].append(b)
        nbrs[b].append(a)
    for v in nbrs:
        nbrs[v].sort(key=lambda w: math.atan2(pos[w][1] - pos[v][1], pos[w][0] - pos[v][0]))
    seen = set()
    result = []
    for a, b in edges:
        for start in ((a, b), (b, a)):
            if start in seen:
                continue
            face = []
            u, v = start
            while (u, v) not in seen:
                seen.add((u, v))
                face.append(u)
                lst = nbrs[v]
                i = lst.index(u)
                w = lst[(i - 1) % len(lst)]
                u, v = v, w
            result.append(face)
    return result


def signed_area(face, pos):
    s = 0.0
    for i in range(len(face)):
        x1, y1 = pos[face[i]]
        x2, y2 = pos[face[(i + 1) % len(face)]]
        s += x1 * y2 - x2 * y1
    return s / 2


def same_cycle(a, b):
    if len(a) != len(b) or set(a) != set(b):
        return False
    n = len(a)
    for seq in (b, list(reversed(b))):
        k = seq.index(a[0])
        if all(a[i] == seq[(k + i) % n] for i in range(n)):
            return True
    return False


def validate(t):
    errors, notes = [], []
    ids = [n["id"] for n in t["nodes"]]
    if len(ids) != len(set(ids)):
        errors.append("duplicate node ids")
    node = {n["id"]: n for n in t["nodes"]}
    pos = {n["id"]: (n["x"], n["y"]) for n in t["nodes"]}
    es = set()
    for a, b in t["edges"]:
        if a not in node or b not in node:
            errors.append("edge %s-%s references unknown node" % (a, b))
            continue
        if a == b:
            errors.append("self edge %s" % a)
        key = tuple(sorted((a, b)))
        if key in es:
            errors.append("duplicate edge %s-%s" % key)
        es.add(key)
    if errors:
        return errors, notes
    edges = [list(e) for e in es]
    for i in range(len(edges)):
        for j in range(i + 1, len(edges)):
            a, b = edges[i]
            c, d = edges[j]
            if len({a, b, c, d}) < 4:
                continue
            if _segments_cross(pos[a], pos[b], pos[c], pos[d]):
                errors.append("paths %s-%s and %s-%s cross" % (a, b, c, d))
    for a, b in edges:
        for n in ids:
            if n not in (a, b) and _on_segment(pos[a], pos[b], pos[n]):
                errors.append("node %s lies on path %s-%s" % (n, a, b))
    # connectivity
    adj = {i: set() for i in ids}
    for a, b in edges:
        adj[a].add(b)
        adj[b].add(a)
    stack, seen = [ids[0]], {ids[0]}
    while stack:
        v = stack.pop()
        for w in adj[v] - seen:
            seen.add(w)
            stack.append(w)
    if len(seen) != len(ids):
        errors.append("graph not connected: %s unreachable" % sorted(set(ids) - seen))
    if errors:
        return errors, notes
    fs = faces(t["nodes"], edges)
    bounded = [f for f in fs if signed_area(f, pos) < 0 or signed_area(f, pos) > 0]
    outer = min(fs, key=lambda f: signed_area(f, pos))
    total = 0
    for r in t["regions"]:
        total += r["medals"]
        for b in r["bases"]:
            if b not in node:
                errors.append("region %s: unknown base %s" % (r["id"], b))
            elif node[b]["type"] == "hq":
                errors.append("region %s: %s is an HQ, not a base" % (r["id"], b))
        if not any(same_cycle(r["bases"], f) for f in bounded if f is not outer):
            errors.append("region %s (%s) is not a face of the board" % (r["id"], ",".join(r["bases"])))
    if total > MAX_MEDALS:
        errors.append("total medals %d > %d" % (total, MAX_MEDALS))
    owners = {n["owner"] for n in t["nodes"] if n["type"] == "hq"}
    for o in ("blue", "red"):
        if o not in owners:
            errors.append("no HQ for %s" % o)
        if o not in t.get("medalGoal", {}):
            errors.append("no medal goal for %s" % o)
    # symmetry report
    W = max(p[0] for p in pos.values()) + min(p[0] for p in pos.values())
    H = max(p[1] for p in pos.values()) + min(p[1] for p in pos.values())
    rot = {}
    for n in t["nodes"]:
        target = (round(W - n["x"], 3), round(H - n["y"], 3))
        for m in t["nodes"]:
            if (round(m["x"], 3), round(m["y"], 3)) == target:
                rot[n["id"]] = m["id"]
    sym = len(rot) == len(ids) and all(tuple(sorted((rot[a], rot[b]))) in es for a, b in edges)
    if sym:
        for n in t["nodes"]:
            m = node[rot[n["id"]]]
            if n["type"] != m["type"] or n.get("allowedStrengths") != m.get("allowedStrengths"):
                sym = False
        medal_of = {frozenset(r["bases"]): r["medals"] for r in t["regions"]}
        for r in t["regions"]:
            if medal_of.get(frozenset(rot[b] for b in r["bases"])) != r["medals"]:
                sym = False
    notes.append("bases=%d hq=%d paths=%d regions=%d medals=%d goal=%s symmetric180=%s" % (
        sum(1 for n in t["nodes"] if n["type"] != "hq"), sum(1 for n in t["nodes"] if n["type"] == "hq"),
        len(edges), len(t["regions"]), total, t.get("medalGoal"), sym))
    return errors, notes


COLORS = {"blue": "#2f7fd8", "red": "#e2483d"}


def render(t, out):
    pos = {n["id"]: (n["x"], n["y"]) for n in t["nodes"]}
    S, M = 90, 60
    W = max(p[0] for p in pos.values()) * S + 2 * M
    H = max(p[1] for p in pos.values()) * S + 2 * M + 40
    px = lambda p: (p[0] * S + M, p[1] * S + M + 40)
    o = ['<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" font-family="sans-serif">' % (W, H),
         '<rect width="100%%" height="100%%" fill="#fbf3df"/>',
         '<text x="%d" y="30" font-size="20" font-weight="bold" fill="#284b63">%s (%s) - objectif bleu %s / rouge %s</text>' % (
             M, t["name"], t["specialEffect"], t["medalGoal"]["blue"], t["medalGoal"]["red"])]
    for r in t["regions"]:
        pts = " ".join("%.0f,%.0f" % px(pos[b]) for b in r["bases"])
        o.append('<polygon points="%s" fill="#9ed99a" fill-opacity="0.45" stroke="none"/>' % pts)
        cx = sum(px(pos[b])[0] for b in r["bases"]) / len(r["bases"])
        cy = sum(px(pos[b])[1] for b in r["bases"]) / len(r["bases"])
        o.append('<text x="%.0f" y="%.0f" text-anchor="middle" font-size="18" fill="#b8860b">&#9733;%d</text>' % (cx, cy + 6, r["medals"]))
    for a, b in t["edges"]:
        (x1, y1), (x2, y2) = px(pos[a]), px(pos[b])
        o.append('<line x1="%.0f" y1="%.0f" x2="%.0f" y2="%.0f" stroke="#c9a36b" stroke-width="7" stroke-linecap="round"/>' % (x1, y1, x2, y2))
    for n in t["nodes"]:
        x, y = px((n["x"], n["y"]))
        if n["type"] == "hq":
            o.append('<rect x="%.0f" y="%.0f" width="56" height="56" rx="10" fill="%s"/>' % (x - 28, y - 28, COLORS[n["owner"]]))
        else:
            fill = "#f4b942" if n["type"] == "special" else "#d8d3c8"
            o.append('<rect x="%.0f" y="%.0f" width="44" height="44" rx="8" fill="%s" stroke="#7a6a55" stroke-width="2"/>' % (x - 22, y - 22, fill))
        o.append('<text x="%.0f" y="%.0f" text-anchor="middle" font-size="13" fill="#222">%s</text>' % (x, y + 5, n["id"]))
        if "allowedStrengths" in n:
            o.append('<text x="%.0f" y="%.0f" text-anchor="middle" font-size="11" fill="#7a2e8e">[%s]</text>' % (
                x, y + 38, ",".join(str(v) for v in n["allowedStrengths"])))
    o.append("</svg>")
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(o))


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("validate", "render"):
        print(__doc__)
        return 2
    cmd = sys.argv[1]
    rest = sys.argv[2:]
    out_dir = None
    if cmd == "render":
        out_dir, rest = rest[0], rest[1:]
        os.makedirs(out_dir, exist_ok=True)
    files = rest or sorted(os.path.join(DEFAULT_DIR, f) for f in os.listdir(DEFAULT_DIR) if f.endswith(".json"))
    bad = 0
    for path in files:
        t = load(path)
        errors, notes = validate(t)
        status = "OK " if not errors else "ERR"
        print("%s %-20s %s" % (status, t["id"], "; ".join(notes)))
        for e in errors:
            print("     - " + e)
        bad += bool(errors)
        if out_dir:
            render(t, os.path.join(out_dir, t["id"] + ".svg"))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
