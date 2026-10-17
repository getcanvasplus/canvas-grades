// node examples/syllabus.js
// Read the grade breakdown out of a syllabus and match it to the course's Canvas assignment groups.
const { breakdown } = require('..');

const syllabusLines = [
  'Grading',
  'Homework | 25%',
  'Quizzes | 15%',
  'Midterm Exam | 25%',
  'Final Exam | 35%',
  'Late work loses 10% per day.'            // not part of the breakdown — ignored
];
const found = breakdown.findAnyBreakdown(syllabusLines);
console.log(found.map(e => `${e.name}: ${e.pct}%`));

const canvasGroups = [{ id: 'g1', name: 'Homework Assignments' }, { id: 'g2', name: 'Quiz' }, { id: 'g3', name: 'Midterm' }, { id: 'g4', name: 'Final' }];
console.log(breakdown.matchGroups(found, canvasGroups).weights);   // { g1: 25, g2: 15, g3: 25, g4: 35 }
