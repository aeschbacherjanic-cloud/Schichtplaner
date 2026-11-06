// Erzeugt einen Monatsplan: mehrere zufällige Durchläufe, der beste nach Regeln und Fairness gewinnt.
const Solver = (() => {
  const R = typeof Rules !== 'undefined' ? Rules : require('./rules.js');
  const DAY_SHIFTS = ['0530', '1400', '0730', '0930']; // die am stärksten eingeschränkten zuerst

  const makeRandom = (seed) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };

  // Stufen: 0 = normal, 1 und 2 = längere Serien, 3 = auch 9 h Ruhe, falls es nicht anders geht.
  const TIERS = [
    { maxRun: 5, minRest: 660, protectSunday: true },
    { maxRun: 6, minRest: 660, protectSunday: false },
    { maxRun: 7, minRest: 660, protectSunday: false },
    { maxRun: 7, minRest: 540, protectSunday: false },
  ];

  const clearMonth = (plan, persons, dates) => {
    const copy = {};
    for (const p of persons) {
      copy[p.id] = { ...(plan[p.id] ?? {}) };
      for (const d of dates) if (!copy[p.id][d]?.p) delete copy[p.id][d];
    }
    return copy;
  };

  const attempt = (persons, basePlan, ym, seed) => {
    const random = makeRandom(seed);
    const dates = R.monthDates(ym);
    const year = Number(ym.slice(0, 4));
    const plan = clearMonth(basePlan, persons, dates);
    const code = (pid, d) => R.getCode(plan, pid, d);
    const set = (pid, d, c) => R.setCode(plan, pid, d, c);
    const shuffled = () => persons.map((p) => [random(), p]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);

    const usage = Object.fromEntries(persons.map((p) => {
      const k = R.account(p, plan, year);
      return [p.id, { ...k.counts, weekend: k.workedWeekendDays, sundays: k.freeSundays }];
    }));
    const lastBlock = {};

    // Laufende Nachtblöcke aus dem Vormonat und fixierte 1600 fortführen
    const completeBlocks = () => {
      for (const p of persons) {
        for (const d of dates) {
          const expected = R.NEXT_IN_BLOCK[code(p.id, R.addDays(d, -1))];
          if (expected && !code(p.id, d)) set(p.id, d, expected);
        }
      }
    };
    completeBlocks();

    // Instruktion: gleichmässig auf die drei Mittwoche verteilen
    const termine = R.instructionDates(ym);
    for (const p of shuffled()) {
      if (dates.some((d) => code(p.id, d) === 'I')) continue;
      const options = termine
        .filter((d) => !code(p.id, d))
        .map((d) => [persons.filter((q) => code(q.id, d) === 'I').length + random() / 2, d])
        .sort((a, b) => a[0] - b[0]);
      if (options.length) set(p.id, options[0][1], 'I');
    }

    // Nachtblöcke: jeden Tag beginnt einer. Fehlt der Vormonat, wird der laufende Block am Monatsanfang ergänzt.
    const blockSteps = ['1600', 'N1', 'N2', 'L', 'R'];
    const canBlock = (pid, d, from) =>
      blockSteps.slice(from).every((step, i) => {
        const c = code(pid, R.addDays(d, i));
        return c === null || (step === 'R' && c === 'F') || c === step;
      });
    const placeBlock = (pid, d, from) => {
      blockSteps.slice(from).forEach((step, i) => {
        const day = R.addDays(d, i);
        if (day <= dates[dates.length - 1] && !code(pid, day)) set(pid, day, step);
      });
      usage[pid]['1600']++;
      lastBlock[pid] = d;
    };
    const chooseForBlock = (d, from) => {
      let best = null;
      let bestScore = Infinity;
      for (const p of persons) {
        if (!canBlock(p.id, d, from)) continue;
        const gap = lastBlock[p.id] ? (new Date(d) - new Date(lastBlock[p.id])) / 864e5 : 99;
        const score = (usage[p.id]['1600'] + 1) / (p.pensum / 100) + (gap < 14 ? (14 - gap) * 0.6 : 0) + random() * 0.8;
        if (score < bestScore) {
          bestScore = score;
          best = p;
        }
      }
      return best;
    };
    const holder = (d, c) => persons.find((p) => code(p.id, d) === c);
    if (!holder(dates[0], 'N2')) {
      const p = chooseForBlock(dates[0], 2);
      if (p) placeBlock(p.id, dates[0], 2);
    }
    if (!holder(dates[0], 'N1')) {
      const p = chooseForBlock(dates[0], 1);
      if (p) placeBlock(p.id, dates[0], 1);
    }
    for (const d of dates) {
      if (holder(d, '1600')) continue;
      const p = chooseForBlock(d, 0);
      if (p) placeBlock(p.id, d, 0);
    }

    // Prüft einen Einsatz gegen den letzten Einsatz davor und den nächsten danach.
    const restOk = (pid, d, c, minRest) => {
      const check = (a, codeA, b, codeB, rDays, offset) => {
        const rest = offset * 1440 + R.CODES[codeB].start - R.CODES[codeA].end;
        return rest >= (rDays > 0 ? R.requiredRest(rDays) : minRest);
      };
      let rDays = 0;
      for (let i = 1; i <= 14; i++) {
        const prev = code(pid, R.addDays(d, -i));
        if (prev === null) break;
        if (prev === 'R') rDays++;
        else if (R.WORK.has(prev)) {
          if (!check(null, prev, null, c, rDays, i)) return false;
          break;
        }
      }
      rDays = 0;
      for (let i = 1; i <= 14; i++) {
        const next = code(pid, R.addDays(d, i));
        if (next === null) break;
        if (next === 'R') rDays++;
        else if (R.WORK.has(next)) {
          if (!check(null, c, null, next, rDays, i)) return false;
          break;
        }
      }
      return true;
    };

    const runWith = (pid, d) => {
      let run = 1;
      for (let i = 1; R.WORK.has(code(pid, R.addDays(d, -i))); i++) run++;
      for (let i = 1; R.WORK.has(code(pid, R.addDays(d, i))); i++) run++;
      return run;
    };
    const wouldFillWeek = (pid, d) => {
      const monday = R.mondayOf(d);
      return Array.from({ length: 7 }, (_, i) => R.addDays(monday, i)).every((x) => x === d || R.WORK.has(code(pid, x)));
    };
    const missedSundays = (pid, d) =>
      [7, 14, 21].every((n) => {
        const s = R.addDays(d, -n);
        return code(pid, s) && !R.isFreeSunday(plan, pid, s);
      });
    const canWork = (pid, d, c, tier) => {
      if (code(pid, d) !== null || !restOk(pid, d, c, tier.minRest)) return false;
      if (runWith(pid, d) > tier.maxRun || wouldFillWeek(pid, d)) return false;
      if (tier.protectSunday && R.isSunday(d) && missedSundays(pid, d)) return false;
      return true;
    };

    // Tag für Tag die Tagschichten besetzen
    for (const d of dates) {
      for (const s of DAY_SHIFTS) {
        if (holder(d, s)) continue;
        for (const tier of TIERS) {
          let best = null;
          let bestScore = Infinity;
          for (const p of persons) {
            if (!canWork(p.id, d, s, tier)) continue;
            const load = 100 / p.pensum;
            const u = usage[p.id];
            let score = (u[s] + 1) * load + runWith(p.id, d) * 0.7 + random() * 0.9;
            if (R.isWeekend(d)) score += (u.weekend + 1) * load * 0.8;
            if (R.isSunday(d)) score += (u.sundays < 30 ? 1 : 0) * 2;
            if (code(p.id, R.addDays(d, -1)) === s) score -= 0.8;
            if (score < bestScore) {
              bestScore = score;
              best = p;
            }
          }
          if (best) {
            set(best.id, d, s);
            usage[best.id][s]++;
            if (R.isWeekend(d)) usage[best.id].weekend++;
            break;
          }
        }
      }
      // Wer übrig bleibt: am Wochenende R-Tag, sonst Büro oder R-Tag, wenn Büro nicht geht
      for (const p of persons) {
        if (code(p.id, d) !== null) continue;
        const office = !R.isWeekend(d) && canWork(p.id, d, 'B', TIERS[0]);
        set(p.id, d, office ? 'B' : 'R');
      }
    }

    // R-Tage auf das Monatsziel bringen, indem Bürotage getauscht werden
    const longestRunAround = (pid, d) => {
      let before = 0;
      let after = 0;
      for (let i = 1; R.WORK.has(code(pid, R.addDays(d, -i))); i++) before++;
      for (let i = 1; R.WORK.has(code(pid, R.addDays(d, i))); i++) after++;
      return before + after + Math.min(before, after) * 0.5;
    };
    const stillLegalAsR = (pid, d) => {
      let prevOffset = 0;
      let prev = null;
      let rDays = 1;
      for (let i = 1; i <= 14; i++) {
        const c = code(pid, R.addDays(d, -i));
        if (c === null) return true;
        if (c === 'R') rDays++;
        else if (R.WORK.has(c)) {
          prev = c;
          prevOffset = i;
          break;
        }
      }
      if (!prev) return true;
      for (let i = 1; i <= 14; i++) {
        const c = code(pid, R.addDays(d, i));
        if (c === null) return true;
        if (c === 'R') rDays++;
        else if (R.WORK.has(c)) {
          const rest = (i + prevOffset) * 1440 + R.CODES[c].start - R.CODES[prev].end;
          return rest >= R.requiredRest(rDays);
        }
      }
      return true;
    };
    for (const p of persons) {
      let missing = R.monthTargetR(p, plan, ym) - dates.filter((d) => code(p.id, d) === 'R').length;
      while (missing > 0) {
        const options = dates
          .filter((d) => code(p.id, d) === 'B' && !R.isPinned(plan, p.id, d) && stillLegalAsR(p.id, d))
          .map((d) => [longestRunAround(p.id, d) + random() * 1.5, d])
          .sort((a, b) => b[0] - a[0]);
        if (!options.length) break;
        set(p.id, options[0][1], 'R');
        missing--;
      }
      while (missing < 0) {
        const options = dates
          .filter((d) => code(p.id, d) === 'R' && !R.isPinned(plan, p.id, d) && !R.isWeekend(d)
            && code(p.id, R.addDays(d, -1)) !== 'L')
          .filter((d) => {
            set(p.id, d, null);
            const ok = canWork(p.id, d, 'B', TIERS[0]);
            set(p.id, d, 'R');
            return ok;
          })
          .map((d) => [longestRunAround(p.id, d) + random() * 1.5, d])
          .sort((a, b) => a[0] - b[0]);
        if (!options.length) break;
        set(p.id, options[0][1], 'B');
        missing++;
      }
    }
    return plan;
  };

  // Bewertung: Regelverstösse zuerst, danach Abweichung von R-Ziel und Fairness im Jahr.
  const score = (persons, plan, ym) => {
    const issues = R.validate(persons, plan, ym);
    const year = Number(ym.slice(0, 4));
    let total = 0;
    for (const issue of issues) {
      total += issue.level === 'fehler' ? 100000 : issue.level === 'warnung' ? 1000 : 20;
    }
    const accounts = persons.map((p) => [p, R.account(p, plan, year)]);
    const spread = (value) => {
      const values = accounts.map(([p, k]) => value(k) / (p.pensum / 100));
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      return values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    };
    for (const s of R.SHIFTS) total += spread((k) => k.counts[s]) * 6;
    total += spread((k) => k.workedWeekendDays) * 6;
    total += spread((k) => k.saldo) * 0.5;
    for (const p of persons) {
      const got = R.monthDates(ym).filter((d) => R.getCode(plan, p.id, d) === 'R').length;
      total += Math.abs(got - R.monthTargetR(p, plan, ym)) * 40;
    }
    return { total, issues };
  };

  const generate = (persons, basePlan, ym, { timeMs = 1500, seed = 1 } = {}) => {
    const started = Date.now();
    let best = null;
    let runs = 0;
    do {
      const plan = attempt(persons, basePlan, ym, seed + runs * 7919);
      const result = score(persons, plan, ym);
      if (!best || result.total < best.total) best = { plan, ...result };
      runs++;
    } while (Date.now() - started < timeMs);
    return { plan: best.plan, issues: best.issues, runs };
  };

  return { generate };
})();

if (typeof module !== 'undefined') module.exports = Solver;
