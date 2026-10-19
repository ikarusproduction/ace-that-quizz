// A practice run: a queue of questions answered one by one, with optional hints, a confidence tap, hearts and a second
// chance. Pure state machine, shared by the Adventure and the training modes. The screen owns the UI and the profile
// owns what is learned (see learning.js).
//
// What a run records for every answer (run.answers), which is what the spaced-repetition engine consumes:
//   { id: conceptId, qid, correct, hints (0-2), confidence ('sure'|'maybe'|'guess'|null), level (1-3), wrongText }
// Hints remove one wrong choice each (so "eliminated" answers are never confused with independent recall).
// Time is never recorded: a slow answer is as good as a fast one.
import { Rng } from './rng.js';

export const CONFIDENCE = ['sure', 'maybe', 'guess'];
export const MAX_HINTS = 2;

/**
 * questions: [{ qid, family, level, reason? }]. Options: hearts (null = no hearts), allowHints, allowRetry, hexes (array per
 * question index of hex ids thrown at the player), seed.
 */
export function startPractice({ questions, ctx, hearts = null, allowHints = true, allowRetry = true, hexes = [], seed = 'practice' }) {
  const rng = Rng.fromSeed(seed);
  const queue = questions.map((x, i) => ({
    qid: x.qid, family: x.family ?? x.qid, level: x.level ?? 1, reason: x.reason ?? null, retry: false,
    order: rng.shuffle(ctx.byId.get(x.qid).choices.map((_, k) => k)), hints: 0, elim: [], conf: null, hexes: hexes[i] ?? [],
  }));
  return { queue, idx: 0, hearts, maxHearts: hearts, status: 'play', picked: null, right: 0, wrong: 0, hinted: 0, answers: [], allowHints, allowRetry, seed, deflected: 0, thrown: 0 };
}

export const currentItem = (run) => (run.status === 'play' ? run.queue[run.idx] : null);

export function setConfidence(run, conf) {
  if (run.status !== 'play' || run.picked || !CONFIDENCE.includes(conf)) return run;
  const queue = run.queue.map((it, i) => (i === run.idx ? { ...it, conf: it.conf === conf ? null : conf } : it));
  return { ...run, queue };
}

/** Hints still available on the current question. */
export function hintsLeft(run, ctx) {
  const it = currentItem(run);
  if (!it || !run.allowHints || run.picked) return 0;
  const wrongCount = ctx.byId.get(it.qid).choices.length - 1;
  return Math.max(0, Math.min(MAX_HINTS, wrongCount - 1) - it.hints);
}

/** Remove one wrong choice from the current question. Deterministic per (seed, question, hint number). */
export function useHint(run, ctx) {
  if (hintsLeft(run, ctx) <= 0) return run;
  const it = run.queue[run.idx];
  const q = ctx.byId.get(it.qid);
  const wrongs = it.order.filter((orig) => orig !== q.answer && !it.elim.includes(orig));
  const orig = Rng.fromSeed(`${run.seed}:${it.qid}:${it.hints}`).pick(wrongs);
  const queue = run.queue.map((x, i) => (i === run.idx ? { ...x, hints: x.hints + 1, elim: [...x.elim, orig] } : x));
  return { ...run, queue };
}

/** Answer by displayed position. A position that a hint removed is ignored. */
export function answerRun(run, display, ctx) {
  if (run.status !== 'play' || run.picked) return run;
  const item = run.queue[run.idx];
  const q = ctx.byId.get(item.qid);
  const chosen = item.order[display];
  if (chosen === undefined || item.elim.includes(chosen)) return run;
  const correct = chosen === q.answer;
  const outcome = {
    id: item.family, qid: item.qid, correct, hints: item.hints, confidence: item.conf, level: item.level,
    wrongText: correct ? null : String(q.choices[chosen] ?? '').slice(0, 60),
  };
  const next = {
    ...run, picked: { display, correct, answerDisplay: item.order.indexOf(q.answer), hints: item.hints, confidence: item.conf },
    right: run.right + (correct ? 1 : 0), wrong: run.wrong + (correct ? 0 : 1), hinted: run.hinted + (item.hints > 0 ? 1 : 0), answers: [...run.answers, outcome],
  };
  if (!correct) {
    if (run.hearts !== null) next.hearts = run.hearts - 1;
    // A miss comes back once at the end, asked in a different formulation of the same concept.
    if (run.allowRetry && !item.retry) {
      const levels = [1, 2, 3].filter((l) => l !== item.level && ctx.families.get(item.family)?.[l]);
      const level = levels.length ? levels[(item.level) % levels.length] : item.level;
      const qid = ctx.families.get(item.family)?.[level]?.id ?? item.qid;
      const rq = ctx.byId.get(qid);
      next.queue = [...run.queue, { qid, family: item.family, level, reason: 'retry', retry: true, order: Rng.fromSeed(`${run.seed}:retry:${qid}`).shuffle(rq.choices.map((_, k) => k)), hints: 0, elim: [], conf: null, hexes: [] }];
    }
  }
  return next;
}

/** Move on after the result was shown. Ends the run when hearts are gone or the queue is done. */
export function advanceRun(run) {
  if (run.status !== 'play' || !run.picked) return run;
  if (run.hearts !== null && run.hearts <= 0) return { ...run, status: 'lost', picked: null, stars: 0 };
  const idx = run.idx + 1;
  if (idx >= run.queue.length) return { ...run, idx, status: 'won', picked: null, stars: run.hearts === null ? 0 : starsFor(run.hearts) };
  return { ...run, idx, picked: null };
}

export const starsFor = (hearts) => Math.max(1, Math.min(3, hearts));

/** Record that the player deflected (or took) a thrown hex. Only for the stats on the result screen. */
export function noteHex(run, deflected) {
  return { ...run, thrown: run.thrown + 1, deflected: run.deflected + (deflected ? 1 : 0) };
}
