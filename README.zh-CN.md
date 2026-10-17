# canvas-grades

**Canvas 成绩计算库**：根据课程的作业分组算出当前成绩、期末要考多少分、每项作业占总成绩多少，还能从 syllabus 文字里读出成绩构成。

它是 [Canvas+](https://getcanvasplus.com) 的成绩计算引擎。Canvas+ 是一个帮学生用好 Canvas 的 Chrome 插件。

[English](README.md)

- **纯函数**：不联网，没有依赖，Node 和浏览器里都能用。
- **规则和 Canvas 一致**：
  - 支持按权重或按总分计分；
  - 支持去掉最低分 / 最高分、"不可去掉"的作业；
  - 免交和不计入总成绩的作业会被排除；
  - 加分项只往上加，不计入分母。
- **直接吃 Canvas 接口数据**：`/assignment_groups?include[]=assignments&include[]=submission` 返回的 JSON 原样传进来就行。
- **有测试**：19 个测试用例，来自真实课程的设置（`npm test`）。

## 安装

```bash
npm install canvas-grades        # 或者直接把 index.js 复制到项目里
```

```js
const { grades, breakdown } = require('canvas-grades');
```

浏览器里用 `<script src="index.js">` 引入后，可以通过 `window.CanvasGrades` 访问。

## 期末要考多少分？

```js
const rows    = grades.summarizeGroups(groups, weighted);   // weighted = 课程是否按分组权重计分
const current = grades.currentGrade(rows, weighted);        // 比如 87.5
const finalId = grades.guessFinal(rows);                    // 自动找出期末考试那一组
const need    = grades.requiredOnFinal(rows, finalId, 90, {}, current);
// -> 93.8：想拿到 90%，期末需要考 93.8%
```

还没出分的分组，默认按 `fallback`（通常就是当前成绩）计算。也可以在 `assumed` 里给某个分组指定一个假设分数，例如 `{ 作业分组id: '100' }`。

## 每项作业占总成绩多少

```js
grades.assignmentShares(groups, weighted);
// { '4': { share: 10, extra: false, group: 'Midterm Exams' }, ... }   share = 占课程总成绩的百分比
```

## 从 syllabus 里读出成绩构成

```js
const found = breakdown.findAnyBreakdown(lines);     // [{ name: 'Homework', pct: 25 }, ...]
const { weights } = breakdown.matchGroups(found, canvasGroups);   // { 分组id: 百分比 }
```

支持三种写法：
- 表格，比如 "Homework | 25%"；
- 句子，比如 "two midterms each worth 15%"；
- 按分值计分的 syllabus，比如 "Labs 200 points"。

迟交扣分、等级分数线、合计这类看起来像成绩构成、其实不是的行，会被自动跳过。

完整的 API 列表见 [English README](README.md#api)。

## 许可证

**AGPL-3.0** © Baowen Liu。你可以自由使用、修改和分享这些代码。但如果把它用进你发布的软件，或者用来提供网络服务，你的软件也必须以 AGPL-3.0 公开源代码。

**商业授权**：想在闭源或商业产品里使用、又不想受 AGPL 约束，请发邮件到 support@getcanvasplus.com。

**参与贡献**：提交 Pull Request 即表示你同意：你的贡献以 AGPL-3.0 授权，并且作者也可以用其他条款（比如上面的商业授权）再授权你的贡献。

本许可只适用于代码本身，**Canvas+** / **Canvas Plus** 的名称和 logo 不在授权范围内。

Canvas 是 Instructure, Inc. 的商标。本项目是独立项目，与 Instructure 无关，也未获其认可。
