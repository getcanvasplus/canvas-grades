# canvas-grades

**Grade math for Canvas LMS.** It gives you the current grade from a course's assignment groups, the score you need on the final, and each assignment's share of the grade. It also reads the grade breakdown out of a syllabus.

This is the grade engine inside [Canvas+](https://getcanvasplus.com), a Chrome extension for students on Canvas.

[中文说明](README.zh-CN.md)

- **Pure functions.** No network and no dependencies. Works in Node and in the browser.
- **Follows Canvas's own rules.** Weighted groups or points, drop lowest / highest, never-drop, excused and omitted assignments, and extra credit that adds on top without growing the denominator.
- **Takes Canvas API data as-is.** Pass it the JSON from `/assignment_groups?include[]=assignments&include[]=submission`.
- **Tested.** 19 test cases built from real course setups (`npm test`).

## Install

```bash
npm install canvas-grades        # or copy index.js into your project
```

```js
const { grades, breakdown } = require('canvas-grades');
```

In a browser, a `<script src="index.js">` gives you `window.CanvasGrades`.

## What do I need on the final?

```js
const groups = await (await fetch(
  '/api/v1/courses/123/assignment_groups?include[]=assignments&include[]=submission'
)).json();
const weighted = course.apply_assignment_group_weights;   // from /api/v1/courses/123

const rows    = grades.summarizeGroups(groups, weighted);
const current = grades.currentGrade(rows, weighted);        // e.g. 87.5
const finalId = grades.guessFinal(rows);                    // the group that looks like the final exam
const need    = grades.requiredOnFinal(rows, finalId, 90, {}, current);
// -> 93.8: the % needed on the final to finish with 90%
```

`requiredOnFinal(rows, finalId, target, assumed, fallback, bonus)` treats groups with no grades yet as scoring `fallback` (usually the current grade). You can override any group in `assumed`, e.g. `{ homeworkGroupId: '100' }`.

## Each assignment's share of the final grade

```js
grades.assignmentShares(groups, weighted);
// { '4': { share: 10, extra: false, group: 'Midterm Exams' }, ... }   share = % of the course grade
```

## Grade breakdown from a syllabus

```js
const lines = breakdown.htmlToLines(syllabusHtml);   // browser only; or pass your own array of lines
const found = breakdown.findAnyBreakdown(lines);     // [{ name: 'Homework', pct: 25 }, ...]
const { weights, unmatched } = breakdown.matchGroups(found, canvasGroups);
// weights: { [groupId]: percent }
```

It handles tables ("Homework | 25%"), sentences ("two midterms each worth 15%"), and points-based syllabi ("Labs 200 points"). It skips lines that look like breakdowns but aren't, such as late penalties, letter-grade cutoffs and totals.

## API

**grades**

| Function | What it does |
|---|---|
| `summarizeGroups(groups, useWeights)` | Canvas assignment groups → rows `{ id, name, weight, pct, earned, possible }`, with drop rules, excused and omitted assignments applied |
| `currentGrade(rows, useWeights, extraIds?)` | Course % now; extra-credit groups add on top |
| `requiredOnFinal(rows, finalId, target, assumed, fallback, bonus?)` | % needed on the final to reach `target` |
| `guessFinal(rows)` | Id of the group that is probably the final exam |
| `defaultExtraIds(rows)` · `canvasBonus` · `maxBonus` | Extra credit helpers |
| `assignmentShares(groups, useWeights)` | Each assignment's % of the course grade |
| `scoreHistory(groups, useWeights)` | The course grade over time, replayed from graded dates |
| `schemeToScale(scheme)` · `letterFromPct(pct, scale)` · `DEFAULT_SCALE` | Canvas grading scheme → letter scale |
| `latePenalty(policy, lateMs)` | What a late submission costs under a Canvas late policy |
| `gpaRows` · `cumulativeGpa` · `termSummaries` · `termProjection` · `gpaLetter` · `GPA_SCALE` | GPA by term, cumulative, and a projection for the current term |
| `missingRows` · `courseStatus` | Missing work and course status helpers |

**breakdown**

| Function | What it does |
|---|---|
| `findAnyBreakdown(lines)` | Percent breakdown, else points breakdown |
| `findBreakdown(lines)` · `findPointsBreakdown(lines)` | One kind only |
| `parseLine(line)` · `parsePointsLine(line)` | A single line |
| `matchGroups(breakdown, groups)` | Fuzzy-match syllabus items to Canvas groups |
| `completeGrading(grading, groups)` | Fill in a breakdown that doesn't add up to 100% from Canvas weights |
| `htmlToLines(html)` | Syllabus HTML → text lines (browser; uses `DOMParser`) |

## Notes

- Canvas picks which scores to drop so as to give you the highest grade. `applyDrops` drops by percentage, which matches Canvas in nearly all real courses.
- Everything works in percentages (0–100).

## License

**AGPL-3.0** © Baowen Liu. You can use, change and share this code. If you build it into software that you distribute or run as a network service, that software must also be released under the AGPL-3.0, with its source code.

**Commercial license.** To use canvas-grades in a closed-source or commercial product without the AGPL terms, e-mail support@getcanvasplus.com.

**Contributing.** By sending a pull request you agree that your contribution is licensed under the AGPL-3.0, and that the author may also license it under other terms, such as the commercial license above.

The license covers the code only. The names **Canvas+** and **Canvas Plus** and the Canvas+ logo are not licensed.

Canvas is a trademark of Instructure, Inc. This project is independent and is not affiliated with or endorsed by Instructure.
