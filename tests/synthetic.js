// A predictable fake question bank: every question is 4-choice multiple choice,
// so card tests (Scalpel, Rewind, Ghost Note) never depend on real content.

const GROUPS = [
  ['science', 'physics'],
  ['science', 'phobia'],
  ['arts', 'music'],
  ['arts', 'film'],
  ['symbols', 'element-symbol'],
  ['news', 'sport'],
  ['history', 'modern'],
  ['geography', 'capitals'],
  ['nature', 'animals'],
];

export function syntheticQuestions(perGroup = 14) {
  const out = [];
  for (const [category, subcategory] of GROUPS) {
    for (let i = 0; i < perGroup; i++) {
      out.push({
        id: `${subcategory}-${i}`,
        category,
        subcategory,
        difficulty: (i % 4) + 1,
        type: 'mcq',
        question: `Synthetic ${category} ${subcategory} question number ${i}`,
        choices: [`Alpha ${i}`, `Bravo ${i}`, `Charlie ${i}`, `Delta ${i}`],
        answer: i % 4,
        explanation: 'Synthetic explanation for testing.',
        tags: [],
        asOf: null,
        freshness: 'evergreen',
        review: 'unreviewed',
        audio: null,
        audioCredit: null,
        refs: [],
      });
    }
  }
  return out;
}
