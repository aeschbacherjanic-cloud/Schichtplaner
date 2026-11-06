// Aufruf: node tests/run.js
const assert = require('node:assert');
const R = require('../src/rules.js');
const Solver = require('../src/solver.js');

const P = (id, pensum = 100, birthYear = 1985) => ({ id, name: id, pensum, birthYear });
const rulesFor = (plan, ym, persons = [P('a')]) => R.validate(persons, plan, ym).filter((i) => i.pid === 'a');
const has = (issues, rule, level) => issues.some((i) => i.rule === rule && i.level === level);
const planOf = (first, codes) => {
  const plan = { a: {} };
  codes.forEach((c, i) => { if (c) plan.a[R.addDays(first, i)] = { c, p: false }; });
  return plan;
};

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`ok - ${name}`);
};

test('AIRAC alle 28 Tage ab 25.11.2026, immer Mittwoch', () => {
  assert.equal(R.isAirac('2026-11-25'), true);
  assert.equal(R.isAirac('2026-12-23'), true);
  assert.equal(R.isAirac('2027-01-20'), true);
  assert.equal(R.isAirac('2026-10-28'), true);
  assert.equal(R.isAirac('2026-12-16'), false);
  for (let d = '2026-11-25', i = 0; i < 30; i++, d = R.addDays(d, 28)) assert.equal(R.weekday(d), 2);
});

test('AIRAC: NC nur für festgelegte Personen, am Termin, danach Leave und frei', () => {
  const nc = [{ id: 'a', name: 'a', pensum: 100, birthYear: 1985, nc: true }];
  const no = [{ id: 'a', name: 'a', pensum: 100, birthYear: 1985, nc: false }];
  const good = R.validate(nc, planOf('2027-01-20', ['NC', 'L', 'R', '0530']), '2027-01').filter((i) => i.pid === 'a');
  assert.ok(!good.some((i) => i.level === 'fehler' && i.date >= '2027-01-20' && i.date <= '2027-01-23'), JSON.stringify(good));
  assert.ok(has(R.validate(no, planOf('2027-01-20', ['NC', 'L', 'R']), '2027-01').filter((i) => i.pid === 'a'), 'AIRAC', 'fehler'));
  assert.ok(has(R.validate(nc, planOf('2027-01-13', ['NC', 'L', 'R']), '2027-01').filter((i) => i.pid === 'a'), 'AIRAC', 'fehler'));
  assert.ok(has(R.validate(nc, planOf('2027-01-20', ['NC', '0730']), '2027-01').filter((i) => i.pid === 'a'), 'Nachtblock', 'fehler'));
  assert.ok(has(R.validate(nc, planOf('2027-01-20', ['NC', 'L', '0730']), '2027-01').filter((i) => i.pid === 'a'), 'Nachtblock', 'fehler'));
  assert.ok(R.validate(nc, planOf('2027-01-10', ['R']), '2027-01').some((i) => i.rule === 'AIRAC' && i.date === '2027-01-20' && !i.pid));
});

test('Dauer und Zeitzuschlag der Schichten', () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 0.001, `${a} != ${b}`);
  near(R.creditedHours('0730'), 8.2);
  near(R.creditedHours('0530'), 8.2 + 5 / 60);
  near(R.creditedHours('1400'), 8.2 + 20 / 60);
  near(R.creditedHours('1600'), 8.2 + 40 / 60);
  near(R.creditedHours('N1'), 10 + 100 / 60);
  near(R.creditedHours('N2'), 10 + 85 / 60);
  near(R.creditedHours('NC'), 10 + 100 / 60);
  near(R.creditedHours('L'), 0);
});

test('Ferienanspruch nach Alter', () => {
  assert.equal(R.vacationDays(1990, 2027), 29);
  assert.equal(R.vacationDays(1970, 2027), 31);
  assert.equal(R.vacationDays(1969, 2027), 33);
  assert.equal(R.vacationDays(1968, 2027), 34);
  assert.equal(R.vacationDays(1960, 2027), 34);
});

test('Jahresziel R-Tage', () => {
  assert.equal(R.yearTargetR(P('a')), 117);
  assert.ok(Math.abs(R.yearTargetR(P('a', 80)) - 161) < 0.001);
  assert.ok(Math.abs(R.yearTargetR(P('a', 90)) - 139) < 0.001);
});

test('Drei erste Mittwoche', () => {
  assert.deepEqual(R.instructionDates('2027-01'), ['2027-01-06', '2027-01-13', '2027-01-20']);
});

test('Ruhezeit: 1400 zu 0530 ist verboten', () => {
  const issues = rulesFor(planOf('2027-01-11', ['1400', '0530']), '2027-01');
  assert.ok(has(issues, 'Ruhezeit', 'fehler'));
});

test('Ruhezeit: 1400 zu 0730 ist eine Warnung (9:30 h)', () => {
  const issues = rulesFor(planOf('2027-01-11', ['1400', '0730']), '2027-01');
  assert.ok(has(issues, 'Ruhezeit', 'warnung'));
  assert.ok(!has(issues, 'Ruhezeit', 'fehler'));
});

test('Ruhezeit: zwei Verkürzungen in einer Woche sind ein Fehler', () => {
  const issues = rulesFor(planOf('2027-01-11', ['1400', '0730', '1400', '0730']), '2027-01');
  assert.ok(has(issues, 'Ruhezeit', 'fehler'));
});

test('35 h: 1400, R-Tag, 0730 ist verboten, 0930 erlaubt', () => {
  assert.ok(has(rulesFor(planOf('2027-01-11', ['1400', 'R', '0730']), '2027-01'), 'Arbeitsfreier Tag', 'fehler'));
  assert.ok(!has(rulesFor(planOf('2027-01-11', ['1400', 'R', '0930']), '2027-01'), 'Arbeitsfreier Tag', 'fehler'));
});

test('Nachtblock: richtige Folge ist gültig', () => {
  const issues = rulesFor(planOf('2027-01-11', ['1600', 'N1', 'N2', 'L', 'R', '0530']), '2027-01');
  assert.ok(!has(issues, 'Nachtblock', 'fehler'));
  assert.ok(!has(issues, 'Arbeitsfreier Tag', 'fehler'));
});

test('Nachtblock: Arbeit direkt nach Leave ist verboten (Variante B)', () => {
  const issues = rulesFor(planOf('2027-01-11', ['1600', 'N1', 'N2', 'L', '0530']), '2027-01');
  assert.ok(has(issues, 'Nachtblock', 'fehler'));
});

test('Nachtblock: N1 ohne 1600 ist verboten', () => {
  assert.ok(has(rulesFor(planOf('2027-01-11', ['0730', 'N1']), '2027-01'), 'Nachtblock', 'fehler'));
});

test('NC: Ferientag zählt nach Pensum, NC zählt als Nachtarbeit', () => {
  const plan = planOf('2027-01-11', ['F']);
  assert.ok(Math.abs(R.account(P('a', 80), plan, 2027).hours - 6.56) < 0.001);
  assert.ok(Math.abs(R.account(P('a'), plan, 2027).hours - 8.2) < 0.001);
  assert.equal(R.isFreeSunday(planOf('2027-01-16', ['NC', 'R']), 'a', '2027-01-17'), false);
});

test('RU: 10 Tage verbrauchen 5 Ferientage und zählen wie Ferien', () => {
  const plan = {};
  const days = ['2027-05-03', '2027-05-04', '2027-05-05', '2027-05-06', '2027-05-07', '2027-05-10', '2027-05-11', '2027-05-12', '2027-05-13', '2027-05-14'];
  days.forEach((d) => R.setCode(plan, 'a', d, 'RU', true));
  R.setCode(plan, 'a', '2027-06-07', 'F', true);
  const k = R.account(P('a'), plan, 2027);
  assert.equal(k.counts.RU, 10);
  assert.equal(k.vacationUsed, 6);
  assert.ok(Math.abs(k.hours - 11 * 8.2) < 0.001);
  assert.ok(Math.abs(R.account(P('a', 80), plan, 2027).hours - 11 * 6.56) < 0.001);
  assert.ok(!rulesFor(plan, '2027-05').some((i) => i.rule === 'RU'));
  R.setCode(plan, 'a', days[9], null);
  assert.ok(rulesFor(plan, '2027-05').some((i) => i.rule === 'RU' && i.level === 'warnung'));
});

test('RU: zu wenig Ferien bleiben als Warnung sichtbar', () => {
  const plan = {};
  for (let i = 0; i < 28; i++) R.setCode(plan, 'a', R.addDays('2027-03-01', i), 'F', true);
  for (let i = 0; i < 10; i++) R.setCode(plan, 'a', R.addDays('2027-05-03', i), 'RU', true);
  assert.ok(rulesFor(plan, '2027-05').some((i) => i.rule === 'Ferien' && i.level === 'warnung'));
});

test('RU: Nach Leave gilt RU als frei, und der freie Sonntag zählt', () => {
  assert.ok(!has(rulesFor(planOf('2027-05-03', ['N2', 'L', 'RU']), '2027-05'), 'Nachtblock', 'fehler'));
  assert.equal(R.isFreeSunday(planOf('2027-05-08', ['RU', 'RU']), 'a', '2027-05-09'), true);
});

test('Mehr als 7 Arbeitstage in Folge', () => {
  const issues = rulesFor(planOf('2027-01-11', Array(8).fill('0730')), '2027-01');
  assert.ok(has(issues, 'Arbeitstage in Folge', 'fehler'));
});

test('Kein freier Tag in der Kalenderwoche', () => {
  const issues = rulesFor(planOf('2027-01-11', Array(7).fill('0730')), '2027-01');
  assert.ok(has(issues, 'Freier Tag pro Woche', 'fehler'));
});

test('Mehr als 14 Nachtarbeiten in 28 Tagen', () => {
  const issues = rulesFor(planOf('2027-01-01', Array(15).fill('N1')), '2027-01');
  assert.ok(has(issues, 'Nachtarbeit', 'fehler'));
});

test('Büro am Wochenende und Instruktion am falschen Tag', () => {
  assert.ok(has(rulesFor(planOf('2027-01-09', ['B']), '2027-01'), 'Büro', 'fehler'));
  assert.ok(has(rulesFor(planOf('2027-01-27', ['I']), '2027-01'), 'Instruktion', 'fehler'));
});

test('Sonntag nach Samstagsnacht zählt nicht als frei', () => {
  const plan = planOf('2027-01-16', ['N1', 'R']);
  assert.equal(R.isFreeSunday(plan, 'a', '2027-01-17'), false);
  assert.equal(R.isFreeSunday(planOf('2027-01-16', ['R', 'R']), 'a', '2027-01-17'), true);
});

// Beispielteam und ein ganzes Jahr, Monat für Monat wie in der Webseite
const team = Array.from({ length: 24 }, (_, i) => P(`p${String(i + 1).padStart(2, '0')}`));
team[22].pensum = 80; team[22].birthYear = 1964;
team[23].pensum = 90; team[23].birthYear = 1977;
team[20].birthYear = 1968; team[21].birthYear = 1969;
team.slice(0, 6).forEach((p) => { p.nc = true; });

const addVacation = (plan) => {
  // Jede Person bekommt ihren Anspruch in Wochen zu 5 Tagen über das Jahr verteilt.
  team.forEach((p, idx) => {
    let left = R.vacationDays(p.birthYear, 2027);
    let monday = R.addDays('2027-01-04', (idx % 6) * 7);
    while (left > 0) {
      for (let i = 0; i < 5 && left > 0; i++, left--) R.setCode(plan, p.id, R.addDays(monday, i), 'F', true);
      monday = R.addDays(monday, 7 * 7);
    }
  });
};

const simulate = (timeMs) => {
  let plan = {};
  addVacation(plan);
  const errors = [];
  const warnings = [];
  for (const ym of R.yearMonths(2027)) {
    const result = Solver.generate(team, plan, ym, { timeMs });
    plan = result.plan;
    for (const i of result.issues) {
      if (i.level === 'fehler') errors.push(`${ym} ${i.msg}`);
      if (i.level === 'warnung') warnings.push(`${ym} ${i.msg}`);
    }
  }
  return { plan, errors, warnings };
};

test('Ganzes Jahr: alle Regeln eingehalten', () => {
  const { plan, errors, warnings } = simulate(Number(process.env.SIM_MS ?? 500));
  const rows = team.map((p) => {
    const k = R.account(p, plan, 2027);
    return {
      p: p.id, pens: p.pensum, R: k.counts.R, ziel: +k.targetR.toFixed(1), F: k.counts.F, So: k.freeSundays,
      Bl: k.nightBlocks, NC: k.counts.NC, L: k.counts.L, B: k.counts.B, I: k.counts.I, a: k.counts['0530'], b: k.counts['0730'],
      c: k.counts['0930'], d: k.counts['1400'], we: k.workedWeekendDays, saldo: +k.saldo.toFixed(1), tage: k.plannedDays,
    };
  });
  console.table(rows);
  console.log(`Fehler: ${errors.length}, Warnungen: ${warnings.length}`);
  errors.slice(0, 25).forEach((e) => console.log(`  F ${e}`));
  warnings.slice(0, 10).forEach((w) => console.log(`  W ${w}`));
  for (const d of R.monthDates('2027-03')) {
    for (const s of R.SHIFTS) assert.equal(team.filter((p) => R.getCode(plan, p.id, d) === s).length, 1, `${d} ${s}`);
  }
  const airacs = R.yearMonths(2027).flatMap(R.monthDates).filter(R.isAirac);
  assert.equal(airacs.length, 13);
  for (const d of airacs) {
    const holders = team.filter((p) => R.getCode(plan, p.id, d) === 'NC');
    assert.equal(holders.length, 1, d);
    assert.ok(holders[0].nc, d);
    assert.equal(R.getCode(plan, holders[0].id, R.addDays(d, 1)), 'L', d);
  }
  assert.equal(errors.length, 0);
});

test('RU: bleibt beim Erzeugen erhalten, der Planer plant darum herum', () => {
  const plan = {};
  for (let i = 0; i < 12; i++) {
    const d = R.addDays('2027-06-07', i);
    if (!R.isWeekend(d)) R.setCode(plan, 'p07', d, 'RU', true);
  }
  const { plan: out, issues } = Solver.generate(team, plan, '2027-06', { timeMs: 300 });
  assert.equal(issues.filter((i) => i.level === 'fehler').length, 0);
  assert.equal(R.monthDates('2027-06').filter((d) => R.getCode(out, 'p07', d) === 'RU').length, 10);
});

test('Ferien: Erkennung der Wochenenden und des ersten Werktags', () => {
  const plan = {};
  for (const d of ['2027-05-10', '2027-05-11', '2027-05-12', '2027-05-13', '2027-05-14']) R.setCode(plan, 'a', d, 'F', true);
  for (const d of ['2027-05-08', '2027-05-09', '2027-05-15', '2027-05-16']) assert.equal(R.isVacationWeekend(plan, 'a', d), true, d);
  assert.equal(R.isVacationWeekend(plan, 'a', '2027-05-01'), false);
  assert.equal(R.isVacationWeekend(plan, 'a', '2027-05-22'), false);
  assert.equal(R.startsAfterVacation(plan, 'a', '2027-05-17'), true);
  assert.equal(R.startsAfterVacation(plan, 'a', '2027-05-18'), false);
  assert.equal(R.startsAfterVacation(plan, 'a', '2027-05-10'), false);
  const midweek = {};
  R.setCode(midweek, 'a', '2027-05-11', 'F', true);
  assert.equal(R.startsAfterVacation(midweek, 'a', '2027-05-12'), true);
  assert.equal(R.isVacationWeekend(midweek, 'a', '2027-05-08'), false);
});

test('Ferien: Prüfung warnt bei Einsatz am Ferien-Wochenende und weist auf Schichtstart hin', () => {
  const plan = {};
  for (const d of ['2027-05-10', '2027-05-11', '2027-05-12', '2027-05-13', '2027-05-14']) R.setCode(plan, 'a', d, 'F', true);
  R.setCode(plan, 'a', '2027-05-08', '0930');
  R.setCode(plan, 'a', '2027-05-17', '0730');
  const issues = rulesFor(plan, '2027-05');
  assert.ok(has(issues, 'Ferien-Wochenende', 'warnung'));
  assert.ok(has(issues, 'Start nach Ferien', 'hinweis'));
});

test('Ferien: Planer hält Wochenenden frei und beginnt danach im Büro', () => {
  const plan = {};
  const weeks = [['p03', '2027-05-10'], ['p04', '2027-05-10'], ['p05', '2027-05-17'], ['p06', '2027-05-03']];
  for (const [pid, monday] of weeks) for (let i = 0; i < 5; i++) R.setCode(plan, pid, R.addDays(monday, i), 'F', true);
  const { plan: out, issues } = Solver.generate(team, plan, '2027-05', { timeMs: 400 });
  assert.equal(issues.filter((i) => i.level === 'fehler').length, 0);
  for (const [pid, monday] of weeks) {
    for (const n of [-2, -1, 5, 6]) {
      const d = R.addDays(monday, n);
      if (d.startsWith('2027-05')) assert.equal(R.getCode(out, pid, d), 'R', `${pid} ${d}`);
    }
    assert.equal(R.getCode(out, pid, R.addDays(monday, 7)), 'B', `${pid} Montag danach`);
  }
});

test('Fixierte Einträge bleiben beim Erzeugen erhalten', () => {
  const plan = {};
  R.setCode(plan, 'p05', '2027-02-10', 'F', true);
  R.setCode(plan, 'p06', '2027-02-11', '0930', true);
  const out = Solver.generate(team, plan, '2027-02', { timeMs: 100 }).plan;
  assert.equal(R.getCode(out, 'p05', '2027-02-10'), 'F');
  assert.equal(R.getCode(out, 'p06', '2027-02-11'), '0930');
});

test('Wunsch: frei zählt auch als erfüllt bei Ferien und Leave', () => {
  const plan = {};
  R.setCode(plan, 'p01', '2027-03-02', 'F');
  R.setCode(plan, 'p02', '2027-03-02', '0530');
  const wishes = { p01: { '2027-03-02': 'R' }, p02: { '2027-03-02': 'R' } };
  const results = R.wishResults(team, wishes, plan, '2027-03');
  assert.equal(results.find((r) => r.pid === 'p01').ok, true);
  assert.equal(results.find((r) => r.pid === 'p02').ok, false);
});

test('Wunsch: wird beim Erzeugen berücksichtigt', () => {
  const wishes = { p03: { '2027-02-09': 'R', '2027-02-16': '0730', '2027-02-23': 'B' }, p04: { '2027-02-10': '1600' } };
  const { plan } = Solver.generate(team, {}, '2027-02', { timeMs: 300, wishes });
  assert.equal(R.getCode(plan, 'p03', '2027-02-09'), 'R');
  assert.equal(R.getCode(plan, 'p03', '2027-02-16'), '0730');
  assert.equal(R.getCode(plan, 'p03', '2027-02-23'), 'B');
  assert.equal(R.getCode(plan, 'p04', '2027-02-10'), '1600');
  assert.equal(R.getCode(plan, 'p04', '2027-02-11'), 'N1');
});

test('Wunsch: Vorrang für weniger erfüllte Wünsche', () => {
  // p01 bekam im Februar drei Wünsche erfüllt, p02 keinen. Beide wollen dieselbe Schicht.
  const plan = {};
  const wishes = { p01: { '2027-03-09': '0530' }, p02: { '2027-03-09': '0530' } };
  for (const d of ['2027-02-02', '2027-02-09', '2027-02-16']) {
    R.setCode(plan, 'p01', d, 'R');
    wishes.p01[d] = 'R';
  }
  const out = Solver.generate(team, plan, '2027-03', { timeMs: 300, wishes }).plan;
  assert.equal(R.getCode(out, 'p02', '2027-03-09'), '0530');
  assert.notEqual(R.getCode(out, 'p01', '2027-03-09'), '0530');
});

test('Wunsch: bricht keine Regel, auch wenn er unmöglich ist', () => {
  const wishes = { p05: { '2027-02-10': '1400', '2027-02-11': '0530', '2027-02-13': 'B' } };
  const { plan, issues } = Solver.generate(team, {}, '2027-02', { timeMs: 300, wishes });
  assert.equal(issues.filter((i) => i.level === 'fehler').length, 0);
  assert.notEqual(R.getCode(plan, 'p05', '2027-02-13'), 'B');
  assert.ok(!(R.getCode(plan, 'p05', '2027-02-10') === '1400' && R.getCode(plan, 'p05', '2027-02-11') === '0530'));
});

test('Ganzes Jahr mit 5 Wünschen pro Person und Monat', () => {
  let seed = 12345;
  const next = (n) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  let plan = {};
  addVacation(plan);
  const wishes = {};
  const errors = [];
  let total = 0;
  let met = 0;
  for (const ym of R.yearMonths(2027)) {
    const days = R.monthDates(ym);
    for (const p of team) {
      wishes[p.id] ??= {};
      for (let i = 0; i < R.MAX_WISHES_PER_MONTH; i++) {
        const c = next(100) < 70 ? 'R' : R.WISH_CODES[next(R.WISH_CODES.length)];
        wishes[p.id][days[next(days.length)]] = c;
      }
    }
    const result = Solver.generate(team, plan, ym, { timeMs: Number(process.env.SIM_MS ?? 500), wishes });
    plan = result.plan;
    errors.push(...result.issues.filter((i) => i.level === 'fehler').map((i) => `${ym} ${i.msg}`));
    const r = R.wishResults(team, wishes, plan, ym);
    total += r.length;
    met += r.filter((x) => x.ok).length;
  }
  const perPerson = team.map((p) => R.yearMonths(2027).flatMap((m) => R.wishResults([p], wishes, plan, m)).filter((x) => x.ok).length);
  console.log(`Wünsche erfüllt: ${met} von ${total} (${Math.round((met / total) * 100)} %), pro Person ${Math.min(...perPerson)} bis ${Math.max(...perPerson)}`);
  errors.slice(0, 15).forEach((e) => console.log(`  F ${e}`));
  assert.equal(errors.length, 0);
});

console.log(`\n${passed} Tests bestanden`);
