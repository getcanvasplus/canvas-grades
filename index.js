/*!
 * canvas-grades — the grade engine behind Canvas+ (https://getcanvasplus.com)
 * Copyright (c) 2026 Baowen Liu
 * SPDX-License-Identifier: AGPL-3.0-only
 * Licensed under the GNU Affero General Public License v3.0 (see LICENSE).
 * For use in closed-source / commercial products, a commercial license is available: support@getcanvasplus.com
 */
// Pure functions for Canvas LMS grade math: current grade from assignment groups (weighted or points),
// drop rules, extra credit, the score you need on the final, each assignment's share of the final grade,
// grading schemes, late penalties, GPA, and reading a grade breakdown out of syllabus text.
// No DOM (except breakdown.htmlToLines), no network, no dependencies. Works in Node and in the browser.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CanvasGrades = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const NS = {};

  (function (NS) {
    const DEFAULT_SCALE = [
      ['A', 93], ['A-', 90], ['B+', 87], ['B', 83], ['B-', 80],
      ['C+', 77], ['C', 73], ['C-', 70], ['D+', 67], ['D', 60]
    ];

    const EXTRA_RE = /extra[\s_-]*credit|bonus|加分/i;

    // Apply drop-lowest / drop-highest rules (by percentage).
    function applyDrops(graded, dropLowest, dropHighest, neverDrop) {
      const locked = graded.filter(a => neverDrop.has(a.id) || !(a.possible > 0));
      let pool = graded.filter(a => !neverDrop.has(a.id) && a.possible > 0)
        .sort((a, b) => a.score / a.possible - b.score / b.possible);
      const maxDrops = Math.max(0, pool.length - 1);
      const low = Math.min(dropLowest || 0, maxDrops);
      const high = Math.min(dropHighest || 0, maxDrops - low);
      pool = pool.slice(low, pool.length - high);
      return locked.concat(pool);
    }

    // Canvas assignment groups (with assignments and submissions) -> rows.
    function summarizeGroups(groups, useWeights) {
      return groups.map(g => {
        const rules = g.rules || {};
        const graded = [];
        let totalPossible = 0, totalCount = 0;
        for (const a of g.assignments || []) {
          if (a.omit_from_final_grade || a.grading_type === 'not_graded') continue;
          const s = a.submission;
          const pts = a.points_possible || 0;
          const hasScore = s && s.score != null && !s.excused;
          if (pts <= 0 && !(hasScore && s.score > 0)) continue;
          totalCount++;
          if (s && s.excused) continue;
          totalPossible += pts;
          if (hasScore) graded.push({ id: a.id, score: s.score, possible: pts });
        }
        const kept = applyDrops(graded, rules.drop_lowest, rules.drop_highest, new Set(rules.never_drop || []));
        const earned = kept.reduce((s, a) => s + a.score, 0);
        const possible = kept.reduce((s, a) => s + a.possible, 0);
        return {
          id: String(g.id),
          name: g.name,
          weight: useWeights ? (g.group_weight || 0) : totalPossible,
          earned,
          possible,
          pct: possible > 0 ? (earned / possible) * 100 : null,
          gradedCount: graded.length,
          totalCount,
          maxPoints: totalPossible,
          looksExtra: EXTRA_RE.test(g.name || '')
        };
      });
    }

    // Rows named like "Extra credit" / "Bonus".
    function defaultExtraIds(rows) {
      return rows.filter(r => r.looksExtra).map(r => r.id);
    }

    const split = (rows, ecIds) => ({
      normal: rows.filter(r => !ecIds.has(r.id)),
      extra: rows.filter(r => ecIds.has(r.id))
    });

    // Sum of the normal (non-extra-credit) weights.
    function normalWeight(rows, ecIds) {
      return split(rows, ecIds).normal.reduce((s, r) => s + (r.weight > 0 ? r.weight : 0), 0);
    }

    // Current grade as Canvas shows it (graded work only, extra credit on top).
    function currentGrade(rows, useWeights, ecIds = new Set()) {
      const { normal, extra } = split(rows, ecIds);
      if (!useWeights) {
        const e = rows.reduce((s, r) => s + r.earned, 0);
        const p = normal.reduce((s, r) => s + r.possible, 0);
        return p > 0 ? (e / p) * 100 : null;
      }
      let num = 0, den = 0;
      for (const r of normal) if (r.pct != null && r.weight > 0) { num += r.weight * r.pct; den += r.weight; }
      for (const r of extra) if (r.pct != null && r.weight > 0) num += r.weight * r.pct;
      return den > 0 ? num / den : null;
    }

    // The course grade over time, replayed in grading order.
    function scoreHistory(groups, useWeights, maxPoints = 40) {
      const when = (a, s) => {
        for (const v of [s.graded_at, s.posted_at, s.submitted_at, a.due_at]) { const ms = v ? Date.parse(v) : NaN; if (isFinite(ms)) return ms; }
        return null;
      };
      const times = [];
      for (const g of groups || []) for (const a of g.assignments || []) {
        const s = a.submission;
        if (s && s.score != null && !s.excused) { const ms = when(a, s); if (ms != null) times.push(ms); }
      }
      if (!times.length) return [];
      const dayEnd = ms => { const d = new Date(ms); d.setHours(23, 59, 59, 999); return d.getTime(); };
      let days = [...new Set(times.map(dayEnd))].sort((a, b) => a - b);
      if (days.length > maxPoints) {
        const step = (days.length - 1) / (maxPoints - 1);
        days = [...new Set(Array.from({ length: maxPoints }, (_, i) => days[Math.round(i * step)]))];
      }
      const out = [];
      for (const cut of days) {
        const upTo = (groups || []).map(g => ({ ...g, assignments: (g.assignments || []).map(a => {
          const s = a.submission;
          if (!s || s.score == null || s.excused) return a;
          const ms = when(a, s);
          return ms != null && ms <= cut ? a : { ...a, submission: { ...s, score: null } };
        }) }));
        const rows = summarizeGroups(upTo, useWeights);
        const pct = currentGrade(rows, useWeights, new Set(defaultExtraIds(rows)));
        if (pct != null && isFinite(pct)) out.push({ t: cut, pct: Math.round(pct * 100) / 100 });
      }
      return out;
    }

    // Extra credit already graded in Canvas, in % points.
    function canvasBonus(row, rows, useWeights, ecIds) {
      const W = normalWeight(rows, ecIds);
      if (!(W > 0)) return 0;
      if (!useWeights) return (row.earned / W) * 100;
      return row.pct != null && row.weight > 0 ? (row.weight * row.pct) / W : 0;
    }

    // Largest bonus an extra-credit group can give.
    function maxBonus(row, rows, useWeights, ecIds) {
      const W = normalWeight(rows, ecIds);
      return useWeights && W > 0 ? (row.weight / W) * 100 : null;
    }

    // % needed on the final to reach the target.
    function requiredOnFinal(normalRows, finalId, target, assumed, fallback, bonus = 0) {
      const fin = normalRows.find(r => r.id === finalId);
      if (!fin || !(fin.weight > 0)) return null;
      let W = 0, known = 0;
      for (const r of normalRows) {
        if (!(r.weight > 0)) continue;
        W += r.weight;
        if (r.id === finalId) continue;
        known += r.weight * assumedPct(r, assumed, fallback, target);
      }
      return ((target - (bonus || 0)) * W - known) / fin.weight;
    }

    // % used for a row: assumed > current > fallback.
    function assumedPct(r, assumed, fallback, target) {
      const a = assumed && assumed[r.id];
      if (a != null && a !== '' && !isNaN(a)) return Number(a);
      if (r.pct != null) return r.pct;
      return fallback != null ? fallback : target;
    }

    // Rows with no grades and no assumed value.
    function unknownRows(normalRows, finalId, assumed) {
      return normalRows.filter(r => r.id !== finalId && r.weight > 0 && r.pct == null &&
        !(assumed && assumed[r.id] !== undefined && assumed[r.id] !== '' && !isNaN(assumed[r.id])));
    }

    // Guess which group is the final exam.
    function guessFinal(rows) {
      const cand = rows.filter(r => r.weight > 0 && !r.looksExtra);
      const named = cand.filter(r => /final|期末/i.test(r.name));
      if (named.length) return named.sort((a, b) => b.weight - a.weight)[0].id;
      const exams = cand.filter(r => /exam|test|midterm/i.test(r.name) && r.gradedCount === 0);
      if (exams.length) return exams[0].id;
      return null;
    }

    // Each assignment's share of the final grade, in % points.
    function assignmentShares(groups, useWeights) {
      const rows = summarizeGroups(groups, useWeights);
      const ec = new Set(defaultExtraIds(rows));
      const W = normalWeight(rows, ec);
      const out = {};
      groups.forEach((g, i) => {
        const r = rows[i];
        const counts = a => !a.omit_from_final_grade && a.grading_type !== 'not_graded';
        const groupPts = (g.assignments || []).filter(a => counts(a) && a.points_possible > 0)
          .reduce((s, a) => s + a.points_possible, 0);
        for (const a of g.assignments || []) {
          const pts = a.points_possible || 0;
          let share = null;
          if (!counts(a)) share = 0;
          else if (pts > 0 && W > 0) {
            share = useWeights
              ? (groupPts > 0 ? (r.weight / W) * (pts / groupPts) * 100 : null)
              : (pts / W) * 100;
          }
          out[String(a.id)] = { share, extra: ec.has(r.id) || (pts <= 0 && counts(a)), group: g.name };
        }
      });
      return out;
    }

    // Canvas grading scheme -> [[letter, min %], ...], high to low.
    function schemeToScale(scheme) {
      const rows = (scheme || [])
        .map(e => [String(e.name), Math.round(Number(e.value) * 10000) / 100])
        .filter(([n, v]) => n && v > 0 && isFinite(v))
        .sort((a, b) => b[1] - a[1]);
      return rows.length ? rows : null;
    }

    const GPA_SCALE = [
      ['A', 93, 4.0], ['A-', 90, 3.7], ['B+', 87, 3.3], ['B', 83, 3.0], ['B-', 80, 2.7], ['C+', 77, 2.3],
      ['C', 73, 2.0], ['C-', 70, 1.7], ['D+', 67, 1.3], ['D', 60, 1.0], ['E', 0, 0], ['S', null, null], ['U', null, null]
    ];
    const num = v => v == null || v === '' || !isFinite(v) ? null : +v;
    const DEFAULT_CREDITS = 3;
    const NOT_CREDIT = /training|orientation|onboarding|academic integrity|compliance|workshop|sandbox|advising|resources|community|club|organization|library|tutorial|safety|title ix|welcome|survey|practice course|test course/i;
    const normLetter = l => String(l || '').trim().toUpperCase().replace(/\s+/g, '').replace('−', '-');
    // Scale entry for a letter (F and E are interchangeable).
    function scaleEntry(letter, scale) {
      const L = normLetter(letter);
      return scale.find(e => normLetter(e[0]) === L) || (L === 'F' || L === 'E' ? scale.find(e => /^[EF]$/.test(normLetter(e[0]))) : null) || null;
    }
    const letterFromPct = (pct, scale) => pct == null || !isFinite(pct) ? null
      : (scale.filter(e => num(e[1]) != null).sort((a, b) => b[1] - a[1]).find(e => pct >= e[1] - 1e-9) || null);

    // Past courses -> GPA rows.
    function gpaRows(courses, prefs = {}, scale = GPA_SCALE, { pctFirst = false } = {}) {
      const cr = prefs.cr || {}, lt = prefs.lt || {}, inc = prefs.inc || {};
      const rows = courses.map(c => {
        const id = String(c.id);
        const fromCanvas = c.letter && scaleEntry(c.letter, scale);
        const fromPct = letterFromPct(c.pct, scale);
        const auto = fromPct && (pctFirst || !fromCanvas) ? { letter: fromPct[0], source: 'pct' }
          : fromCanvas ? { letter: fromCanvas[0], source: 'canvas' } : { letter: null, source: 'none' };
        const chosen = lt[id] && scaleEntry(lt[id], scale);
        const letter = chosen ? chosen[0] : auto.letter;
        const e = letter != null ? scaleEntry(letter, scale) : null;
        const credits = cr[id] != null && isFinite(cr[id]) ? Math.max(0, +cr[id]) : DEFAULT_CREDITS;
        const numbered = /\b[A-Z]{2,}[\s_-]?\d{3,4}[A-Z]?\b/.test(`${c.code || ''} ${c.name || ''}`);
        const guessOff = !letter || (!numbered && (NOT_CREDIT.test(`${c.name || ''} ${c.code || ''}`) || /default term/i.test((c.term && c.term.name) || '')));
        return { id, name: c.name || '', code: c.code || '', term: c.term || null, pct: c.pct ?? null, canvasLetter: c.letter || null,
          letter, points: e ? num(e[2]) : null, source: chosen ? 'you' : auto.source, credits, creditsSet: cr[id] != null,
          included: inc[id] != null ? !!inc[id] && !!e : !guessOff && !!e, manual: false };
      });
      for (const x of prefs.extra || []) {
        const e = scaleEntry(x.lt, scale);
        rows.push({ id: String(x.id), name: x.name || '', code: '', term: null, pct: null, canvasLetter: null, letter: e ? e[0] : null, points: e ? num(e[2]) : null,
          source: 'you', credits: Math.max(0, +x.cr || 0), creditsSet: true, included: inc[x.id] != null ? !!inc[x.id] && !!e : !!e, manual: true });
      }
      return rows;
    }
    // Cumulative GPA over the included rows.
    function cumulativeGpa(rows) {
      const use = rows.filter(r => r.included && r.letter && r.credits > 0);
      const graded = use.filter(r => r.points != null);
      const gpaCredits = graded.reduce((n, r) => n + r.credits, 0);
      return { gpa: gpaCredits ? graded.reduce((n, r) => n + r.credits * r.points, 0) / gpaCredits : null,
        credits: use.reduce((n, r) => n + r.credits, 0), gpaCredits, noGpaCredits: use.reduce((n, r) => n + (r.points == null ? r.credits : 0), 0),
        count: use.length, defaultCredits: use.filter(r => !r.creditsSet).length };
    }
    const GRADING_DAYS = 21;
    function courseStatus(c, now = Date.now(), override = null) {
      if (override === 'done' || override === 'now') return override;
      const end = c.end ? Date.parse(c.end) : NaN;
      if (!isFinite(end)) return c.completed ? 'done' : 'now';
      if (end > now) return 'now';
      const ungraded = c.fin == null || (c.cur != null && c.fin < c.cur - 0.05);
      return ungraded && now - end < GRADING_DAYS * 864e5 ? 'waiting' : 'done';
    }
    // This term's projected GPA from current grades (or "what if" letters).
    function termProjection(past, current, prefs = {}, scale = GPA_SCALE, opts = {}) {
      const rows = gpaRows(current, { cr: prefs.cr, lt: prefs.wi, inc: prefs.inc }, scale, opts).map(r => ({ ...r, whatIf: r.source === 'you' }));
      return { rows, term: cumulativeGpa(rows), now: cumulativeGpa(past), after: cumulativeGpa(past.concat(rows)) };
    }
    // Rows grouped by term, with term and cumulative GPA.
    function termSummaries(rows) {
      const groups = new Map();
      for (const r of rows) {
        const key = r.manual ? '__manual' : (r.term && r.term.name) || '__other';
        if (!groups.has(key)) {
          const end = r.term && r.term.end ? Date.parse(r.term.end) : NaN;
          groups.set(key, { key, name: r.manual ? null : (r.term && r.term.name) || null, manual: !!r.manual, at: r.manual ? -Infinity : isFinite(end) ? end : -1e15, rows: [] });
        }
        groups.get(key).rows.push(r);
      }
      const list = [...groups.values()].sort((a, b) => a.at - b.at), acc = [];
      for (const g of list) { acc.push(...g.rows); g.sem = cumulativeGpa(g.rows); g.cum = cumulativeGpa(acc.slice()); }
      return list.reverse();
    }
    // Letter for a GPA value.
    function gpaLetter(gpa, scale = GPA_SCALE) {
      if (gpa == null || !isFinite(gpa)) return null;
      const list = scale.filter(e => num(e[2]) != null).sort((a, b) => b[2] - a[2]);
      const hit = list.find(e => gpa >= e[2] - 1e-9);
      return hit ? hit[0] : list.length ? list[list.length - 1][0] : null;
    }
    // Validate a user-entered scale [[letter, min %, points]].
    function cleanScale(rows) {
      const blank = v => v == null || v === '';
      const out = (rows || []).filter(r => (blank(r[1]) || num(r[1]) != null) && (blank(r[2]) || num(r[2]) != null))
        .map(r => [String(r[0] || '').trim().slice(0, 4), num(r[1]), num(r[2])])
        .filter(r => r[0] && (r[1] == null) === (r[2] == null) && (r[1] == null || (r[1] >= 0 && r[1] <= 100 && r[2] >= 0 && r[2] <= 5)))
        .sort((a, b) => (b[1] ?? -1) - (a[1] ?? -1));
      return out.some(r => r[2] != null) ? out : null;
    }

    function missingRows(list, { courseIds = null, dismissed = [], now = Date.now(), since = null } = {}) {
      const hide = new Set(dismissed.map(String));
      return (list || []).filter(a => a && a.id != null && a.due_at && (!courseIds || courseIds.has(String(a.course_id)))
          && !(a.planner_override && a.planner_override.marked_complete))
        .map(a => {
          const due = Date.parse(a.due_at), lock = a.lock_at ? Date.parse(a.lock_at) : null;
          return { id: String(a.id), courseId: String(a.course_id), title: a.name || '', due, lock, points: a.points_possible ?? null,
            url: a.html_url || '', course: (a.course && (a.course.course_code || a.course.name)) || '',
            canSubmit: !lock || lock > now, lateMs: Math.max(0, now - due), hidden: hide.has(String(a.id)) };
        })
        .filter(r => isFinite(r.due) && r.due < now && (since == null || r.due >= since))
        .sort((a, b) => (b.canSubmit - a.canSubmit) || (a.canSubmit ? (a.lock ?? Infinity) - (b.lock ?? Infinity) : b.due - a.due));
    }
    // Penalty from a Canvas late policy for one late item.
    function latePenalty(policy, lateMs) {
      const p = policy && (policy.late_policy || policy);
      if (!p || (!p.late_submission_deduction_enabled && !p.missing_submission_deduction_enabled)) return null;
      const out = { per: null, interval: null, maxPct: null, missingPct: null };
      if (p.late_submission_deduction_enabled && +p.late_submission_deduction > 0) {
        const unit = p.late_submission_interval === 'hour' ? 36e5 : 864e5;
        const periods = Math.max(1, Math.ceil(lateMs / unit));
        let max = Math.max(0, 100 - +p.late_submission_deduction * periods);
        if (p.late_submission_minimum_percent_enabled) max = Math.max(max, +p.late_submission_minimum_percent || 0);
        Object.assign(out, { per: +p.late_submission_deduction, interval: p.late_submission_interval === 'hour' ? 'hour' : 'day', maxPct: Math.round(max * 10) / 10 });
      }
      if (p.missing_submission_deduction_enabled) out.missingPct = Math.max(0, 100 - (+p.missing_submission_deduction || 0));
      return out;
    }

    NS.grades = {
      missingRows, latePenalty, termProjection, courseStatus, GRADING_DAYS, termSummaries,
      GPA_SCALE, DEFAULT_CREDITS, gpaRows, cumulativeGpa, cleanScale, letterFromPct, scaleEntry, gpaLetter,
      schemeToScale,
      assignmentShares,
      DEFAULT_SCALE, applyDrops, summarizeGroups, defaultExtraIds, normalWeight, currentGrade, scoreHistory,
      canvasBonus, maxBonus, requiredOnFinal, assumedPct, unknownRows, guessFinal
    };
  })(NS);

  (function (NS) {
    const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const FILLER = /\b(?:is|are|will|be|worth|each|counts?|counted|weighted|weighs?|accounts?|makes?|up|for|of|the|your|total|final grade|course grade|overall grade|grade|grades|approximately|approx|about|roughly|a|an|at|to|with|all|combined|together|percent|percentage|weight)\b/gi;
    const NOT_BREAKDOWN = /\b(?:late|per day|penalt|deduct|lose|curve|cutoff|cut-off|scale|range|max(?:imum)?|minimum|at least|below|above|or higher|or better|reduction|off)\b/i;
    const LETTER = /^(?:[a-f][+-]?|pass|fail|s|u)$/i;
    const TOTAL = /^(?:total|sum|overall|course total|grand total)$/i;

    const clean = s => s.replace(/\s+/g, ' ').trim();

    // Clean up an item name.
    function tidyName(s) {
      let n = s.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/[()[\]{}"“”'’*]/g, ' ').replace(/[:=\-–—|•·.…]+\s*$/g, ' ').replace(FILLER, ' ');
      n = clean(n.replace(/^[\s:=\-–—|•·,.;]+|[\s:=\-–—|•·,.;]+$/g, ''));
      const words = n.split(' ').filter(Boolean);
      return words.slice(-6).join(' ');
    }

    // One line of syllabus text -> [{ name, pct, count }].
    function parseLine(line) {
      const out = [];
      const text = clean(line);
      if (!text || text.length > 400 || NOT_BREAKDOWN.test(text)) return out;
      const re = /(\d{1,3}(?:\.\d+)?)\s*%/g;
      const hits = [];
      let m;
      while ((m = re.exec(text))) hits.push({ pct: parseFloat(m[1]), start: m.index, end: re.lastIndex });
      hits.forEach((hit, i) => {
        if (!(hit.pct > 0 && hit.pct <= 100)) return;
        if (/\d\s*[-–—]\s*$/.test(text.slice(Math.max(0, hit.start - 4), hit.start))) return;
        const prevEnd = i ? hits[i - 1].end : 0;
        const nextStart = i < hits.length - 1 ? hits[i + 1].start : text.length;
        let before = text.slice(prevEnd, hit.start);
        before = before.split(/[;|•·]|\band\b|,(?=\s*(?:and\s+)?[a-z])|\.\s/i).filter(x => /[a-z]/i.test(x)).pop() || '';
        let count = 1;
        const each = /(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+([a-z][a-z\s-]*?)\s*,?\s*(?:\(\s*)?each\b/i.exec(before);
        if (each) {
          count = NUM_WORDS[each[1].toLowerCase()] || parseInt(each[1], 10) || 1;
          before = each[2];
        }
        let name = tidyName(before);
        if (!name || /^\d/.test(name)) {
          let after = text.slice(hit.end, nextStart).split(/[;|•·,(]|\.\s|\band\b/i)[0];
          name = tidyName(after.replace(/^\s*(?:[-–—:=]|of|for)\s*/i, ''));
        }
        if (!name || LETTER.test(name) || TOTAL.test(name) || name.length < 2) return;
        out.push({ name, pct: hit.pct, count });
      });
      return out;
    }

    const PTS_RE = /(\d{1,4}(?:\.\d+)?)\s*(?:points?|pts?\.?|分)(?![a-z])/gi;
    function parsePointsLine(line) {
      const out = [];
      const text = clean(line);
      if (!text || text.length > 300 || /%/.test(text) || NOT_BREAKDOWN.test(text) || /\b(?:out of|per|each question|rubric|bonus|extra credit)\b/i.test(text)) return out;
      const hits = [];
      let m;
      PTS_RE.lastIndex = 0;
      while ((m = PTS_RE.exec(text))) hits.push({ pts: parseFloat(m[1]), start: m.index, end: PTS_RE.lastIndex });
      hits.forEach((hit, i) => {
        if (!(hit.pts > 0)) return;
        const prevEnd = i ? hits[i - 1].end : 0;
        let before = text.slice(prevEnd, hit.start);
        before = before.split(/[;|•·]|\band\b|,(?=\s*(?:and\s+)?[a-z])|\.\s/i).filter(x => /[a-z]/i.test(x)).pop() || '';
        let count = 1;
        const each = /(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+([a-z][a-z\s-]*?)\s*,?\s*(?:\(\s*)?(?:each|@)\b/i.exec(before) ||
          /(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+([a-z][a-z\s-]*?)\s*[x×]\s*$/i.exec(before);
        if (each) { count = NUM_WORDS[each[1].toLowerCase()] || parseInt(each[1], 10) || 1; before = each[2]; }
        else if (/^\s*(?:each|apiece)\b/i.test(text.slice(hit.end, hit.end + 10))) {
          const lead = /(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+([a-z][a-z\s-]*?)\s*[,:(-]?\s*$/i.exec(before);
          if (lead) { count = NUM_WORDS[lead[1].toLowerCase()] || parseInt(lead[1], 10) || 1; before = lead[2]; }
        }
        const name = tidyName(before);
        if (!name || /^\d/.test(name) || LETTER.test(name)) return;
        out.push({ name, pts: hit.pts, count, total: TOTAL.test(name) });
      });
      return out;
    }
    function findPointsBreakdown(lines) {
      const entries = [];
      lines.forEach((line, li) => parsePointsLine(line).forEach(e => entries.push({ ...e, line: li })));
      let best = null;
      for (let i = 0; i < entries.length; i++) {
        if (entries[i].total) continue;
        const run = [];
        for (let j = i; j < entries.length && !entries[j].total; j++) {
          if (j > i && entries[j].line - entries[j - 1].line > 3) break;
          run.push(entries[j]);
        }
        if (run.length < 3) continue;
        const sum = run.reduce((s, e) => s + e.pts * e.count, 0);
        const next = entries[i + run.length];
        const confirmed = !!(next && next.total && Math.abs(next.pts - sum) < 0.01 && next.line - run[run.length - 1].line <= 3);
        const score = run.length + (confirmed ? 100 : 0);
        if (!best || score > best.score) best = { run, sum, score };
      }
      if (!best) return null;
      return best.run.map(({ name, pts, count }) => ({ name, pts, count, pct: (pts / best.sum) * 100, total: best.sum }));
    }

    // Find the run of entries that adds up to 100%.
    function findBreakdown(lines) {
      const entries = [];
      lines.forEach((line, li) => parseLine(line).forEach(e => entries.push({ ...e, line: li })));
      let best = null;
      for (let i = 0; i < entries.length; i++) {
        let sum = 0;
        for (let j = i; j < entries.length; j++) {
          if (j > i && entries[j].line - entries[j - 1].line > 6) break;
          sum += entries[j].pct * entries[j].count;
          if (sum > 101.5) break;
          if (sum >= 98.5 && j > i && (!best || j - i + 1 > best.length)) best = entries.slice(i, j + 1);
        }
      }
      return best ? best.map(({ name, pct, count }) => ({ name, pct, count })) : null;
    }
    // Percent breakdown, else points breakdown.
    function findAnyBreakdown(lines) { return findBreakdown(lines) || findPointsBreakdown(lines); }

    const SYN = { hw: 'homework', hws: 'homework', homeworks: 'homework', assignments: 'assignment', assgn: 'assignment',
      exams: 'exam', test: 'exam', tests: 'exam', examination: 'exam', midterms: 'midterm', mid: 'midterm', midterm: 'midterm',
      quizzes: 'quiz', labs: 'lab', laboratory: 'lab', projects: 'project', proj: 'project', attendance: 'participation',
      participation: 'participation', discussions: 'discussion', papers: 'paper', essays: 'essay', presentations: 'presentation',
      readings: 'reading', reflections: 'reflection', checkpoints: 'checkpoint', exercises: 'exercise', finals: 'final',
      sprints: 'sprint', ics: 'inclass', 'in-class': 'inclass' };
    const STOP = new Set(['the', 'and', 'of', 'grade', 'grades', 'points', 'pts', 'total', 'score', 'scores', 'course', 'class', 'imported']);
    function tokens(s) {
      const t = String(s || '').toLowerCase().replace(/([a-z])(\d)/g, '$1 $2').replace(/mid[\s-]?term/g, 'midterm').replace(/in[\s-]class/g, 'inclass')
        .replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean);
      return t.map(w => {
        if (SYN[w]) return SYN[w];
        if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
        if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
        return w;
      }).filter(w => !STOP.has(w));
    }
    function similarity(a, b) {
      const A = tokens(a), B = tokens(b);
      if (!A.length || !B.length) return 0;
      const numsA = A.filter(w => /^\d+$/.test(w)), numsB = B.filter(w => /^\d+$/.test(w));
      if (numsA.length && numsB.length && !numsA.some(n => numsB.includes(n))) return 0;
      const wa = A.filter(w => !/^\d+$/.test(w)), wb = B.filter(w => !/^\d+$/.test(w));
      const inter = wa.filter(w => wb.includes(w)).length;
      if (!inter) return 0;
      const contain = inter / Math.min(new Set(wa).size, new Set(wb).size);
      const jac = inter / new Set([...wa, ...wb]).size;
      return 0.6 * contain + 0.4 * jac;
    }

    // Match breakdown entries to Canvas groups by name.
    function matchGroups(breakdown, groups) {
      const weights = {}, used = [], unmatched = [];
      const byPoints = breakdown.some(e => e.pts != null);
      if (byPoints) {
        const groupsOf = {};
        breakdown.forEach(e => {
          let bestG = null, bestS = 0;
          groups.forEach(g => { const sc = similarity(e.name, g.name); if (sc > bestS) { bestS = sc; bestG = g; } });
          const pct = e.pct * e.count;
          if (!bestG || bestS < 0.5) { unmatched.push({ name: e.name, pct, pts: e.pts * e.count }); return; }
          weights[bestG.id] = (weights[bestG.id] || 0) + pct;
          (groupsOf[bestG.id] = groupsOf[bestG.id] || []).push(e.name);
          used.push({ name: e.name, pct, pts: e.pts * e.count, groups: [bestG.name] });
        });
        return { weights, used, unmatched, byPoints: true, total: breakdown[0].total };
      }
      const free = new Set(groups.map(g => g.id));
      const pairs = [];
      breakdown.forEach((e, ei) => groups.forEach(g => {
        const s = similarity(e.name, g.name);
        if (s >= 0.5) pairs.push({ ei, id: g.id, s });
      }));
      pairs.sort((x, y) => y.s - x.s);
      const got = breakdown.map(() => []);
      for (const p of pairs) {
        const e = breakdown[p.ei];
        if (!free.has(p.id) || got[p.ei].length >= e.count) continue;
        got[p.ei].push(p.id);
        free.delete(p.id);
      }
      breakdown.forEach((e, ei) => {
        const ids = got[ei];
        if (!ids.length) { unmatched.push({ name: e.name, pct: e.pct * e.count }); return; }
        const per = ids.length >= e.count ? e.pct : (e.pct * e.count) / ids.length;
        ids.forEach(id => { weights[id] = (weights[id] || 0) + per; });
        used.push({ name: e.name, pct: e.pct * e.count, groups: ids.map(id => groups.find(g => g.id === id).name) });
      });
      return { weights, used, unmatched };
    }

    // Browser only: HTML -> text lines (table rows become "cell | cell").
    function htmlToLines(html) {
      const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
      doc.querySelectorAll('script, style').forEach(el => el.remove());
      doc.querySelectorAll('tr').forEach(tr => {
        const cells = [...tr.children].map(td => clean(td.textContent)).filter(Boolean);
        tr.replaceWith(doc.createTextNode('\n' + cells.join(' | ') + '\n'));
      });
      doc.querySelectorAll('br').forEach(el => el.replaceWith('\n'));
      doc.querySelectorAll('p, li, div, h1, h2, h3, h4, h5, h6, table, ul, ol, section, blockquote, pre').forEach(el => el.append('\n'));
      return (doc.body ? doc.body.textContent : '').split('\n').map(clean).filter(Boolean);
    }

    // Complete a breakdown that doesn't add up to 100% from Canvas group weights.
    const pctOf = w => { const m = /^\s*~?(\d+(?:\.\d+)?)\s*%/.exec(String(w || '')); return m ? +m[1] : null; };
    const fmtPct = x => (Math.round(x * 10) / 10) + '%';
    function completeGrading(grading, groups) {
      const items = (grading || []).map(g => ({ ...g }));
      const canvas = (groups || []).filter(g => g.pct > 0);
      const sumOf = l => l.reduce((a, g) => a + (pctOf(g.weight) || 0), 0);
      const pctMode = items.every(g => !g.weight || pctOf(g.weight) != null);
      const ok = l => l.length && l.every(g => pctOf(g.weight) != null) && Math.abs(sumOf(l) - 100) <= 1;
      if (ok(items) || !canvas.length) return { grading: items, canvas: null, sum: sumOf(items) };
      const best = name => {
        let b = null, bs = 0;
        canvas.forEach(g => { const sc = similarity(name, g.name); if (sc > bs) { bs = sc; b = g; } });
        return bs >= 0.5 ? b : null;
      };
      const used = new Set();
      for (const it of items) {
        const g = best(it.item);
        if (!g) continue;
        used.add(g);
        if (!it.weight) { it.weight = fmtPct(g.pct); it.source = 'grades'; }
      }
      const rest = canvas.filter(g => !used.has(g));
      const missing = 100 - sumOf(items);
      const restSum = rest.reduce((a, g) => a + g.pct, 0);
      if (pctMode && rest.length && restSum <= missing + 1) {
        rest.forEach(g => items.push({ item: g.name, weight: fmtPct(g.pct), source: 'grades' }));
      }
      const merged = ok(items);
      return { grading: items, sum: sumOf(items),
        canvas: merged ? null : canvas.map(g => ({ item: g.name, weight: fmtPct(g.pct) })) };
    }

    NS.breakdown = { parseLine, parsePointsLine, findBreakdown, findPointsBreakdown, findAnyBreakdown, matchGroups, similarity, tokens, htmlToLines, completeGrading };
  })(NS);

  return { grades: NS.grades, breakdown: NS.breakdown };
});
