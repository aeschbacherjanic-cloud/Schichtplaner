// Fachregeln: Schichtzeiten, GAV AOT Anhang 2 und Jahreskonto.
const Rules = (() => {
  const t = (h, m = 0) => h * 60 + m;

  // Zeiten in Minuten ab Mitternacht des Einsatztags. Ein Ende über 1440 liegt am Folgetag.
  const CODES = {
    '0530': { label: '0530', start: t(5, 30), end: t(13, 42) },
    '0730': { label: '0730', start: t(7, 30), end: t(15, 42) },
    '0930': { label: '0930', start: t(9, 30), end: t(17, 42) },
    '1400': { label: '1400', start: t(13, 48), end: t(22) },
    '1600': { label: '1600', start: t(15, 48), end: t(24) },
    N1: { label: 'N1', start: t(20), end: t(30) },
    N2: { label: 'N2', start: t(21, 30), end: t(31, 30) },
    NC: { label: 'NC', start: t(20), end: t(30) },
    B: { label: 'Büro', start: t(9), end: t(17, 12) },
    I: { label: 'Instruktion', start: t(9), end: t(17, 12) },
    L: { label: 'Leave' },
    R: { label: 'R-Tag' },
    F: { label: 'Ferien' },
  };
  const SHIFTS = ['0530', '0730', '0930', '1400', '1600', 'N1', 'N2'];
  const CODE_ORDER = [...SHIFTS, 'NC', 'B', 'I', 'L', 'R', 'F'];
  const WORK = new Set([...SHIFTS, 'NC', 'B', 'I']);
  const FREE = new Set(['R', 'F', 'L']);
  const NEXT_IN_BLOCK = { 1600: 'N1', N1: 'N2', N2: 'L', NC: 'L', L: 'R' };

  const STANDARD_HOURS = 8.2;
  const WORK_DAYS_PER_YEAR = 248;

  const nightMinutes = (c) => {
    const { start, end } = CODES[c];
    const overlap = (a, b) => Math.max(0, Math.min(end, b) - Math.max(start, a));
    return overlap(0, t(6)) + overlap(t(20), t(30));
  };
  // Dienstzeit plus 10 Minuten Zeitzuschlag pro Nachtstunde (20 bis 6 Uhr), anteilig gerechnet.
  const creditedHours = (c) => {
    if (!WORK.has(c)) return 0;
    const { start, end } = CODES[c];
    return (end - start) / 60 + (nightMinutes(c) / 60) * (10 / 60);
  };

  // Datum als JJJJ-MM-TT, gerechnet in UTC, damit die Sommerzeit keine Rolle spielt.
  const toDate = (iso) => new Date(`${iso}T00:00:00Z`);
  const toIso = (d) => d.toISOString().slice(0, 10);
  const addDays = (iso, n) => {
    const d = toDate(iso);
    d.setUTCDate(d.getUTCDate() + n);
    return toIso(d);
  };
  const weekday = (iso) => (toDate(iso).getUTCDay() + 6) % 7; // Montag = 0
  const isWeekend = (iso) => weekday(iso) >= 5;
  const isSunday = (iso) => weekday(iso) === 6;
  const daysInMonth = (ym) => {
    const [y, m] = ym.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  };
  const monthDates = (ym) =>
    Array.from({ length: daysInMonth(ym) }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`);
  const yearMonths = (year) =>
    Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const daysInYear = (year) => yearMonths(year).reduce((sum, ym) => sum + daysInMonth(ym), 0);
  // AIRAC: alle 28 Tage an einem Mittwoch, gerechnet ab dem Termin vom 25. November 2026.
  const AIRAC_ANCHOR = '2026-11-25';
  const isAirac = (iso) => {
    const days = Math.round((toDate(iso) - toDate(AIRAC_ANCHOR)) / 864e5);
    return ((days % 28) + 28) % 28 === 0;
  };
  const instructionDates = (ym) => monthDates(ym).filter((d) => weekday(d) === 2).slice(0, 3);

  const getCode = (plan, pid, date) => plan[pid]?.[date]?.c ?? null;
  const isPinned = (plan, pid, date) => !!plan[pid]?.[date]?.p;
  const setCode = (plan, pid, date, c, pinned = false) => {
    plan[pid] ??= {};
    if (c === null) delete plan[pid][date];
    else plan[pid][date] = { c, p: pinned };
  };

  // GAV 2.5.1: massgebend ist das Altersjahr, das im Kalenderjahr vollendet wird.
  const vacationDays = (birthYear, year) => {
    const age = year - birthYear;
    if (age >= 59) return 34;
    if (age === 58) return 33;
    if (age === 57) return 31;
    return 29;
  };

  // 117 R-Tage bei 100 %, je 10 Prozentpunkte weniger Pensum geben 22 R-Tage mehr.
  const yearTargetR = (person) => 117 + (100 - person.pensum) * 2.2;

  // Monatsziel: Anteil am Jahresziel plus Rückstand aus den bereits geplanten Monaten des Jahres.
  const monthTargetR = (person, plan, ym) => {
    const year = Number(ym.slice(0, 4));
    const perDay = yearTargetR(person) / daysInYear(year);
    let carry = 0;
    for (const m of yearMonths(year)) {
      if (m >= ym) break;
      const dates = monthDates(m);
      if (!dates.some((d) => getCode(plan, person.id, d))) continue;
      carry += perDay * dates.length - dates.filter((d) => getCode(plan, person.id, d) === 'R').length;
    }
    return Math.max(8, Math.round(perDay * daysInMonth(ym) + carry));
  };

  // Mindestruhe vor einem Einsatz in Minuten: 11 h, mit R-Tagen dazwischen 24 h pro R-Tag plus 11 h.
  const requiredRest = (rDays) => (rDays > 0 ? rDays * 24 * 60 + 11 * 60 : 11 * 60);

  // Alle Paare aufeinanderfolgender Einsätze einer Person im Bereich von Datum a bis b.
  const workPairs = (plan, pid, a, b) => {
    const pairs = [];
    let prev = null;
    let offset = 0;
    let rDays = 0;
    for (let d = a; d <= b; d = addDays(d, 1), offset++) {
      const c = getCode(plan, pid, d);
      if (c === null) {
        prev = null;
        rDays = 0;
      } else if (c === 'R') {
        rDays++;
      } else if (WORK.has(c)) {
        if (prev) {
          const rest = offset * 1440 + CODES[c].start - (prev.offset * 1440 + CODES[prev.code].end);
          pairs.push({ from: prev.date, to: d, code: c, prevCode: prev.code, rest, rDays });
        }
        prev = { code: c, offset, date: d };
        rDays = 0;
      }
    }
    return pairs;
  };

  const fmtRest = (min) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} h`;
  const fmtDate = (iso) => `${iso.slice(8)}.${iso.slice(5, 7)}.`;
  const mondayOf = (iso) => addDays(iso, -weekday(iso));

  const validate = (persons, plan, ym) => {
    const issues = [];
    const dates = monthDates(ym);
    const first = dates[0];
    const last = dates[dates.length - 1];
    const inMonth = (d) => d >= first && d <= last;
    const year = Number(ym.slice(0, 4));
    const add = (level, rule, pid, date, msg) => issues.push({ level, rule, pid, date, msg });

    const anyPlanned = persons.some((p) => dates.some((d) => getCode(plan, p.id, d)));
    if (!anyPlanned) return issues;

    for (const d of dates) {
      for (const s of SHIFTS) {
        const holders = persons.filter((p) => getCode(plan, p.id, d) === s);
        if (holders.length === 0) add('fehler', 'Besetzung', null, d, `${fmtDate(d)}: Schicht ${s} ist nicht besetzt.`);
        for (const extra of holders.slice(1)) {
          add('fehler', 'Besetzung', extra.id, d, `${fmtDate(d)}: Schicht ${s} ist mehrfach besetzt.`);
        }
      }
      const nc = persons.filter((p) => getCode(plan, p.id, d) === 'NC');
      if (isAirac(d) && nc.length === 0) add('fehler', 'AIRAC', null, d, `${fmtDate(d)}: AIRAC, Schicht NC ist nicht besetzt.`);
      for (const extra of nc.slice(isAirac(d) ? 1 : 0)) {
        add('fehler', 'AIRAC', extra.id, d, `${fmtDate(d)}: NC gibt es nur einmal und nur am AIRAC-Termin.`);
      }
    }

    for (const p of persons) {
      const code = (d) => getCode(plan, p.id, d);
      const who = p.name;
      const issue = (level, rule, d, msg) => add(level, rule, p.id, d, `${who}, ${fmtDate(d)}: ${msg}`);

      const open = dates.filter((d) => !code(d)).length;
      if (open > 0) add('hinweis', 'Offen', p.id, null, `${who}: ${open} Tage sind noch nicht eingeteilt.`);
      const complete = open === 0;

      // Nachtblock: 1600, N1, N2, Leave, dann R-Tag oder Ferien
      for (const d of dates) {
        const c = code(d);
        const before = code(addDays(d, -1));
        const after = code(addDays(d, 1));
        const expected = NEXT_IN_BLOCK[c];
        if (expected && after) {
          const ok = c === 'L' ? after === 'R' || after === 'F' : after === expected;
          if (!ok) issue('fehler', 'Nachtblock', d, `Auf ${CODES[c].label} muss ${expected === 'R' ? 'ein R-Tag oder Ferien' : CODES[expected].label} folgen.`);
        }
        const previous = { N1: '1600', N2: 'N1' }[c];
        if (previous && before && before !== previous) {
          issue('fehler', 'Nachtblock', d, `Vor ${CODES[c].label} muss ${CODES[previous].label} liegen.`);
        }
        if (c === 'L' && before && before !== 'N2' && before !== 'NC') {
          issue('fehler', 'Nachtblock', d, 'Vor Leave muss N2 oder NC liegen.');
        }
        if (c === 'NC' && !p.nc) issue('fehler', 'AIRAC', d, 'Diese Person ist nicht für NC vorgesehen.');
      }

      // Art. 2.3 und 3.1: Ruhezeiten
      const pairs = workPairs(plan, p.id, addDays(first, -21), addDays(last, 7));
      const reducedByWeek = {};
      for (const pair of pairs) {
        const week = mondayOf(pair.to);
        if (pair.rDays === 0 && pair.rest < 660) (reducedByWeek[week] ??= []).push(pair);
        if (!inMonth(pair.to)) continue;
        const label = `${pair.prevCode} zu ${pair.code}`;
        if (pair.rDays > 0 && pair.rest < requiredRest(pair.rDays)) {
          issue('fehler', 'Arbeitsfreier Tag', pair.to, `${label}: ${fmtRest(pair.rest)} Ruhe, nötig für ${pair.rDays} R-Tag(e) sind ${fmtRest(requiredRest(pair.rDays))}.`);
        } else if (pair.rDays === 0 && pair.rest < 480) {
          issue('fehler', 'Ruhezeit', pair.to, `${label}: nur ${fmtRest(pair.rest)} Ruhe, Minimum sind 8 h.`);
        } else if (pair.rDays === 0 && pair.rest < 540) {
          issue('warnung', 'Ruhezeit', pair.to, `${label}: ${fmtRest(pair.rest)} Ruhe, nur mit Einverständnis der Person erlaubt.`);
        } else if (pair.rDays === 0 && pair.rest < 660) {
          issue('warnung', 'Ruhezeit', pair.to, `${label}: ${fmtRest(pair.rest)} Ruhe, verkürzte Ruhezeit.`);
        }
      }
      for (const [week, list] of Object.entries(reducedByWeek)) {
        if (list.length > 1 && inMonth(list[1].to)) {
          issue('fehler', 'Ruhezeit', list[1].to, 'Mehr als eine verkürzte Ruhezeit in dieser Kalenderwoche.');
        }
        const span = pairs.filter((x) => x.to >= week && x.to < addDays(week, 14));
        const mean = span.reduce((sum, x) => sum + x.rest, 0) / span.length;
        const fortnightPlanned = Array.from({ length: 14 }, (_, i) => addDays(week, i)).every((d) => code(d));
        if (fortnightPlanned && mean < 660 && inMonth(list[0].to)) {
          issue('fehler', 'Ruhezeit', list[0].to, 'Die Ruhezeit liegt im Schnitt von 2 Wochen unter 11 h.');
        }
      }

      // Art. 2.5 Abs. 4: höchstens 7 Arbeitstage in Folge
      let run = 0;
      for (let d = addDays(first, -7); d <= last; d = addDays(d, 1)) {
        run = WORK.has(code(d)) ? run + 1 : 0;
        if (run === 8 && inMonth(d)) issue('fehler', 'Arbeitstage in Folge', d, 'Mehr als 7 Arbeitstage in Folge.');
      }

      // Art. 2.5 Abs. 5: mindestens ein freier Tag pro Kalenderwoche
      for (let w = mondayOf(first); w <= last; w = addDays(w, 7)) {
        const week = Array.from({ length: 7 }, (_, i) => addDays(w, i));
        if (week.every((d) => WORK.has(code(d)))) issue('fehler', 'Freier Tag pro Woche', w, 'Kein freier Tag in dieser Kalenderwoche.');
      }

      // Art. 2.5 Abs. 3: arbeitsfreie Tage pro Monat
      if (complete) {
        const rCount = dates.filter((d) => code(d) === 'R').length;
        if (rCount < 6) issue('fehler', 'R-Tage pro Monat', first, `Nur ${rCount} R-Tage im Monat, Minimum sind 6.`);
        else if (rCount < 8) issue('warnung', 'R-Tage pro Monat', first, `Nur ${rCount} R-Tage im Monat. Unter 8 braucht es beidseitiges Einverständnis.`);
      }

      // Art. 5.1 Abs. 2: höchstens 14 Nachtarbeiten in 28 Tagen
      for (const end of dates) {
        const nights = Array.from({ length: 28 }, (_, i) => code(addDays(end, -i))).filter((c) => c === 'N1' || c === 'N2' || c === 'NC').length;
        if (nights > 14) {
          issue('fehler', 'Nachtarbeit', end, `${nights} Nachtarbeiten in 28 Tagen, erlaubt sind 14.`);
          break;
        }
      }

      // Art. 2.6 Abs. 3: mindestens ein freier Sonntag pro 28 Tage
      for (const end of dates.filter(isSunday)) {
        const sundays = [0, 7, 14, 21].map((n) => addDays(end, -n));
        if (sundays.every((s) => code(s)) && !sundays.some((s) => isFreeSunday(plan, p.id, s))) {
          issue('warnung', 'Sonntag', end, 'Kein freier Sonntag in 28 Tagen. Das braucht das Einvernehmen der Person.');
        }
      }

      // Instruktion und Büro
      const allowed = instructionDates(ym);
      const instruction = dates.filter((d) => code(d) === 'I');
      if (complete && instruction.length !== 1) {
        issue('fehler', 'Instruktion', first, `${instruction.length} Instruktionstage im Monat, nötig ist genau einer.`);
      }
      for (const d of instruction) {
        if (!allowed.includes(d)) issue('fehler', 'Instruktion', d, 'Instruktion ist nur an den drei festgelegten Mittwochen möglich.');
      }
      for (const d of dates) {
        if (code(d) === 'B' && isWeekend(d)) issue('fehler', 'Büro', d, 'Bürotage gibt es nur von Montag bis Freitag.');
      }

      // Art. 2.5 Abs. 6: freies Wochenende, soweit betrieblich möglich
      const saturdays = dates.filter((d) => weekday(d) === 5 && addDays(d, 1) <= last);
      if (complete && saturdays.length && !saturdays.some((d) => FREE.has(code(d)) && code(d) !== 'L' && isFreeSunday(plan, p.id, addDays(d, 1)))) {
        add('hinweis', 'Freies Wochenende', p.id, first, `${who}: kein vollständig freies Wochenende in diesem Monat.`);
      }

      // Jahresregeln, sobald das Jahr vollständig geplant ist
      const entitled = vacationDays(p.birthYear, year);
      const k = account(p, plan, year);
      if (k.counts.F > entitled) {
        add('warnung', 'Ferien', p.id, null, `${who}: ${k.counts.F} Ferientage eingetragen, Anspruch sind ${entitled}.`);
      }
      if (ym.endsWith('-12') && k.plannedDays === daysInYear(year)) {
        if (k.counts.R < 117) add('fehler', 'R-Tage pro Jahr', p.id, null, `${who}: ${k.counts.R} R-Tage im Jahr, Minimum sind 117.`);
        if (k.freeSundays < 24) add('fehler', 'Sonntag', p.id, null, `${who}: ${k.freeSundays} freie Sonntage im Jahr, Minimum sind 24.`);
        else if (k.freeSundays < 30) add('warnung', 'Sonntag', p.id, null, `${who}: ${k.freeSundays} freie Sonntage im Jahr. Unter 30 braucht es das Einvernehmen.`);
      }
    }
    return issues;
  };

  // Ein Sonntag zählt nur, wenn er von 0 bis 24 Uhr frei ist.
  const isFreeSunday = (plan, pid, d) => {
    const c = getCode(plan, pid, d);
    if (c !== 'R' && c !== 'F') return false;
    const before = getCode(plan, pid, addDays(d, -1));
    return before !== 'N1' && before !== 'N2' && before !== 'NC';
  };

  // Wünsche: { pid: { datum: code } }. Sie sind unverbindlich, GAV und Besetzung gehen immer vor.
  const MAX_WISHES_PER_MONTH = 5;
  const WISH_CODES = ['R', '0530', '0730', '0930', '1400', '1600', 'B'];
  const WISH_LABELS = { R: 'Frei', 1600: 'Nachtblock', B: 'Büro' };
  const wishLabel = (c) => WISH_LABELS[c] ?? c;

  const wishFulfilled = (c, actual) => (c === 'R' ? FREE.has(actual) : c === actual);

  const wishesInMonth = (wishes, pid, ym) =>
    Object.keys(wishes[pid] ?? {}).filter((d) => d.startsWith(ym)).sort();

  const wishResults = (persons, wishes, plan, ym) => {
    const results = [];
    for (const p of persons) {
      for (const date of wishesInMonth(wishes, p.id, ym)) {
        const code = wishes[p.id][date];
        const actual = getCode(plan, p.id, date);
        results.push({ pid: p.id, name: p.name, date, code, actual, ok: wishFulfilled(code, actual) });
      }
    }
    return results;
  };

  // Erfüllte Wünsche pro Person in den Monaten des Jahres vor dem gewählten Monat.
  const wishesFulfilledBefore = (persons, wishes, plan, ym) => {
    const counts = Object.fromEntries(persons.map((p) => [p.id, 0]));
    for (const m of yearMonths(Number(ym.slice(0, 4)))) {
      if (m >= ym) break;
      for (const r of wishResults(persons, wishes, plan, m)) if (r.ok) counts[r.pid]++;
    }
    return counts;
  };

  const account = (person, plan, year) => {
    const counts = Object.fromEntries(Object.keys(CODES).map((c) => [c, 0]));
    let hours = 0;
    let plannedDays = 0;
    let freeSundays = 0;
    let workedWeekendDays = 0;
    for (const ym of yearMonths(year)) {
      for (const d of monthDates(ym)) {
        const c = getCode(plan, person.id, d);
        if (!c) continue;
        counts[c]++;
        plannedDays++;
        // Ein Ferientag zählt entsprechend dem Pensum.
        hours += c === 'F' ? STANDARD_HOURS * (person.pensum / 100) : creditedHours(c);
        if (isSunday(d) && isFreeSunday(plan, person.id, d)) freeSundays++;
        if (isWeekend(d) && WORK.has(c)) workedWeekendDays++;
      }
    }
    const targetHours = (WORK_DAYS_PER_YEAR * STANDARD_HOURS * (person.pensum / 100) * plannedDays) / daysInYear(year);
    return {
      counts,
      hours,
      targetHours,
      saldo: hours - targetHours,
      plannedDays,
      freeSundays,
      workedWeekendDays,
      nightBlocks: counts['1600'],
      targetR: yearTargetR(person),
      vacationEntitlement: vacationDays(person.birthYear, year),
    };
  };

  return {
    CODES, SHIFTS, CODE_ORDER, WORK, FREE, NEXT_IN_BLOCK,
    creditedHours, addDays, weekday, isWeekend, isSunday, daysInMonth, monthDates, yearMonths,
    instructionDates, isAirac, getCode, isPinned, setCode, vacationDays, yearTargetR, monthTargetR,
    requiredRest, workPairs, validate, isFreeSunday, account, fmtDate, mondayOf,
    MAX_WISHES_PER_MONTH, WISH_CODES, wishLabel, wishesInMonth, wishResults, wishesFulfilledBefore,
  };
})();

if (typeof module !== 'undefined') module.exports = Rules;
