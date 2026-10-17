// Run: npm test   (node --test)
const test = require('node:test');
const assert = require('node:assert');
const { grades, breakdown } = require('../index.js');

const A = (id, pts, score, extra = {}) => ({ id, points_possible: pts, submission: score == null ? null : { score }, ...extra });

test('weighted course: current grade and final requirement', () => {
  const groups = [
    { id: 1, name: 'Homework', group_weight: 30, assignments: [A(1, 10, 9), A(2, 10, 10)] },
    { id: 2, name: 'Midterm', group_weight: 30, assignments: [A(3, 100, 80)] },
    { id: 3, name: 'Final Exam', group_weight: 40, assignments: [A(4, 100, null)] }
  ];
  const rows = grades.summarizeGroups(groups, true);
  assert.strictEqual(rows[0].pct, 95);
  const cur = grades.currentGrade(rows, true);
  assert.ok(Math.abs(cur - 87.5) < 1e-9);
  assert.strictEqual(grades.guessFinal(rows), '3');
  const x = grades.requiredOnFinal(rows, '3', 93, {}, cur);
  assert.ok(Math.abs(x - 101.25) < 1e-9);
  assert.ok(Math.abs(grades.requiredOnFinal(rows, '3', 93, { 1: '100' }, cur) - 97.5) < 1e-9);
});

test('points-based course uses total points as weight', () => {
  const groups = [
    { id: 1, name: 'Labs', assignments: [A(1, 50, 45), A(2, 50, 40)] },
    { id: 2, name: 'Final', assignments: [A(3, 100, null)] }
  ];
  const rows = grades.summarizeGroups(groups, false);
  assert.strictEqual(rows[0].weight, 100);
  assert.strictEqual(rows[1].weight, 100);
  assert.strictEqual(grades.currentGrade(rows, false), 85);
  assert.strictEqual(grades.requiredOnFinal(rows, '2', 90, {}, 85), 95);
});

test('excused, omitted, and drop-lowest rules', () => {
  const groups = [{ id: 1, name: 'Quizzes', group_weight: 100, rules: { drop_lowest: 1 }, assignments: [
    A(1, 10, 2), A(2, 10, 10), A(3, 10, 8),
    A(4, 10, null, { submission: { excused: true } }),
    A(5, 10, 0, { omit_from_final_grade: true })
  ] }];
  const [r] = grades.summarizeGroups(groups, true);
  assert.strictEqual(r.earned, 18);
  assert.strictEqual(r.possible, 20);
  assert.strictEqual(r.pct, 90);
});

test('drops never remove the last score', () => {
  const kept = grades.applyDrops([{ id: 1, score: 5, possible: 10 }], 2, 0, new Set());
  assert.strictEqual(kept.length, 1);
});

test('no weight on final returns null', () => {
  assert.strictEqual(grades.requiredOnFinal([{ id: 'a', weight: 0, pct: null }], 'a', 93, {}, null), null);
});

test('extra credit is added on top, not in the denominator (a real course setup)', () => {
  const groups = [
    { id: 1, name: 'Attendance', group_weight: 10, assignments: [A(1, 100, null)] },
    { id: 2, name: 'Labs', group_weight: 20, assignments: [A(2, 10, 10), A(3, 20, null)] },
    { id: 3, name: 'Homeworks', group_weight: 20, assignments: [A(4, 20, 20), A(5, 20, null), A(6, 15, null)] },
    { id: 4, name: 'Midterm', group_weight: 25, assignments: [A(7, 100, null)] },
    { id: 5, name: 'Final', group_weight: 25, assignments: [A(8, 100, null)] },
    { id: 6, name: 'Extra credit', group_weight: 10, assignments: [] },
    { id: 7, name: 'Imported Assignments', group_weight: 0, assignments: [] }
  ];
  const rows = grades.summarizeGroups(groups, true);
  const ec = new Set(grades.defaultExtraIds(rows));
  assert.deepStrictEqual([...ec], ['6']);
  assert.strictEqual(grades.normalWeight(rows, ec), 100);
  assert.strictEqual(grades.guessFinal(rows), '5');
  const normal = rows.filter(r => !ec.has(r.id));
  const cur = grades.currentGrade(normal, true);
  assert.strictEqual(cur, 100);
  assert.strictEqual(grades.requiredOnFinal(normal, '5', 93, {}, cur, 0), 72);
  assert.strictEqual(grades.requiredOnFinal(normal, '5', 93, { 4: 85 }, cur, 0), 87);
  assert.strictEqual(grades.requiredOnFinal(normal, '5', 93, { 4: 85 }, cur, 3), 75);
  assert.deepStrictEqual(grades.unknownRows(normal, '5', {}).map(r => r.name), ['Attendance', 'Midterm']);
  assert.deepStrictEqual(grades.unknownRows(normal, '5', { 4: '85' }).map(r => r.name), ['Attendance']);
});

test('extra credit already graded in Canvas becomes the bonus', () => {
  const groups = [
    { id: 1, name: 'Work', group_weight: 100, assignments: [A(1, 100, 80)] },
    { id: 2, name: 'Bonus', group_weight: 5, assignments: [A(2, 10, 6)] }
  ];
  const rows = grades.summarizeGroups(groups, true);
  const ec = new Set(grades.defaultExtraIds(rows));
  const bonusRow = rows.find(r => r.id === '2');
  assert.strictEqual(grades.canvasBonus(bonusRow, rows, true, ec), 3);
  assert.strictEqual(grades.maxBonus(bonusRow, rows, true, ec), 5);
  assert.strictEqual(grades.currentGrade(rows, true, ec), 83);
});

test('0-point extra credit assignment inside a normal group counts', () => {
  const groups = [{ id: 1, name: 'HW', group_weight: 100, assignments: [A(1, 10, 8), A(2, 0, 2), A(3, 0, null)] }];
  const [r] = grades.summarizeGroups(groups, true);
  assert.strictEqual(r.earned, 10);
  assert.strictEqual(r.possible, 10);
  assert.strictEqual(r.pct, 100);
  assert.strictEqual(r.totalCount, 2);
});

test('points-based extra credit', () => {
  const groups = [
    { id: 1, name: 'Labs', assignments: [A(1, 100, 90)] },
    { id: 2, name: 'Final', assignments: [A(2, 100, null)] },
    { id: 3, name: 'Extra Credit', assignments: [A(3, 10, 4)] }
  ];
  const rows = grades.summarizeGroups(groups, false);
  const ec = new Set(grades.defaultExtraIds(rows));
  assert.strictEqual(grades.normalWeight(rows, ec), 200);
  assert.strictEqual(grades.canvasBonus(rows[2], rows, false, ec), 2);
  assert.ok(Math.abs(grades.currentGrade(rows, false, ec) - 94) < 1e-9);
});

test('each assignment’s share of the final grade', () => {
  const groups = [
    { id: 1, name: 'Homework', group_weight: 6, assignments: [A(1, 2, null), A(2, 2, null), A(3, 2, null)] },
    { id: 2, name: 'Midterm Exams', group_weight: 30, assignments: [A(4, 100, null), A(5, 100, null), A(6, 100, null)] },
    { id: 3, name: 'Final Exam', group_weight: 64, assignments: [A(7, 100, null), A(8, 10, null, { omit_from_final_grade: true })] },
    { id: 4, name: 'Extra credit', group_weight: 5, assignments: [A(9, 10, null)] }
  ];
  const s = grades.assignmentShares(groups, true);
  assert.ok(Math.abs(s['1'].share - 2) < 1e-9);
  assert.ok(Math.abs(s['4'].share - 10) < 1e-9);
  assert.ok(Math.abs(s['7'].share - 64) < 1e-9);
  assert.strictEqual(s['8'].share, 0);
  assert.strictEqual(s['9'].extra, true);
  assert.ok(Math.abs(s['9'].share - 5) < 1e-9);
  assert.strictEqual(s['1'].group, 'Homework');

  const p = grades.assignmentShares([
    { id: 1, name: 'Labs', assignments: [A(1, 30, null), A(2, 70, null)] },
    { id: 2, name: 'Final', assignments: [A(3, 100, null)] }
  ], false);
  assert.strictEqual(p['1'].share, 15);
  assert.strictEqual(p['3'].share, 50);
});

test('course grading scheme becomes the letter scale', () => {
  const scale = grades.schemeToScale([
    { name: 'A', value: 0.94 }, { name: 'A-', value: 0.9 }, { name: 'B+', value: 0.87 }, { name: 'F', value: 0 }
  ]);
  assert.deepStrictEqual(scale, [['A', 94], ['A-', 90], ['B+', 87]]);
  assert.strictEqual(grades.schemeToScale([]), null);
});

test('grade breakdown from syllabus text', () => {
  const table = ['Grading', 'Class Participation | 5%', 'Homework (3 total – all scores counted) | 15%', 'Checkpoint Exercises (Weekly) | 10%',
    'Group Project & Presentation | 10%', 'Midterm Exam 1 | 15%', 'Midterm Exam 2 | 15%', 'Final Exam | 30%', 'Total | 100%',
    'A | 93-100%', 'Late work loses 10% per day.'];
  const bd = breakdown.findBreakdown(table);
  assert.deepStrictEqual(bd.map(e => e.name + ' ' + e.pct), ['Class Participation 5', 'Homework 15', 'Checkpoint Exercises 10',
    'Group Project & Presentation 10', 'Midterm Exam 1 15', 'Midterm Exam 2 15', 'Final Exam 30']);
  const groups = ['Class Participation', 'Homework', 'Checkpoint Exercises', 'Group Project', 'Midterm 1', 'Midterm 2', 'Final Exam', 'Imported Assignments']
    .map((name, i) => ({ id: String(i), name }));
  const m = breakdown.matchGroups(bd, groups);
  assert.deepStrictEqual(m.weights, { 0: 5, 1: 15, 2: 10, 3: 10, 4: 15, 5: 15, 6: 30 });
  assert.strictEqual(m.unmatched.length, 0);
  const s2 = breakdown.findBreakdown(['There are 2 midterms each worth 15% of your grade and a final exam worth 30% of your grade.',
    'Homework counts for 30% and quizzes 10% of the final grade.']);
  const m2 = breakdown.matchGroups(s2, [{ id: 'a', name: 'Homework' }, { id: 'b', name: 'Quizzes' }, { id: 'm1', name: 'Midterm 1' }, { id: 'm2', name: 'Midterm 2' }]);
  assert.deepStrictEqual(m2.weights, { a: 30, b: 10, m1: 15, m2: 15 });
  assert.deepStrictEqual(m2.unmatched, [{ name: 'final exam', pct: 30 }]);
  assert.strictEqual(breakdown.findBreakdown(['A 93%', 'B 83%', 'C 73%', '90-100% A']), null);
  assert.deepStrictEqual(breakdown.findBreakdown(['20% Participation', '30% Homework', '50% Exams']).map(e => e.name), ['Participation', 'Homework', 'Exams']);
});

test('points-based breakdown from syllabus', () => {
  const lines = ['Grading', 'HW1: 150 points', 'HW2: 200 points', 'Midterm 1: 400 points', 'Midterm 2: 400 points', 'Final Exam: 500 points', 'Total: 1650 points'];
  const bd = breakdown.findAnyBreakdown(lines);
  assert.strictEqual(bd.length, 5);
  assert.strictEqual(bd[0].total, 1650);
  assert.ok(Math.abs(bd[4].pct - 500 / 1650 * 100) < 1e-9);
  const m = breakdown.matchGroups(bd, [{ id: 'h', name: 'Homework' }, { id: 'm1', name: 'Midterm 1' }, { id: 'm2', name: 'Midterm 2' }]);
  assert.ok(Math.abs(m.weights.h - 350 / 1650 * 100) < 1e-9, 'HW1 + HW2 both go to Homework');
  assert.ok(Math.abs(m.weights.m1 - 400 / 1650 * 100) < 1e-9);
  assert.deepStrictEqual(m.unmatched.map(u => u.name), ['Final Exam']);
  const e = breakdown.findAnyBreakdown(['5 quizzes, 20 points each', '3 projects x 100 points', 'Final exam 300 points']);
  assert.deepStrictEqual(e.map(x => [x.name, x.count, x.pts]), [['quizzes', 5, 20], ['projects', 3, 100], ['Final exam', 1, 300]]);
  assert.strictEqual(breakdown.findAnyBreakdown(['Correctness 40 points out of 50', 'Style 10 points']), null);
});

test('syllabus summary: grade breakdown completed from Canvas weights', () => {
  const G = [{ name: 'Homework', pct: 20 }, { name: 'Labs', pct: 10 }, { name: 'Midterm Exams', pct: 40 }, { name: 'Final Exam', pct: 30 }];
  let r = breakdown.completeGrading([{ item: 'Homework', weight: '30%' }, { item: 'Exams', weight: '70%' }], G);
  assert.strictEqual(r.grading.length, 2); assert.strictEqual(r.canvas, null);
  r = breakdown.completeGrading([{ item: 'Homework', weight: '20%' }, { item: 'Midterms', weight: '40%' }], G);
  assert.deepStrictEqual(r.grading.filter(g => g.source === 'grades').map(g => g.item), ['Labs', 'Final Exam']);
  assert.strictEqual(r.sum, 100); assert.strictEqual(r.canvas, null);
  r = breakdown.completeGrading([{ item: 'Homework', weight: '' }, { item: 'Labs', weight: '10%' }, { item: 'Midterm exams', weight: '40%' }, { item: 'Final', weight: '30%' }], G);
  assert.strictEqual(r.grading[0].weight, '20%'); assert.strictEqual(r.grading[0].source, 'grades'); assert.strictEqual(r.sum, 100);
  r = breakdown.completeGrading([{ item: 'Homework', weight: '200 pts' }, { item: 'Exams', weight: '300 pts' }], G);
  assert.strictEqual(r.grading.length, 2); assert.strictEqual(r.canvas.length, 4);
  r = breakdown.completeGrading([], G);
  assert.strictEqual(r.grading.length, 4); assert.ok(r.grading.every(g => g.source === 'grades'));
  r = breakdown.completeGrading([{ item: 'Homework', weight: '20%' }], []);
  assert.strictEqual(r.grading.length, 1); assert.strictEqual(r.canvas, null);
});

test('gpa: 4.0 scale, Canvas letters, credits and overrides', () => {
  const S = grades.GPA_SCALE;
  assert.strictEqual(grades.letterFromPct(93, S)[0], 'A');
  assert.strictEqual(grades.letterFromPct(92.99, S)[0], 'A-');
  assert.strictEqual(grades.letterFromPct(59.9, S)[0], 'E');
  assert.strictEqual(grades.scaleEntry('F', S)[0], 'E');
  const past = [
    { id: 1, name: 'CS 1010 - Programming I', code: 'CS 1010', term: { name: 'Fall 2025' }, pct: 91.2, letter: 'A-' },
    { id: 2, name: 'MATH 1100 - Calculus I', code: 'MATH 1100', term: { name: 'Fall 2025' }, pct: 84, letter: null },
    { id: 3, name: 'Academic Integrity Training', code: 'AIT', term: { name: 'Default Term' }, pct: 100, letter: null },
    { id: 4, name: 'ENGR 1000 - Seminar', code: 'ENGR 1000', term: { name: 'Fall 2025' }, pct: null, letter: 'S' }
  ];
  let rows = grades.gpaRows(past, {});
  assert.deepStrictEqual(rows.map(r => [r.letter, r.points, r.source, r.included]),
    [['A-', 3.7, 'canvas', true], ['B', 3, 'pct', true], ['A', 4, 'pct', false], ['S', null, 'canvas', true]]);
  let g = grades.cumulativeGpa(rows);
  assert.ok(Math.abs(g.gpa - (3 * 3.7 + 3 * 3) / 6) < 1e-9 && g.credits === 9 && g.gpaCredits === 6 && g.noGpaCredits === 3 && g.defaultCredits === 3);
  rows = grades.gpaRows(past, { cr: { 1: 4, 2: 5 }, lt: { 2: 'B+' }, inc: { 3: false }, extra: [{ id: 'x1', name: 'AP Chemistry', cr: 4, lt: 'A' }] });
  g = grades.cumulativeGpa(rows);
  assert.ok(Math.abs(g.gpa - (4 * 3.7 + 5 * 3.3 + 4 * 4) / 13) < 1e-9 && g.count === 4 && g.credits === 16 && g.defaultCredits === 1);
  const u = grades.cumulativeGpa(grades.gpaRows([{ id: 1, name: 'A 1', letter: 'A-' }, { id: 2, name: 'B 2', letter: 'U' }], {}));
  assert.ok(Math.abs(u.gpa - 3.7) < 1e-9 && u.credits === 6 && u.noGpaCredits === 3);
  assert.deepStrictEqual(grades.cleanScale([['A', 90, 4], ['S', '', ''], ['X', 50, '']]), [['A', 90, 4], ['S', null, null]]);
  assert.strictEqual(grades.letterFromPct(10, grades.GPA_SCALE)[0], 'E');
  assert.strictEqual(rows[1].source, 'you');
  const other = grades.cleanScale([['A+', 97, 4.3], ['A', 93, 4], ['B', 80, 3], ['C', 70, 2], ['F', 0, 0], ['bad', 'x', 1]]);
  assert.deepStrictEqual(other.map(r => r[0]), ['A+', 'A', 'B', 'C', 'F']);
  rows = grades.gpaRows([{ id: 9, name: 'X 1', pct: 98 }, { id: 8, name: 'Y 2', pct: 50, letter: 'E' }], {}, other);
  assert.deepStrictEqual(rows.map(r => [r.letter, r.points]), [['A+', 4.3], ['F', 0]]);
  assert.strictEqual(grades.cumulativeGpa([]).gpa, null);
  assert.deepStrictEqual([4, 3.86, 3.7, 3.69, 3.3, 3.0, 2.99, 1.0, 0.99].map(x => grades.gpaLetter(x)), ['A', 'A-', 'A-', 'B+', 'B+', 'B', 'B-', 'D', 'E']);
  assert.strictEqual(grades.gpaLetter(4.1, other), 'A');
  assert.strictEqual(grades.gpaLetter(4.3, other), 'A+');
  assert.strictEqual(grades.gpaLetter(null), null);
  const mine = grades.cleanScale([['A', 95, 4], ['A-', 92, 3.7], ['B+', 88, 3.3], ['B', 0, 3]]);
  const one = [{ id: 1, name: 'CS 1010', pct: 91.2, letter: 'A-' }, { id: 2, name: 'X', pct: null, letter: 'A' }];
  assert.deepStrictEqual(grades.gpaRows(one, {}, mine, { pctFirst: true }).map(r => [r.letter, r.source]), [['B+', 'pct'], ['A', 'canvas']]);
  assert.deepStrictEqual(grades.gpaRows(one, {}, mine).map(r => r.letter), ['A-', 'A']);
});

test('gpa: which courses are final, still being graded, or this term', () => {
  const now = Date.parse('2026-12-20T12:00:00Z'), D = 864e5, iso = ms => new Date(ms).toISOString();
  const S = (c, o) => grades.courseStatus(c, now, o);
  assert.strictEqual(S({ end: iso(now + 30 * D), cur: 90, fin: 40 }), 'now');
  assert.strictEqual(S({ end: iso(now - 5 * D), cur: 92, fin: 61 }), 'waiting');
  assert.strictEqual(S({ end: iso(now - 5 * D), cur: 92, fin: 92 }), 'done');
  assert.strictEqual(S({ end: iso(now - 5 * D), cur: 92, fin: null }), 'waiting');
  assert.strictEqual(S({ end: iso(now - 40 * D), cur: 92, fin: 61 }), 'done');
  assert.strictEqual(S({ end: '', completed: true, cur: 88, fin: 88 }), 'done');
  assert.strictEqual(S({ end: '', completed: false, cur: 88, fin: 88 }), 'now');
  assert.strictEqual(S({ end: '', completed: false }, 'done'), 'done');
  assert.strictEqual(S({ end: iso(now - 40 * D), fin: 70, cur: 70 }, 'now'), 'now');
});

test('gpa: term by term, each with its term GPA and the cumulative GPA through it', () => {
  const T = (name, end) => ({ name, end });
  const rows = grades.gpaRows([
    { id: 1, name: 'LING 2000', pct: 95, term: T('Spring 2025', '2025-05-01') },
    { id: 2, name: 'STAT 3470', pct: 88, term: T('Spring 2025', '2025-05-01') },
    { id: 3, name: 'CS 1001', pct: 97, term: T('Autumn 2024', '2024-12-15') },
    { id: 4, name: 'MATH 1172', pct: 94, term: T('Autumn 2024', '2024-12-15') }
  ], { cr: { 1: 3, 2: 3, 3: 3, 4: 5 }, extra: [{ id: 'x1', name: 'AP Calc', cr: 4, lt: 'A' }] });
  const t = grades.termSummaries(rows);
  assert.deepStrictEqual(t.map(g => g.name || g.key), ['Spring 2025', 'Autumn 2024', '__manual']);
  assert.ok(Math.abs(t[1].sem.gpa - 4) < 1e-9 && t[1].sem.credits === 8);
  assert.ok(Math.abs(t[1].cum.gpa - 4) < 1e-9 && t[1].cum.credits === 12);
  assert.ok(Math.abs(t[0].sem.gpa - (3 * 4 + 3 * 3.3) / 6) < 1e-9);
  assert.ok(Math.abs(t[0].cum.gpa - (4 * 4 + 8 * 4 + 3 * 4 + 3 * 3.3) / 18) < 1e-9 && t[0].cum.credits === 18);
});

test('gpa: this term projected from current grades, with "what if" letters', () => {
  const past = grades.gpaRows([{ id: 1, name: 'CS 1010', pct: 95, letter: 'A' }, { id: 2, name: 'MATH 1100', pct: 84, letter: 'B' }], { cr: { 1: 4, 2: 5 } });
  const cur = [{ id: 7, name: 'CS 1020', pct: 88.4, letter: null }, { id: 8, name: 'CS 2040', pct: 94, letter: 'A' }, { id: 9, name: 'PHYS 1200', pct: null, letter: null }];
  let p = grades.termProjection(past, cur, { cr: { 1: 4, 2: 5, 7: 4, 8: 3 } });
  assert.deepStrictEqual(p.rows.map(r => [r.letter, r.included]), [['B+', true], ['A', true], [null, false]]);
  assert.ok(Math.abs(p.term.gpa - (4 * 3.3 + 3 * 4) / 7) < 1e-9);
  assert.ok(Math.abs(p.now.gpa - (4 * 4 + 5 * 3) / 9) < 1e-9);
  assert.ok(Math.abs(p.after.gpa - (4 * 4 + 5 * 3 + 4 * 3.3 + 3 * 4) / 16) < 1e-9 && p.after.credits === 16);
  p = grades.termProjection(past, cur, { cr: { 1: 4, 2: 5, 7: 4, 8: 3 }, wi: { 7: 'A-', 9: 'B' } });
  assert.deepStrictEqual(p.rows.map(r => [r.letter, r.whatIf, r.included]), [['A-', true, true], ['A', false, true], ['B', true, true]]);
  assert.ok(Math.abs(p.term.gpa - (4 * 3.7 + 3 * 4 + 3 * 3) / 10) < 1e-9);
});

test('score history: replays graded work day by day, same rules as the current grade', () => {
  const G = (score, at, extra = {}) => ({ score, graded_at: at, ...extra });
  const groups = [
    { id: 1, name: 'Homework', group_weight: 40, rules: { drop_lowest: 1 }, assignments: [
      A(1, 10, null, { submission: G(10, '2026-09-01T15:00:00Z') }),
      A(2, 10, null, { submission: G(5, '2026-09-08T15:00:00Z') }),
      A(3, 10, null, { submission: G(8, '2026-09-15T15:00:00Z') }),
      A(4, 10, null, { submission: { score: 9, excused: true, graded_at: '2026-09-02T15:00:00Z' } })] },
    { id: 2, name: 'Midterm', group_weight: 60, assignments: [A(5, 100, null, { submission: G(70, '2026-09-10T15:00:00Z') })] },
    { id: 3, name: 'Bonus', group_weight: 5, assignments: [A(6, 10, null, { submission: G(10, '2026-09-20T15:00:00Z') })] },
    { id: 4, name: 'Final Exam', group_weight: 0, assignments: [A(7, 100, null), A(8, 10, null, { submission: { score: 5 } })] }
  ];
  const h = grades.scoreHistory(groups, true);
  assert.deepStrictEqual(h.map(p => p.pct), [100, 100, 82, 78, 83]);
  const rows = grades.summarizeGroups(groups.map(g => ({ ...g, assignments: g.assignments.filter(a => a.id !== 8) })), true);
  assert.strictEqual(h[h.length - 1].pct, Math.round(grades.currentGrade(rows, true, new Set(grades.defaultExtraIds(rows))) * 100) / 100);
  assert.ok(h.every((p, i) => i === 0 || p.t > h[i - 1].t), 'one point per day, in order');
  assert.deepStrictEqual(grades.scoreHistory([], true), []);
  const many = [{ id: 1, name: 'HW', group_weight: 100, assignments: Array.from({ length: 60 }, (_, i) =>
    A(i + 1, 10, null, { submission: G(i % 2 ? 10 : 8, new Date(Date.UTC(2026, 7, 20) + i * 864e5).toISOString()) })) }];
  const thin = grades.scoreHistory(many, true, 12);
  assert.ok(thin.length <= 12 && thin[0].pct === 80 && thin[thin.length - 1].pct === 90);
});
