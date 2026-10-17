// node examples/final-exam.js
// "What do I need on the final?" for a weighted Canvas course.
const { grades } = require('..');

// The shape Canvas returns from GET /api/v1/courses/:id/assignment_groups?include[]=assignments&include[]=submission
const A = (id, points, score) => ({ id, points_possible: points, submission: score == null ? null : { score } });
const groups = [
  { id: 1, name: 'Homework', group_weight: 30, rules: { drop_lowest: 1 }, assignments: [A(1, 10, 9), A(2, 10, 6), A(3, 10, 10)] },
  { id: 2, name: 'Midterm', group_weight: 30, assignments: [A(4, 100, 80)] },
  { id: 3, name: 'Final Exam', group_weight: 40, assignments: [A(5, 100, null)] }
];

const rows = grades.summarizeGroups(groups, true);           // true = the course uses group weights
const now = grades.currentGrade(rows, true);
const finalId = grades.guessFinal(rows);                       // '3'
const need = grades.requiredOnFinal(rows, finalId, 90, {}, now);

console.log(`Current grade: ${now.toFixed(1)}%`);               // 87.5% (the lowest homework, 6/10, is dropped)
console.log(`To finish with 90% you need ${need.toFixed(1)}% on the final`);

// How much of the final grade each assignment is worth
const shares = grades.assignmentShares(groups, true);
for (const [id, s] of Object.entries(shares)) console.log(`assignment ${id}: ${s.share.toFixed(1)}% of the grade (${s.group})`);
