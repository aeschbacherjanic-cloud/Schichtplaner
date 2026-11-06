// Oberfläche: Plan, Jahreskonto, Personen und Ferien. Alle Daten bleiben im Browser.
(() => {
  const R = Rules;
  const STORAGE_KEY = 'schichtplaner-v1';
  const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const SHORT = { B: 'B', I: 'I', L: 'L', R: 'R', F: 'F', RU: 'RU' };
  const $ = (id) => document.getElementById(id);

  const samplePersons = () => {
    const persons = Array.from({ length: 24 }, (_, i) => ({
      id: `p${i + 1}`, name: `Person ${String(i + 1).padStart(2, '0')}`, pensum: 100, birthYear: 1985,
    }));
    for (const p of persons) p.nc = false;
    for (const p of persons.slice(0, 6)) p.nc = true;
    persons[20].birthYear = 1968;
    persons[21].birthYear = 1968;
    Object.assign(persons[22], { pensum: 80, birthYear: 1964 });
    Object.assign(persons[23], { pensum: 90, birthYear: 1977 });
    return persons;
  };

  const load = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved?.persons && saved?.plan) return saved;
    } catch {
      // Ohne gespeicherte Daten startet die Seite mit dem Beispielteam.
    }
    return { persons: samplePersons(), plan: {}, month: '2027-01', tab: 'plan' };
  };
  const state = load();
  state.wishes ??= {};
  const save = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      $('status').textContent = 'Speichern im Browser nicht möglich. Bitte «Daten sichern» nutzen.';
    }
  };

  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v);
    }
    node.append(...children);
    return node;
  };
  const shortOf = (c) => SHORT[c] ?? c;
  const monthName = (ym) => `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`;
  const shiftMonth = (ym, n) => {
    const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5)) - 1 + n, 1));
    return d.toISOString().slice(0, 7);
  };
  const download = (name, type, content) => {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = el('a', { href: url, download: name });
    a.click();
    URL.revokeObjectURL(url);
  };

  function renderPlan() {
    const ym = state.month;
    const dates = R.monthDates(ym);
    const termine = R.instructionDates(ym);
    const issues = R.validate(state.persons, state.plan, ym);
    const results = R.wishResults(state.persons, state.wishes, state.plan, ym);
    $('month-label').textContent = monthName(ym);

    const marks = {};
    for (const i of issues) {
      if (!i.pid || !i.date || i.level === 'hinweis') continue;
      const key = `${i.pid}|${i.date}`;
      if (marks[key] !== 'fehler') marks[key] = i.level;
    }

    const head = el('tr', {}, el('th', { class: 'name', text: 'Person' }));
    for (const d of dates) {
      const isTermin = termine.includes(d);
      const airac = R.isAirac(d);
      const th = el('th', { class: `${R.isWeekend(d) ? 'we' : ''} ${isTermin || airac ? 'termin' : ''}`.trim() }, d.slice(8));
      th.append(el('small', { text: `${isTermin ? 'I' : 'Mi'}${airac ? '·A' : isTermin ? '·Mi' : ''}`.replace(/^Mi$/, DAYS[R.weekday(d)]) }));
      th.title = [isTermin && 'Instruktionstermin', airac && 'AIRAC: Schicht NC'].filter(Boolean).join(', ');
      head.append(th);
    }

    const body = el('tbody');
    for (const p of state.persons) {
      const row = el('tr', {}, el('th', { class: 'name', text: p.name }));
      for (const d of dates) {
        const c = R.getCode(state.plan, p.id, d);
        const mark = marks[`${p.id}|${d}`];
        const wish = state.wishes[p.id]?.[d];
        const classes = ['cell'];
        if (c) classes.push(`c-${c}`);
        if (wish) classes.push(c ? (results.find((r) => r.pid === p.id && r.date === d).ok ? 'wish-ok' : 'wish-no') : 'wish-open');
        if (R.isPinned(state.plan, p.id, d)) classes.push('pinned');
        if (mark) classes.push(`has-${mark}`);
        const button = el('button', {
          class: classes.join(' '), type: 'button', 'data-pid': p.id, 'data-date': d,
          text: c ? shortOf(c) : (wish ? `${shortOf(wish)}?` : ''),
          'aria-label': `${p.name}, ${R.fmtDate(d)}: ${c ? R.CODES[c].label : 'leer'}${wish ? `, Wunsch ${R.wishLabel(wish)}` : ''}`,
        });
        if (wish) button.title = `Wunsch: ${R.wishLabel(wish)}`;
        row.append(el('td', { class: R.isWeekend(d) ? 'we' : '' }, button));
      }
      body.append(row);
    }

    const foot = el('tfoot');
    for (const [c, label] of [['B', 'Büro pro Tag'], ['R', 'R-Tage pro Tag']]) {
      const row = el('tr', {}, el('th', { class: 'name', text: label }));
      for (const d of dates) {
        const n = state.persons.filter((p) => R.getCode(state.plan, p.id, d) === c).length;
        row.append(el('td', { class: R.isWeekend(d) ? 'we' : '', text: n || '' }));
      }
      foot.append(row);
    }

    $('grid').replaceChildren(el('thead', {}, head), body, foot);

    const counts = { fehler: 0, warnung: 0, hinweis: 0 };
    for (const i of issues) counts[i.level]++;
    const planned = state.persons.some((p) => dates.some((d) => R.getCode(state.plan, p.id, d)));
    const pills = [];
    if (!planned) pills.push(el('span', { class: 'pill hinweis', text: 'Noch kein Plan für diesen Monat' }));
    else if (counts.fehler === 0) pills.push(el('span', { class: 'pill ok', text: 'Alle harten Regeln eingehalten' }));
    if (counts.fehler) pills.push(el('span', { class: 'pill fehler', text: `${counts.fehler} Fehler` }));
    if (counts.warnung) pills.push(el('span', { class: 'pill warnung', text: `${counts.warnung} Warnungen` }));
    if (counts.hinweis) pills.push(el('span', { class: 'pill hinweis', text: `${counts.hinweis} Hinweise` }));
    const decided = results.filter((r) => r.actual);
    if (decided.length) pills.push(el('span', { class: 'pill wish', text: `Wünsche: ${decided.filter((r) => r.ok).length} von ${decided.length} erfüllt` }));
    else if (results.length) pills.push(el('span', { class: 'pill wish', text: `${results.length} Wünsche erfasst` }));
    $('summary').replaceChildren(...pills);

    const unmet = decided.filter((r) => !r.ok);
    $('wishes').replaceChildren(...(unmet.length ? [el(
      'div', { class: 'issue-group' },
      el('h2', { text: 'Nicht erfüllte Wünsche' }),
      el('ul', {}, ...unmet.map((r) => el('li', {
        text: `${r.name}, ${R.fmtDate(r.date)}: ${R.wishLabel(r.code)} gewünscht, eingeteilt ${R.CODES[r.actual].label}.`,
      }))),
    )] : []));

    const groups = [['fehler', 'Fehler'], ['warnung', 'Warnungen'], ['hinweis', 'Hinweise']];
    $('issues').replaceChildren(...groups.filter(([level]) => counts[level]).map(([level, title]) => el(
      'div', { class: 'issue-group' },
      el('h2', { text: title }),
      el('ul', {}, ...issues.filter((i) => i.level === level).map((i) => el('li', { text: i.msg }))),
    )));
  }

  function renderLegend() {
    const items = R.CODE_ORDER.map((c) => el('span', {
      class: `c-${c}`, text: c === 'R' || SHORT[c] ? `${shortOf(c)} = ${R.CODES[c].label}` : c,
    }));
    $('legend').replaceChildren(...items, el('em', { text: 'Punkt = fixiert. Dreieck = Wunsch: grün erfüllt, rot nicht erfüllt, blau noch offen. I·Mi = Instruktionstermin, Mi·A = AIRAC mit Schicht NC.' }));
  }

  function renderKonto() {
    const year = Number(state.month.slice(0, 4));
    $('konto-year').textContent = `Jahr ${year}`;
    const columns = ['Person', 'Pensum', 'Tage geplant', 'R-Tage', 'Jahresziel R', 'Ferien verbraucht', 'Anspruch', 'RU', 'Freie Sonntage', 'Nachtblöcke', 'NC', 'Leave', 'Büro', 'Instruktion', '0530', '0730', '0930', '1400', 'Weekend-Einsätze', 'Saldo h', 'Wünsche erfüllt'];
    const head = el('tr', {}, ...columns.map((text) => el('th', { text })));
    const rows = state.persons.map((p) => {
      const k = R.account(p, state.plan, year);
      const wishResults = R.yearMonths(year)
        .flatMap((m) => R.wishResults([p], state.wishes, state.plan, m))
        .filter((r) => r.actual);
      const cells = [
        p.name, `${p.pensum} %`, k.plannedDays, k.counts.R, k.targetR.toFixed(1).replace(/\.0$/, ''),
        k.vacationUsed, k.vacationEntitlement, k.counts.RU, k.freeSundays, k.nightBlocks, k.counts.NC, k.counts.L, k.counts.B, k.counts.I,
        k.counts['0530'], k.counts['0730'], k.counts['0930'], k.counts['1400'], k.workedWeekendDays,
        k.saldo.toFixed(1), `${wishResults.filter((r) => r.ok).length} / ${wishResults.length}`,
      ].map((text) => el('td', { text }));
      if (k.vacationUsed > k.vacationEntitlement) cells[5].classList.add('bad');
      return el('tr', {}, ...cells);
    });
    $('konto').replaceChildren(el('thead', {}, head), el('tbody', {}, ...rows));
  }

  function renderPersonen() {
    const year = Number(state.month.slice(0, 4));
    $('ferien-person').replaceChildren(...state.persons.map((p) => el('option', { value: p.id, text: p.name })));
    const head = el('tr', {}, ...['Name', 'Pensum %', 'Jahrgang', 'Darf NC', `Ferien ${year}`, ''].map((text) => el('th', { text })));
    const rows = state.persons.map((p) => {
      const input = (field, type, attrs = {}) => el('input', { type, value: p[field], 'data-pid': p.id, 'data-field': field, 'aria-label': `${field} von ${p.name}`, ...attrs });
      const nc = el('input', { type: 'checkbox', 'data-pid': p.id, 'data-field': 'nc', 'aria-label': `${p.name} darf NC` });
      nc.checked = !!p.nc;
      const remove = el('button', { type: 'button', 'data-remove': p.id, text: 'Entfernen', 'aria-label': `${p.name} entfernen` });
      return el(
        'tr', {},
        el('td', {}, input('name', 'text')),
        el('td', {}, input('pensum', 'number', { min: 10, max: 100, step: 5 })),
        el('td', {}, input('birthYear', 'number', { min: 1940, max: 2015 })),
        el('td', {}, nc),
        el('td', { text: R.vacationDays(p.birthYear, year) }),
        el('td', {}, remove),
      );
    });
    $('personen').replaceChildren(el('thead', {}, head), el('tbody', {}, ...rows));
  }

  function render() {
    for (const tab of document.querySelectorAll('.tab')) tab.classList.toggle('active', tab.dataset.tab === state.tab);
    for (const name of ['plan', 'konto', 'personen']) $(`view-${name}`).hidden = state.tab !== name;
    if (state.tab === 'plan') renderPlan();
    if (state.tab === 'konto') renderKonto();
    if (state.tab === 'personen') renderPersonen();
  }

  // Zellen von Hand setzen: Was hier gewählt wird, ist fixiert.
  const picker = $('picker');
  let pickerTarget = null;
  const closePicker = () => {
    picker.hidden = true;
    pickerTarget?.focus();
    pickerTarget = null;
  };
  function openPicker(button) {
    const { pid, date } = button.dataset;
    const person = state.persons.find((p) => p.id === pid);
    const entries = R.CODE_ORDER.map((c) => {
      const b = el('button', { type: 'button', class: `c-${c}`, text: SHORT[c] ? R.CODES[c].label : c });
      b.addEventListener('click', () => {
        R.setCode(state.plan, pid, date, c, true);
        save();
        closePicker();
        renderPlan();
      });
      return b;
    });
    const release = el('button', { type: 'button', class: 'wide', text: 'Fixierung lösen' });
    release.addEventListener('click', () => {
      const c = R.getCode(state.plan, pid, date);
      if (c) R.setCode(state.plan, pid, date, c, false);
      save();
      closePicker();
      renderPlan();
    });
    const clear = el('button', { type: 'button', class: 'plain', text: 'Leeren' });
    clear.addEventListener('click', () => {
      R.setCode(state.plan, pid, date, null);
      save();
      closePicker();
      renderPlan();
    });
    const ym = date.slice(0, 7);
    const used = R.wishesInMonth(state.wishes, pid, ym).length;
    const current = state.wishes[pid]?.[date];
    const full = used >= R.MAX_WISHES_PER_MONTH && !current;
    const setWish = (c) => {
      state.wishes[pid] ??= {};
      if (c) state.wishes[pid][date] = c;
      else delete state.wishes[pid][date];
      save();
      closePicker();
      renderPlan();
    };
    const wishButtons = R.WISH_CODES.map((c) => {
      const label = c === '1600' ? 'Block' : R.wishLabel(c);
      const b = el('button', { type: 'button', class: `wish-choice${current === c ? ' chosen' : ''}`, text: label, 'aria-label': `Wunsch ${R.wishLabel(c)}` });
      if (c === '1600') b.title = 'Nachtblock ab diesem Tag';
      b.disabled = full;
      b.addEventListener('click', () => setWish(c));
      return b;
    });
    const clearWish = el('button', { type: 'button', class: 'wish-choice', text: 'Löschen', 'aria-label': 'Wunsch löschen' });
    clearWish.disabled = !current;
    clearWish.addEventListener('click', () => setWish(null));
    const wishTitle = el('div', { class: 'title', text: `Wunsch (${used} von ${R.MAX_WISHES_PER_MONTH} in diesem Monat, unverbindlich)` });
    picker.replaceChildren(
      el('div', { class: 'title', text: `${person.name}, ${DAYS[R.weekday(date)]} ${R.fmtDate(date)}` }),
      ...entries, release, clear, wishTitle, ...wishButtons, clearWish,
    );
    picker.hidden = false;
    pickerTarget = button;
    const rect = button.getBoundingClientRect();
    const left = Math.min(rect.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - picker.offsetWidth - 8);
    picker.style.left = `${Math.max(8, left)}px`;
    picker.style.top = `${rect.bottom + window.scrollY + 4}px`;
    picker.querySelector('button').focus();
  }
  $('grid').addEventListener('click', (e) => {
    const button = e.target.closest('.cell');
    if (button) openPicker(button);
  });
  document.addEventListener('click', (e) => {
    if (!picker.hidden && !picker.contains(e.target) && !e.target.closest('.cell')) closePicker();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !picker.hidden) closePicker();
  });

  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => {
      state.tab = tab.dataset.tab;
      save();
      render();
    });
  }
  const changeMonth = (n) => {
    state.month = shiftMonth(state.month, n);
    save();
    render();
  };
  $('btn-prev').addEventListener('click', () => changeMonth(-1));
  $('btn-next').addEventListener('click', () => changeMonth(1));

  $('btn-generate').addEventListener('click', () => {
    const ym = state.month;
    const dates = R.monthDates(ym);
    const replaced = state.persons.some((p) => dates.some((d) => R.getCode(state.plan, p.id, d) && !R.isPinned(state.plan, p.id, d)));
    if (replaced && !confirm(`Der bestehende Plan für ${monthName(ym)} wird ersetzt. Fixierte Einträge bleiben erhalten.`)) return;
    $('status').textContent = 'Rechne …';
    $('btn-generate').disabled = true;
    setTimeout(() => {
      const result = Solver.generate(state.persons, state.plan, ym, { timeMs: 2500, seed: Date.now() % 100000, wishes: state.wishes });
      state.plan = result.plan;
      save();
      $('btn-generate').disabled = false;
      $('status').textContent = `Bester von ${result.runs} Durchläufen.`;
      render();
    }, 30);
  });

  $('btn-clear').addEventListener('click', () => {
    if (!confirm(`Alle nicht fixierten Einträge von ${monthName(state.month)} löschen?`)) return;
    for (const p of state.persons) {
      for (const d of R.monthDates(state.month)) {
        if (!R.isPinned(state.plan, p.id, d)) R.setCode(state.plan, p.id, d, null);
      }
    }
    save();
    render();
  });

  $('btn-print').addEventListener('click', () => window.print());

  $('btn-csv').addEventListener('click', () => {
    const dates = R.monthDates(state.month);
    const cell = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const header = ['Person', ...dates.map((d) => `${DAYS[R.weekday(d)]} ${R.fmtDate(d)}`)];
    const rows = state.persons.map((p) => [p.name, ...dates.map((d) => {
      const c = R.getCode(state.plan, p.id, d);
      return c ? (SHORT[c] ? R.CODES[c].label : c) : '';
    })]);
    const csv = [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');
    download(`schichtplan-${state.month}.csv`, 'text/csv;charset=utf-8', `﻿${csv}`);
  });

  $('btn-export').addEventListener('click', () => {
    download(`schichtplaner-daten-${new Date().toISOString().slice(0, 10)}.json`, 'application/json', JSON.stringify(state, null, 1));
  });
  $('input-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !confirm('Alle Daten in diesem Browser werden durch die Datei ersetzt. Fortfahren?')) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.persons) || typeof data.plan !== 'object') throw new Error('Format');
      Object.assign(state, { wishes: {} }, data);
      save();
      render();
    } catch {
      alert('Diese Datei konnte nicht gelesen werden.');
    }
  });

  $('personen').addEventListener('change', (e) => {
    const { pid, field } = e.target.dataset;
    if (!pid) return;
    const person = state.persons.find((p) => p.id === pid);
    if (field === 'nc') {
      person.nc = e.target.checked;
    } else if (field === 'name') {
      person.name = e.target.value.trim() || person.name;
    } else {
      const value = Number(e.target.value);
      if (Number.isFinite(value) && value > 0) person[field] = value;
    }
    save();
    renderPersonen();
  });
  $('personen').addEventListener('click', (e) => {
    const pid = e.target.dataset.remove;
    if (!pid) return;
    const person = state.persons.find((p) => p.id === pid);
    if (!confirm(`${person.name} und alle Einträge dieser Person löschen?`)) return;
    state.persons = state.persons.filter((p) => p.id !== pid);
    delete state.plan[pid];
    delete state.wishes[pid];
    save();
    renderPersonen();
  });
  $('btn-add-person').addEventListener('click', () => {
    const next = Math.max(0, ...state.persons.map((p) => Number(p.id.slice(1)) || 0)) + 1;
    state.persons.push({ id: `p${next}`, name: `Person ${String(next).padStart(2, '0')}`, pensum: 100, birthYear: 1985, nc: false });
    save();
    renderPersonen();
  });

  const eachDay = (from, to, fn) => {
    for (let d = from; d <= to; d = R.addDays(d, 1)) fn(d);
  };
  $('form-ferien').addEventListener('submit', (e) => {
    e.preventDefault();
    const pid = $('ferien-person').value;
    const kind = $('ferien-art').value;
    let added = 0;
    eachDay($('ferien-von').value, $('ferien-bis').value, (d) => {
      if (!R.isWeekend(d)) {
        R.setCode(state.plan, pid, d, kind, true);
        added++;
      }
    });
    save();
    alert(`${added} Tage ${R.CODES[kind].label} eingetragen.`);
  });
  $('btn-ferien-weg').addEventListener('click', () => {
    const pid = $('ferien-person').value;
    const from = $('ferien-von').value;
    const to = $('ferien-bis').value;
    if (!from || !to) return;
    eachDay(from, to, (d) => {
      if (R.getCode(state.plan, pid, d) === $('ferien-art').value) R.setCode(state.plan, pid, d, null);
    });
    save();
  });

  renderLegend();
  render();
})();
