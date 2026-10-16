// Round construction: which five questions, in what order, under which hazard.
// A round is always exactly five questions:
//   1. one Science question (a Phobia question about a third of the time)
//   2. one Name That Tune question (a music question while the tune bank is empty)
//   3. one Symbols / Elements / Abbreviations question
//   4-5. two more drawn from News, History, Geography, Nature and Arts,
//        never the same category twice among these two. While the tune bank is
//        empty, slot 2 is a music question, so Arts can appear twice.
import { RULES, ACT_DIFFICULTY, ACT_BOSSES, NORMAL_HAZARD_IDS, HAZARDS, BOSSES } from './modifiers.js';
import { statCategory } from './bank.js';
import { themePool } from './themes.js';

const ROTATING = ['news', 'history', 'geography', 'nature', 'arts'];

/** Index helpers shared by the engine and UI. */
export function roundInfo(roundIndex, config) {
  if (config.noBoss) {
    // Versus: a flat number of rounds with a rising difficulty and no boss.
    return { act: Math.min(roundIndex, 2), inAct: roundIndex, isBoss: false, totalRounds: config.rounds };
  }
  const perAct = config.roundsPerAct + 1;
  const act = Math.floor(roundIndex / perAct);
  const inAct = roundIndex % perAct;
  return { act, inAct, isBoss: inAct === config.roundsPerAct, totalRounds: config.acts * perAct };
}

function difficultyWeights(act, boss) {
  const base = { ...(ACT_DIFFICULTY[Math.min(act, ACT_DIFFICULTY.length - 1)]) };
  const min = boss?.minDifficulty ?? 1;
  for (const d of [1, 2, 3, 4]) if (d < min) base[d] = 0;
  return base;
}

/**
 * Pick one question. Prefers: right category and difficulty, not used this run,
 * not recently seen. Widens gradually instead of ever failing.
 */
export function pickQuestion({ pool, rng, difficulty, usedIds, avoidIds = new Set(), minDifficulty = 1, seen = null }) {
  const ok = (q, { fresh, exact }) =>
    (!exact || q.difficulty === difficulty) &&
    q.difficulty >= minDifficulty &&
    !usedIds.has(q.id) &&
    (!fresh || !avoidIds.has(q.id));
  const tiers = [
    { fresh: true, exact: true },
    { fresh: false, exact: true },
    { fresh: true, exact: false },
    { fresh: false, exact: false },
  ];
  for (const tier of tiers) {
    let candidates = pool.filter((q) => ok(q, tier));
    if (candidates.length && !tier.exact) {
      // Closest difficulty first when widening.
      const best = Math.min(...candidates.map((q) => Math.abs(q.difficulty - difficulty)));
      candidates = candidates.filter((q) => Math.abs(q.difficulty - difficulty) === best);
    }
    if (candidates.length) {
      // Variety: among the candidates, prefer those this group has seen least often.
      if (seen) {
        const least = Math.min(...candidates.map((q) => seen[q.id] ?? 0));
        candidates = candidates.filter((q) => (seen[q.id] ?? 0) === least);
      }
      return rng.pick(candidates);
    }
  }
  // Last resort: allow repeats rather than failing a round.
  const repeats = pool.filter((q) => q.difficulty >= minDifficulty);
  return repeats.length ? rng.pick(repeats) : pool.length ? rng.pick(pool) : null;
}

/**
 * Build a round definition.
 * @param {Object} o
 * @param {Array} o.questions        the full normalised bank
 * @param {Rng} o.rng
 * @param {number} o.roundIndex
 * @param {Object} o.config
 * @param {Set<string>} o.usedIds    ids already used in this run
 * @param {Set<string>} [o.avoidIds] ids recently seen by any participant
 * @param {string[]} o.usedBosses
 * @param {string|null} o.previousHazard
 * @param {string[]} o.previousCategories  categories used in the previous round (soft avoid)
 */
export function buildRound({ questions, rng, roundIndex, config, usedIds, avoidIds, usedBosses, previousHazard, previousCategories = [], seen = null }) {
  const { act, isBoss } = roundInfo(roundIndex, config);

  // Boss or hazard.
  let bossId = null;
  let hazardId = 'none';
  if (isBoss) {
    const options = ACT_BOSSES[Math.min(act, ACT_BOSSES.length - 1)].filter((b) => !usedBosses.includes(b));
    const list = options.length ? options : ACT_BOSSES[Math.min(act, ACT_BOSSES.length - 1)];
    bossId = rng.pick(list);
  } else if (roundIndex > 0) {
    const options = NORMAL_HAZARD_IDS.filter((h) => h !== previousHazard);
    hazardId = rng.pick(options);
  }
  const boss = bossId ? BOSSES[bossId] : null;
  const hazard = HAZARDS[hazardId];

  const byStat = (key) => questions.filter((q) => statCategory(q) === key);
  const tunes = questions.filter((q) => q.category === 'tunes');
  const music = questions.filter((q) => q.category === 'arts' && q.subcategory === 'music');
  const nonMusicArts = questions.filter((q) => q.category === 'arts' && q.subcategory !== 'music');

  // Decide the category of each of the five slots.
  const rotatingChoices = rng.shuffle(ROTATING);
  // Prefer categories not used last round, but never leave fewer than two to choose from.
  rotatingChoices.sort((a, b) => Number(previousCategories.includes(a)) - Number(previousCategories.includes(b)));
  const rotating = rotatingChoices.slice(0, 2);

  const wantsPhobia = rng.chance(0.33) && byStat('phobia').length > 0;
  const themed = Array.isArray(config.themes) && config.themes.length > 0;
  const slotDefs = themed ? config.themes.map((id) => ({ key: id, pool: themePool(id, questions, config.today ?? Date.now()) })) : [
    { key: wantsPhobia ? 'phobia' : 'science', pool: byStat(wantsPhobia ? 'phobia' : 'science') },
    { key: tunes.length ? 'tunes' : 'arts', pool: tunes.length ? tunes : music },
    { key: 'symbols', pool: byStat('symbols') },
    ...rotating.map((key) => ({
      key,
      // The music fallback already fills the tune slot, so Arts here avoids music questions when it can.
      pool: key === 'arts' && nonMusicArts.length ? nonMusicArts : byStat(key),
    })),
  ];

  const weights = difficultyWeights(act, boss);
  const used = new Set(usedIds);
  const slots = [];
  for (const def of slotDefs) {
    const difficulty = Number(rng.weighted(weights));
    const q = pickQuestion({ pool: def.pool, rng, difficulty, usedIds: used, avoidIds, minDifficulty: boss?.minDifficulty ?? 1, seen });
    if (!q) throw new Error(`Question bank has no questions for category "${def.key}"`);
    used.add(q.id);
    slots.push({ category: themed ? statCategory(q) : def.key, theme: themed ? def.key : null, difficulty, questionId: q.id });
  }

  // Shuffle presentation order so the slot structure is not predictable.
  const ordered = rng.shuffle(slots).map((s, i) => ({ ...s, slot: i }));
  const markedSlot = hazard.slotGainMult ? rng.int(ordered.length) : null;

  return { index: roundIndex, act, isBoss, bossId, hazardId, markedSlot, slots: ordered };
}

/** Distinct statistics categories of the questions in a built round. */
export function roundCategories(round, byId) {
  return round.slots.map((s) => statCategory(byId.get(s.questionId)));
}

export { RULES };
