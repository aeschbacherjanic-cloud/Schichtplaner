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

test('Dauer und Zeitzuschlag der Schichten', () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 0.001, `${a} != ${b}`);
  near(R.creditedHours('0730'), 8.2);
  near(R.creditedHours('0530'), 8.2 + 5 / 60);
  near(R.creditedHours('1400'), 8.2 + 20 / 60);
  near(R.creditedHours('1600'), 8.2 + 40 / 60);
  near(R.creditedHours('N1'), 10 + 100 / 60);
  near(R.creditedHours('N2'), 10 + 85 / 60);
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
  assert.equal(R.yearTargetR(P('a'), 2027), 117);
  assert.ok(Math.abs(R.yearTargetR(P('a', 80), 2027) - 166.6) < 0.001);
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
      Bl: k.nightBlocks, L: k.counts.L, B: k.counts.B, I: k.counts.I, a: k.counts['0530'], b: k.counts['0730'],
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
  assert.equal(errors.length, 0);
});

test('Fixierte Einträge bleiben beim Erzeugen erhalten', () => {
  const plan = {};
  R.setCode(plan, 'p05', '2027-02-10', 'F', true);
  R.setCode(plan, 'p06', '2027-02-11', '0930', true);
  const out = Solver.generate(team, plan, '2027-02', { timeMs: 100 }).plan;
  assert.equal(R.getCode(out, 'p05', '2027-02-10'), 'F');
  assert.equal(R.getCode(out, 'p06', '2027-02-11'), '0930');
});

console.log(`\n${passed} Tests bestanden`);
