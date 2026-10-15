async () => {
  const { createGame, dispatch, makeContext, getQuestionView } = await import('/src/engine/game.js');
  const { Rng } = await import('/src/engine/rng.js');
  const app = window.__app;
  let t = Date.now() - 20 * 86400000;
  const ctx = makeContext(app.bank.questions, () => (t += 4000));
  const profiles = await app.repo.listProfiles();
  const byName = Object.fromEntries(profiles.map((p) => [p.name, p]));
  const strength = { Ana: { history: .9, geography: .85, science: .35, symbols: .5, arts: .7, nature: .6, news: .6, phobia: .5 }, Ben: { science: .9, symbols: .85, nature: .8, history: .4, geography: .45, arts: .5, news: .5, phobia: .7 } };
  const out = [];
  for (let g = 0; g < 14; g++) {
    for (const name of ['Ana', 'Ben']) {
      const p = byName[name]; if (!p) continue;
      const rng = new Rng(Rng.fromSeed(`seed-${name}-${g}`).state);
      let s = createGame({ mode: g % 4 === 3 ? 'daily' : 'solo', players: [{ id: p.id, name: p.name, ownedCards: p.ownedCards }], ctx, seed: `seed-${name}-${g}`, sessionId: `seed-${name}-${g}`, overrides: g % 3 === 0 ? { acts: 1 } : {} });
      let guard = 0;
      while (s.phase !== 'finished' && guard++ < 3000) {
        const pl = s.players[s.turn];
        let a;
        if (s.phase === 'loadout') a = { type: 'START_ROUND' };
        else if (s.phase === 'stake') a = { type: 'CONFIRM_STAKE', playerId: pl.playerId, stake: rng.chance(.4) ? 2 : 1 };
        else if (s.phase === 'question') {
          const v = getQuestionView(s, ctx, pl.playerId);
          const acc = (strength[name][v.category] ?? .5) * (1 - (v.difficulty - 1) * .08);
          const right = rng.chance(acc);
          const idx = v.choices.findIndex((c) => c.correct === right && !c.hidden);
          a = { type: 'ANSWER', playerId: pl.playerId, choice: idx < 0 ? 0 : idx, elapsedMs: 2000 + Math.floor(rng.next() * 12000) };
        } else if (s.phase === 'reveal') a = { type: 'NEXT' };
        else if (s.phase === 'round-summary') a = { type: 'CONTINUE' };
        else if (s.phase === 'crossroads') a = { type: 'CROSSROADS', playerId: pl.playerId, choice: rng.chance(.5) ? 'bank' : 'hold' };
        else if (s.phase === 'shop') a = { type: 'LEAVE_SHOP' };
        const r = dispatch(s, a, ctx); if (!r.ok) throw new Error(r.reason + ' ' + JSON.stringify(a)); s = r.state;
      }
      await app.repo.finalizeSession(s);
      out.push(`${name}:${s.players[0].result}:${s.log.length}`);
    }
  }
  return out.join(' ');
}
