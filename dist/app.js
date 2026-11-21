'use strict';

const model = window.FinScopeModel;
const agent = window.FinScopeAgent;
const storage = window.FinScopeStorage;
const $ = id => document.getElementById(id);
const numbers = new Intl.NumberFormat('ru-KZ');
const compact = new Intl.NumberFormat('ru-KZ', { notation: 'compact', maximumFractionDigits: 1 });
const monthNames = new Intl.DateTimeFormat('ru-KZ', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const shortDates = new Intl.DateTimeFormat('ru-KZ', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const shortMonths = new Intl.DateTimeFormat('ru-KZ', { timeZone: 'UTC', month: 'short' });
const longDates = new Intl.DateTimeFormat('ru-KZ', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });
const archiveDates = new Intl.DateTimeFormat('ru-KZ', { dateStyle: 'short', timeStyle: 'short' });
const demo = model.parseCsv(model.demo);
const demoDuplicate = model.parseCsv(model.demo + '\n' + model.demo.split('\n').at(-1));
const perPage = 7;
const auditPageSize = 8;
const state = { data: demo, month: '', rows: [], bucket: 'week', page: 0, range: null, repeatIds: null,
  priceType: 'annual', priceMonth: agent.prices.at(-1).month, auditIndex: 0, auditPage: 0, qualityPage: 0,
  route: '', archiveEntries: [], limits: new Map(), budgetRead: 0 };
const routes = { overview: 'Обзор', transactions: 'Операции', quality: 'Проверка CSV', analytics: 'Аналитика',
  budget: 'Бюджет', archive: 'Архив', assistant: 'ИИ-помощник', prices: 'Статистика БНС' };
const transactionControls = ['filter-from', 'filter-to', 'filter-min', 'filter-max', 'filter-audit', 'filter-sort'];
let agentMemory;
let toastTimer;
let importRequest = 0;
let sourceRevision = 0;

function escape(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function icon(name) {
  return '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
}

function date(iso) {
  return new Date(iso + 'T00:00:00Z');
}

function monthName(month) {
  const label = monthNames.format(date(month + '-01'));
  return label.slice(0, 1).toUpperCase() + label.slice(1).replace(/\s*г\.$/, '');
}

function money(amount) {
  return new Intl.NumberFormat('ru-KZ', {
    style: 'currency', currency: state.data.currency, currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 0, maximumFractionDigits: 2,
  }).format(amount / 100);
}

function percent(value) {
  return numbers.format(Math.round(value * 100)) + '%';
}

function signed(amount, formatter = money) {
  return (amount > 0 ? '+' : amount < 0 ? '−' : '') + formatter(Math.abs(amount));
}

function populate(data, source = '', record = null) {
  sourceRevision++;
  state.base = data;
  state.source = source;
  state.record = record;
  state.decisions = record ? new Map(record.decisions) : new Map();
  state.data = record ? model.reviewedData(data, state.decisions) : data;
  state.auditDrafts = new Map();
  state.savingReview = false;
  state.auditByRow = new Map(data.duplicateGroups.flatMap(group =>
    group.members.map(row => [row.id, group.id])));
  state.qualityPage = 0;
  $('quality-status').value = '';
  $('quality-kind').value = '';
  syncPeriods();
  $('source-label').innerHTML = '<span>' + escape(source || 'Демоданные') + '</span>';
  $('source-label').disabled = !source;
  $('source-label').title = source ? 'Вернуться к демоданным' : 'Вымышленная выписка';
  if (source) $('source-label').setAttribute('aria-label', 'Вернуться к демоданным');
  else $('source-label').removeAttribute('aria-label');
  renderStatementStatus();
  renderAuditBanner();
  resetAgent();
  selectMonth();
}

function renderStatementStatus() {
  if (state.base === demo || state.base === demoDuplicate) {
    $('statement-status').textContent = state.base === demo ? 'Демовыписка · июнь–октябрь 2026' : 'Демовыписка с повторной операцией';
  } else {
    $('statement-status').textContent = (state.record ? 'В архиве' : 'Открыта без сохранения') + ' · ' +
      longDates.format(date(state.data.firstDate)) + ' — ' + longDates.format(date(state.data.lastDate));
  }
}

async function renderArchive() {
  $('archive-status').textContent = 'Загрузка архива…';
  $('archive-list').replaceChildren();
  try {
    state.archiveEntries = await storage.list();
    renderArchiveCount(state.archiveEntries.length);
    if (state.route === 'archive') renderArchiveList();
  } catch {
    if (state.route === 'archive') $('archive-status').textContent = 'Браузер не предоставил доступ к локальной базе.';
  }
}

function renderArchiveList() {
  const all = state.archiveEntries;
  const query = model.normalize($('archive-search').value.trim());
  const entries = all.filter(entry => model.normalize(entry.filename).includes(query));
  $('archive-status').textContent = all.length ? 'Выписки: ' + entries.length + ' из ' + all.length :
    'Архив пока пуст. Загрузите CSV, чтобы добавить выписку.';
  $('archive-list').innerHTML = entries.map(entry => {
      const active = state.record?.id === entry.id;
      const dateRange = longDates.format(date(entry.firstDate)) + ' — ' + longDates.format(date(entry.lastDate));
      const filename = escape(entry.filename);
      const id = escape(entry.id);
      const auditStatus = entry.pending > 0 ? 'На проверке: ' + entry.pending : 'Совпадений на проверке нет';
      return '<article class="archive-entry' + (active ? ' archive-current' : '') + '">' +
        '<span class="archive-entry-icon">' + icon('receipt') + '</span><div class="archive-entry-content"><strong>' + filename +
        '</strong><span>' + escape(dateRange + ' · ' + entry.rows + ' строк · ' + entry.currency) + '</span>' +
        '<span>Загружено ' + escape(archiveDates.format(entry.importedAt)) + '</span>' +
        '<span class="archive-audit' + (entry.pending ? ' pending' : '') + '">' + auditStatus +
        (entry.excluded ? ' · Исключено: ' + entry.excluded : '') + '</span></div>' +
        '<div class="archive-entry-actions"><button class="button" type="button" data-record="' + id +
        '" aria-label="Открыть ' + filename + '">' + (active ? 'Открыта' : 'Открыть') + '</button>' +
        '<button class="archive-remove" type="button" data-remove="' + id + '" aria-label="Удалить ' + filename +
        '">Удалить</button></div></article>';
  }).join('');
}

function renderArchiveCount(count) {
  $('archive-count').textContent = numbers.format(count);
  $('archive-count').hidden = !count;
}

async function restoreArchive() {
  const revision = sourceRevision;
  try {
    const [active, entries] = await Promise.all([storage.load(), storage.list()]);
    renderArchiveCount(entries.length);
    if (active && revision === sourceRevision) populate(active.data, active.record.filename, active.record);
  } catch {
    // The dashboard can analyze files in memory if browser storage is unavailable.
  }
}

function openDemo() {
  populate(demo);
  storage.setActive(null).catch(() => notify('Демовыписка открыта. Локальная база недоступна.'));
}

function syncPeriods(preferred) {
  $('period').replaceChildren(...[...state.data.months].reverse().map(month => new Option(monthName(month), month)));
  if (state.data.months.includes(preferred)) $('period').value = preferred;
}

const auditReasons = {
  reference: ['Повтор номера операции', 'У строк совпадают номер операции, дата, время, описание, направление и сумма. Сверьте с исходной выпиской.'],
  conflict: ['Один номер, разные реквизиты', 'У строк один номер операции, но различаются реквизиты. Сверьте дату, время, описание, направление и сумму с исходной выпиской.'],
  candidate: ['Возможный дубль', 'Совпадают дата, доступное время, описание, направление и сумма. Это могут быть самостоятельные операции.'],
};

function renderAuditBanner() {
  const { data } = state;
  const pending = data.duplicateGroups.length - data.reviewed;
  const audit = $('audit-banner');
  audit.classList.toggle('audit-warning', pending > 0);
  $('audit-banner-icon').innerHTML = icon(pending ? 'warning' : 'shield');
  $('audit-banner-title').textContent = pending ? 'Совпадений на проверку: ' + numbers.format(pending) : 'Проверка выписки';
  $('audit-message').textContent = pending ?
    'Непроверенные строки пока учитываются в расчётах.' + (data.excluded.size ? ' Исключено после проверки: ' + data.excluded.size + '.' : '') :
    data.reviewed ? 'Проверено групп: ' + data.reviewed + '. Исключено строк: ' + data.excluded.size + '.' : 'Подозрительных совпадений не найдено.';
  $('audit-open').hidden = !data.duplicateGroups.length;
  $('audit-open').textContent = pending ? 'Проверить строки' : 'Решения по строкам';
  $('audit-example').hidden = state.base !== demo;
  $('overview-checks').textContent = pending ? 'Совпадений на проверку: ' + pending :
    data.reviewed ? 'Исключено строк: ' + data.excluded.size : 'Подозрительных совпадений нет';
  renderQuality();
}

function renderQuality() {
  const { data } = state;
  const groups = data.duplicateGroups;
  const pending = groups.length - data.reviewed;
  const excluded = data.operations.filter(row => row.direction === 'out' && data.excluded.has(row.id));
  $('quality-metrics').innerHTML = [['На проверке', pending], ['Проверено групп', data.reviewed],
    ['Исключено из расходов', money(model.total(excluded))]].map(([label, value]) =>
    '<div class="panel page-stat"><span>' + label + '</span><strong>' + escape(value) + '</strong></div>').join('');
  const status = $('quality-status').value;
  const kind = $('quality-kind').value;
  const filtered = groups.filter(group => (!kind || group.kind === kind) &&
    (!status || state.decisions.has(group.id) === (status === 'done')));
  const pages = Math.max(1, Math.ceil(filtered.length / auditPageSize));
  state.qualityPage = Math.min(state.qualityPage, pages - 1);
  $('quality-result').textContent = filtered.length ? 'Групп: ' + filtered.length + ' из ' + groups.length :
    groups.length ? 'По этим фильтрам нет групп.' : 'Подозрительных совпадений не найдено.';
  $('quality-demo').hidden = state.base !== demo;
  $('quality-pagination').hidden = pages <= 1;
  $('quality-page').textContent = (state.qualityPage + 1) + ' / ' + pages;
  $('quality-prev').disabled = state.qualityPage === 0;
  $('quality-next').disabled = state.qualityPage + 1 >= pages;
  $('quality-list').innerHTML = filtered.slice(state.qualityPage * auditPageSize, (state.qualityPage + 1) * auditPageSize).map(group => {
    const done = state.decisions.has(group.id);
    const named = escape(group.members[0].description);
    const lines = group.members.slice(0, 6).map(row => row.line).join(', ') + (group.members.length > 6 ? ' и другие' : '');
    return '<article class="quality-entry"><div><span class="audit-label' + (done ? ' audit-resolved' : '') + '">' +
      (done ? 'Проверено' : 'На проверке') + '</span><h3>' + auditReasons[group.kind][0] + '</h3><p>' + named +
      ' · строки ' + lines + '</p></div><button type="button" class="button" data-group="' + group.id + '">' +
      (done ? 'Открыть решение' : 'Проверить') + '</button></article>';
  }).join('');
}

function auditGroup() {
  return state.data.duplicateGroups[state.auditIndex];
}

function draftFor(group) {
  if (!state.auditDrafts.has(group.id)) {
    state.auditDrafts.set(group.id, new Set(state.decisions.get(group.id) || group.members.map(row => row.id)));
  }
  return state.auditDrafts.get(group.id);
}

function renderAuditImpact() {
  const group = auditGroup();
  const selected = draftFor(group);
  const inAnalysis = group.members.filter(row => row.direction === 'out');
  const before = model.total(inAnalysis.filter(row => !state.data.excluded.has(row.id)));
  const after = model.total(inAnalysis.filter(row => selected.has(row.id)));
  const ignored = group.members.length - selected.size;
  $('audit-save').disabled = selected.size === 0 || state.savingReview;
  $('audit-impact').textContent = !selected.size ? 'Оставьте хотя бы одну строку в группе.' :
    'Строк к исключению: ' + ignored + (inAnalysis.length ? '. Расходы в группе: ' + money(before) + ' → ' + money(after) : '') + '.';
}

function renderAuditDialog() {
  const group = auditGroup();
  const selected = draftFor(group);
  const pages = Math.ceil(group.members.length / auditPageSize);
  const checked = state.decisions.has(group.id);
  const [title, reason] = auditReasons[group.kind];
  $('audit-position').textContent = 'Совпадение ' + (state.auditIndex + 1) + ' из ' + state.data.duplicateGroups.length;
  $('audit-case-title').textContent = title;
  $('audit-case-status').textContent = checked ? 'Проверено' : 'На проверке';
  $('audit-case-status').classList.toggle('audit-resolved', checked);
  $('audit-reason').textContent = reason;
  $('audit-first').hidden = group.kind !== 'reference';
  $('audit-prev').disabled = state.auditIndex === 0;
  $('audit-next').disabled = state.auditIndex + 1 >= state.data.duplicateGroups.length;
  $('audit-row-nav').hidden = pages === 1;
  $('audit-row-position').textContent = (state.auditPage + 1) + ' / ' + pages;
  $('audit-row-prev').disabled = state.auditPage === 0;
  $('audit-row-next').disabled = state.auditPage + 1 >= pages;
  $('audit-rows').innerHTML = group.members.slice(state.auditPage * auditPageSize, (state.auditPage + 1) * auditPageSize).map(row => {
    const direction = { out: 'Списание', in: 'Зачисление', transfer: 'Перевод' }[row.direction];
    const info = [longDates.format(date(row.date)), row.time, direction, row.reference ? '№ ' + row.reference : ''].filter(Boolean).join(' · ');
    return '<tr><td><input type="checkbox" data-row="' + row.id + '" aria-label="Учесть строку ' + row.line + '"' +
      (selected.has(row.id) ? ' checked' : '') + '></td><td>' + row.line + '</td><td><strong>' + escape(row.description) +
      '</strong><small>' + escape(info) + '</small></td><td class="amount">' + escape(money(row.amount)) + '</td></tr>';
  }).join('');
  renderAuditImpact();
}

function openAudit(groupId) {
  const groups = state.data.duplicateGroups;
  if (!groups.length) return;
  const index = groupId ? groups.findIndex(group => group.id === groupId) : groups.findIndex(group => !state.decisions.has(group.id));
  state.auditIndex = Math.max(0, index);
  state.auditPage = 0;
  state.auditDrafts.clear();
  renderAuditDialog();
  $('audit-dialog').showModal();
}

function selectMonth() {
  state.month = $('period').value;
  const snapshot = model.expenseMonth(state.data, state.month);
  state.firstDay = snapshot.first;
  state.lastDay = snapshot.last;
  state.rows = snapshot.rows.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  state.comparison = model.compareMonth(state.data, state.month);
  state.byCategory = model.groups(state.rows);
  state.range = null;
  state.repeatIds = null;
  state.page = 0;
  $('category-filter').replaceChildren(new Option('Все категории', ''), ...state.byCategory.map(([key]) => new Option(model.categories[key].label, key)));
  $('search').value = '';
  clearTransactionTools();
  renderMetrics();
  renderOverviewLists();
  renderChart();
  renderSplit();
  renderInsights();
  renderGrowth();
  renderTable();
  updateAgentScope();
  if (state.route === 'budget') loadBudget();
}

function renderOverviewLists() {
  const totalSpent = model.total(state.rows);
  $('overview-categories').innerHTML = state.byCategory.length ? state.byCategory.slice(0, 3).map(([key, amount]) => {
    const group = model.categories[key];
    return '<button class="snapshot-category" type="button" data-category="' + key + '"><span>' + group.label +
      '</span><strong>' + escape(money(amount)) + '</strong><i style="--share:' + amount / totalSpent * 100 +
      '%;--category:' + group.color + '"></i></button>';
  }).join('') : '<p class="snapshot-empty">В выбранном месяце нет расходов.</p>';
  $('overview-recent').innerHTML = state.rows.length ? state.rows.slice(0, 3).map(row =>
    '<button class="snapshot-transaction" type="button" data-id="' + row.id + '"><span>' + escape(row.description) +
    '<small>' + longDates.format(date(row.date)) + '</small></span><strong>−' + escape(money(row.amount)) + '</strong></button>'
  ).join('') : '<p class="snapshot-empty">Операций пока нет.</p>';
}

function renderMetrics() {
  const count = state.rows.length;
  const sum = model.total(state.rows);
  const comparison = state.comparison;
  const change = comparison?.ratio ?? null;
  const biggest = state.byCategory[0];
  const changeNote = !comparison ? 'Нет базы для сравнения' : (
    '<span class="' + (comparison.delta > 0 ? 'positive' : 'negative') + '">' +
    escape(change === null ? signed(comparison.delta) : signed(change, percent)) + '</span> ' +
    (comparison.partial ? 'к тем же дням прошлого месяца' : 'к прошлому месяцу')
  );
  $('overview-trend').textContent = comparison ? signed(comparison.delta) + ' к предыдущему месяцу' : 'Графики расходов и доли категорий';
  const data = [
    ['wallet', 'Всего расходов', money(sum), changeNote],
    ['list', 'Операции', numbers.format(count), 'Расходные операции'],
    ['receipt', 'Средний чек', count ? money(Math.round(sum / count)) : '—', 'На одну покупку'],
    ['chart', 'Топ-категория', biggest ? percent(biggest[1] / sum) : '—', biggest ? model.categories[biggest[0]].label : 'Нет расходов'],
  ];
  $('metrics').innerHTML = data.map(([name, label, value, note]) =>
    '<article class="metric"><p class="metric-head"><span class="metric-icon">' + icon(name) + '</span>' + label +
    '</p><strong class="metric-value">' + escape(value) + '</strong><p class="metric-note">' + note + '</p></article>'
  ).join('');
}

function axisMax(peak) {
  if (!peak) return 10000;
  const magnitude = 10 ** Math.floor(Math.log10(peak / 4));
  const step = [1, 2, 2.5, 5, 10].find(value => value * magnitude * 4 >= peak);
  return step * magnitude * 4;
}

function dateAt(day) {
  return date(state.month + '-' + String(day).padStart(2, '0'));
}

function renderChart() {
  const size = state.bucket === 'week' ? 7 : 1;
  const values = Array(Math.ceil((state.lastDay - state.firstDay + 1) / size)).fill(0);
  for (const row of state.rows) values[Math.floor((Number(row.date.slice(-2)) - state.firstDay) / size)] += row.amount;
  const ceiling = axisMax(Math.max(...values));
  const levels = [1, .75, .5, .25, 0].map(ratio => compact.format(ceiling * ratio / 100));
  const bucketDay = index => index * size + state.firstDay;
  const ends = index => Math.min(bucketDay(index) + size - 1, state.lastDay);
  const isSelected = index => state.range?.start === bucketDay(index) && state.range?.end === ends(index);
  const label = index => size === 1 || ends(index) === bucketDay(index) ? shortDates.format(dateAt(bucketDay(index))) :
    bucketDay(index) + '–' + shortDates.format(dateAt(ends(index)));

  const partial = state.firstDay > 1 || state.lastDay < model.daysInMonth(state.month);
  $('trend-caption').textContent = monthName(state.month) + (partial ? ' · ' + state.firstDay + '–' + state.lastDay : '') + ' · ' + state.data.currency;
  const chart = $('trend-chart');
  chart.innerHTML = '<div class="axis" aria-hidden="true">' + levels.map(level => '<span>' + escape(level) + '</span>').join('') +
    '</div><div class="axis-lines" aria-hidden="true">' + '<span></span>'.repeat(levels.length) + '</div>' +
    '<div class="bars">' + values.map((amount, index) => {
      const title = escape(label(index) + ', ' + money(amount));
      return '<button class="bar" type="button" data-index="' + index + '" title="' + title + '" aria-label="' + title +
        '" aria-pressed="' + isSelected(index) + '"><span style="--bar:' + amount / ceiling * 100 + '%"></span></button>';
    }).join('') + '</div><div class="axis-dates" aria-hidden="true">' +
    values.map((_, index) => '<span>' + (size === 7 ? escape(bucketDay(index) + '–' + ends(index)) : ([0, 6, 13, 20, 27].includes(index) ? bucketDay(index) : '')) + '</span>').join('') + '</div>';
  $('trend-selection').textContent = state.range ? state.range.label : '';
  $('trend-view').hidden = !state.range;
  for (const button of chart.querySelectorAll('.bar')) {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.index);
      const start = bucketDay(index);
      state.range = isSelected(index) ? null : { start, end: ends(index), label: label(index) + ' · ' + money(values[index]) };
      state.page = 0;
      chart.querySelectorAll('.bar').forEach(bar => bar.setAttribute('aria-pressed', String(isSelected(Number(bar.dataset.index)))));
      $('trend-selection').textContent = state.range?.label || '';
      $('trend-view').hidden = !state.range;
      renderTable();
    });
  }
}

function renderSplit() {
  const sum = model.total(state.rows);
  let offset = 0;
  const stops = state.byCategory.map(([key, amount], index) => {
    const start = offset;
    offset = index === state.byCategory.length - 1 ? 100 : offset + amount / sum * 100;
    return model.categories[key].color + ' ' + start + '% ' + offset + '%';
  });
  if (stops.length) $('donut').style.setProperty('--ring', 'conic-gradient(' + stops.join(',') + ')');
  else $('donut').style.removeProperty('--ring');
  $('donut-count').textContent = state.byCategory.length;
  $('legend').innerHTML = state.byCategory.length ? state.byCategory.map(([key, amount]) => {
    const category = model.categories[key];
    return '<button type="button" data-category="' + key + '" style="--category:' + category.color +
      '" aria-pressed="' + ($('category-filter').value === key) + '" title="' + escape(category.label + ', ' + money(amount)) +
      '"><span class="dot"></span><span class="legend-name">' + category.label + '</span><strong>' + percent(amount / sum) + '</strong></button>';
  }).join('') : '<p class="legend-empty">Нет расходов за этот период</p>';
}

function monthTick(month) {
  return shortMonths.format(date(month + '-01')).replace(/\.$/, '');
}

function renderGrowth() {
  const months = state.data.months.slice(-8);
  if (!months.includes(state.month)) months.push(state.month);
  months.sort();
  const points = months.map(month => ({ month, sample: model.compareMonth(state.data, month) }));
  const max = Math.max(1, ...points.map(({ sample }) => Math.abs(sample?.delta || 0)));
  const [divisor, unit] = max >= 100_000_000 ? [100_000_000, 'млн '] : max >= 100_000 ? [100_000, 'тыс. '] : [100, ''];
  const labelNumber = new Intl.NumberFormat('ru-KZ', { maximumFractionDigits: divisor === 100 ? 2 : 1 });
  $('growth-unit').textContent = 'Изменение к предыдущему месяцу · ' + unit + state.data.currency;
  $('growth-graph').innerHTML = points.map(({ month, sample }) => {
    const title = monthName(month) + ' · ' + (sample ? signed(sample.delta) : 'нет базы для сравнения');
    const kind = !sample ? 'missing' : sample.delta > 0 ? 'up' : sample.delta < 0 ? 'down' : 'flat';
    const amount = sample ? signed(sample.delta / divisor, value => labelNumber.format(value)) : '—';
    return '<button class="growth-column ' + kind + '" type="button" data-month="' + month +
      '" aria-pressed="' + (state.month === month) + '" title="' + escape(title) + '" aria-label="' + escape(title) +
      '" style="--bar:' + (sample ? Math.abs(sample.delta) / max * 43 : 0) + '%">' +
      '<span class="growth-track"><i></i></span><span class="growth-amount">' + escape(amount) +
      '</span><span class="growth-month">' + escape(monthTick(month)) + '</span></button>';
  }).join('');

  const sample = state.comparison;
  const label = sample ? monthName(state.month) + ' · ' + signed(sample.delta) +
    (sample.ratio === null ? '' : ' (' + signed(sample.ratio, percent) + ')') +
    (sample.partial ? ' · за ' + sample.first + '–' + sample.last + ' числа обоих месяцев' : ' к предыдущему месяцу') :
    monthName(state.month) + ' · нет сравнимых данных за предыдущий месяц';
  $('growth-note').textContent = label;
  $('change-factors').innerHTML = model.categoryChanges(sample).filter(item => item.delta).slice(0, 3).map(item => {
    const name = model.categories[item.key].label;
    const month = item.amount ? state.month : model.priorMonth(state.month);
    return '<button type="button" data-compared data-month="' + month + '" data-category="' + item.key +
      '" title="' + escape(name + ' · ' + money(item.old) + ' → ' + money(item.amount)) + '"><span>' + escape(name) +
      '</span><strong class="' + (item.delta > 0 ? 'up' : 'down') + '">' + escape(signed(item.delta)) + '</strong></button>';
  }).join('');
}

function renderPrices() {
  const { priceType } = state;
  const index = agent.prices.findIndex(row => row.month === state.priceMonth);
  const entry = agent.prices[index];
  const before = agent.prices[index - 1];
  const number = new Intl.NumberFormat('ru-KZ', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const max = Math.max(...agent.prices.map(row => row[priceType]));
  $('price-value').textContent = number.format(entry[priceType]) + '%';
  $('price-delta').textContent = monthName(entry.month) + (before ?
    ' · ' + signed(entry[priceType] - before[priceType], value => number.format(value)) + ' п. п.' : '');
  $('price-source').href = entry.source;
  $('price-release').textContent = 'Опубликовано ' + longDates.format(date(entry.published));
  $('price-bars').style.setProperty('--months', agent.prices.length);
  $('overview-prices').textContent = number.format(agent.prices.at(-1).annual) + '% годовой инфляции в октябре';
  $('price-table').innerHTML = [...agent.prices].reverse().map(row => '<tr><td><button type="button" class="description-button" data-price-month="' +
    row.month + '">' + escape(monthName(row.month)) + '</button></td><td>' + number.format(row.monthly) + '%</td><td>' +
    number.format(row.annual) + '%</td><td><a class="source-link" target="_blank" rel="noopener noreferrer" href="' +
    escape(row.source) + '">' + longDates.format(date(row.published)) + ' · БНС</a></td></tr>').join('');
  $('price-bars').innerHTML = agent.prices.map(row => {
    const label = monthName(row.month) + ', ' + number.format(row[priceType]) + '%';
    return '<button class="price-column" type="button" data-month="' + row.month + '" aria-pressed="' +
      (entry === row) + '" title="' + escape(label) + '" aria-label="' + escape(label) + '">' +
      '<span class="price-track"><i style="--bar:' + row[priceType] / max * 100 + '%"></i></span><span>' + escape(monthTick(row.month)) + '</span></button>';
  }).join('');
}

function renderInsights() {
  const insights = [];
  const comparison = state.comparison;
  const dominant = model.categoryChanges(comparison).find(item => comparison.delta > 0 ? item.delta > 0 :
    comparison.delta < 0 ? item.delta < 0 : false);
  if (dominant) {
    const { key, amount, old, delta } = dominant;
    const label = model.categories[key].label;
    const verb = delta > 0 ? 'Больше всего выросли' : 'Больше всего снизились';
    insights.push({ title: label + ' · ' + signed(delta), body: verb + ': с ' + money(old) + ' до ' + money(amount) + '.',
      key, month: amount ? state.month : model.priorMonth(state.month), compared: true });
  } else if (state.byCategory.length) {
    const [key, amount] = state.byCategory[0];
    insights.push({ title: 'Главная категория · ' + model.categories[key].label, body: money(amount) + ' за период.', key });
  }

  const anomaly = model.anomaly(state.rows, comparison?.previous || []);
  if (anomaly) {
    insights.push({ title: 'Нетипичная сумма', body: anomaly.row.description + ' — ' + money(anomaly.row.amount) +
      ' при медиане категории ' + money(anomaly.baseline) + '.', id: anomaly.row.id });
  }
  const repeats = model.recurring(comparison?.current || [], comparison?.previous || []);
  state.repeats = repeats;
  if (repeats.length) {
    insights.push({ title: 'Платежи повторяются', body: numbers.format(repeats.length) + ' · ' +
      money(model.total(repeats)) + ' в этом месяце. Суммы и даты похожи на предыдущий месяц.', recurring: true });
  }

  if (!insights.length) insights.push({ title: 'Пока нет сигналов', body: 'За выбранный период в выписке нет расходных операций.' });
  $('insight-grid').style.setProperty('--insight-count', insights.length);
  $('insight-grid').innerHTML = insights.map(({ title, body, key, id, recurring, month, compared }) => {
    const content = '<strong>' + escape(title) + '</strong><p>' + escape(body) + '</p>';
    const attribute = key ? ' data-category="' + key + '"' + (month ? ' data-month="' + month + '"' : '') +
      (compared ? ' data-compared' : '') : id ? ' data-id="' + id + '"' : recurring ? ' data-recurring' : '';
    return attribute ? '<button type="button" class="insight-card"' + attribute + '>' + content + '</button>' :
      '<div class="insight-card">' + content + '</div>';
  }).join('');
}

function clearTransactionTools() {
  for (const id of transactionControls) $(id).value = id === 'filter-sort' ? 'recent' : '';
}

function transactionRows() {
  const query = model.normalize($('search').value.trim());
  const category = $('category-filter').value;
  const filters = [];
  if (query) filters.push(row => model.normalize(row.description).includes(query));
  if (category) filters.push(row => row.classification.key === category);
  if (state.repeatIds) filters.push(row => state.repeatIds.has(row.id));
  if (state.range) filters.push(row => {
    const day = Number(row.date.slice(-2));
    return day >= state.range.start && day <= state.range.end;
  });
  const from = $('filter-from').value;
  const to = $('filter-to').value;
  const minimum = $('filter-min').value === '' ? null : Math.round($('filter-min').valueAsNumber * 100);
  const maximum = $('filter-max').value === '' ? null : Math.round($('filter-max').valueAsNumber * 100);
  const status = $('filter-audit').value;
  const sorter = $('filter-sort').value;
  if (from) filters.push(row => row.date >= from);
  if (to) filters.push(row => row.date <= to);
  if (minimum !== null) filters.push(row => row.amount >= minimum);
  if (maximum !== null) filters.push(row => row.amount <= maximum);
  if (status) filters.push(row => state.auditByRow.has(row.id) && state.decisions.has(state.auditByRow.get(row.id)) === (status === 'reviewed'));
  const message = from && to && from > to ? 'Дата начала позже даты окончания.' :
    minimum !== null && maximum !== null && minimum > maximum ? 'Минимальная сумма выше максимальной.' : '';
  const rows = state.rows.filter(row => filters.every(filter => filter(row)));
  if (sorter === 'large') rows.sort((a, b) => b.amount - a.amount);
  else if (sorter === 'small') rows.sort((a, b) => a.amount - b.amount);
  else if (sorter === 'old') rows.reverse();
  return { rows, filtered: filters.length > 0 || sorter !== 'recent', message };
}

function renderTable() {
  const { rows, filtered, message } = transactionRows();
  $('transaction-filter-message').hidden = !message;
  $('transaction-filter-message').textContent = message;
  $('export-rows').disabled = !rows.length;
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  state.page = Math.min(state.page, pages - 1);
  $('transaction-count').textContent = numbers.format(rows.length) + ' из ' + numbers.format(state.rows.length) + ' за период' +
    (state.repeatIds ? ' · повторяющиеся платежи' : '') +
    (state.range ? ' · ' + state.range.label : '');
  $('transaction-rows').innerHTML = rows.length ? rows.slice(state.page * perPage, (state.page + 1) * perPage).map(row => {
    const group = model.categories[row.classification.key];
    const auditId = state.auditByRow.get(row.id);
    const flagged = auditId && !state.decisions.has(auditId);
    const flag = flagged ? '<button type="button" class="audit-row-tag" data-audit="' + auditId + '" aria-label="Проверить совпадение, строка ' +
      row.line + '">На проверке · строка ' + row.line + '</button>' : '';
    return '<tr' + (flagged ? ' class="audit-row-flagged"' : '') + '><td><button type="button" class="description-button" data-id="' + row.id + '">' +
      escape(row.description) + '</button>' + flag + '</td><td><span class="category-tag" style="--category:' + group.color + '"><i></i>' + group.label +
      '</span></td><td>' + longDates.format(date(row.date)) + '</td><td class="amount">−' + escape(money(row.amount)) + '</td></tr>';
  }).join('') : '<tr><td class="table-empty" colspan="4">Подходящих операций нет.</td></tr>';
  $('page-label').textContent = (state.page + 1) + ' / ' + pages;
  $('page-prev').disabled = state.page === 0;
  $('page-next').disabled = state.page >= pages - 1;
  $('clear-filters').hidden = !filtered;
}

function setTableFilter({ category = '', repeats = null, query = '', range = null, scroll = true } = {}) {
  $('search').value = query;
  clearTransactionTools();
  if (category && ![...$('category-filter').options].some(option => option.value === category)) {
    $('category-filter').add(new Option(model.categories[category].label, category));
  }
  $('category-filter').value = category;
  state.range = range;
  state.repeatIds = repeats;
  state.page = 0;
  renderChart();
  renderSplit();
  renderTable();
  if (scroll) navigate('transactions');
}

function selectTargetMonth(month) {
  if (month && state.month !== month && state.data.months.includes(month)) {
    $('period').value = month;
    selectMonth();
  }
}

function tableRange(comparison) {
  return comparison?.partial ? { start: comparison.first, end: comparison.last, label: comparison.first + '–' + comparison.last + ' числа' } : null;
}

function showDetail(id) {
  const row = state.rows.find(item => item.id === id);
  if (!row) return;
  const classification = row.classification;
  const why = {
    file: 'Категория взята из поля category в CSV.',
    model: 'Слова, повлиявшие на выбор модели: ' + classification.words.join(', ') + '.',
    unknown: 'Модель не нашла достаточно признаков для одной категории.',
  };
  const auditId = state.auditByRow.get(row.id);
  const review = auditId && !state.decisions.has(auditId) ?
    '<button type="button" class="button audit-button" data-audit="' + auditId + '">Проверить совпадение</button>' : '';
  $('detail-content').innerHTML = '<strong class="detail-summary">' + escape(row.description) + '</strong><dl><dt>Сумма и дата</dt><dd>' +
    escape(money(row.amount)) + ' · ' + longDates.format(date(row.date)) + '</dd><dt>Категория</dt><dd>' +
    model.categories[classification.key].label + '</dd><dt>Как определена</dt><dd>' + escape(why[classification.method]) +
    '</dd><dt>Строка CSV</dt><dd>' + row.line + '</dd></dl>' + review;
  $('detail-dialog').showModal();
}

function activate(section) {
  const legacy = section === 'growth' || section === 'insights' ? 'analytics' : section;
  const route = Object.hasOwn(routes, legacy) ? legacy : 'overview';
  if (state.route === route) return;
  state.route = route;
  document.querySelectorAll('[data-page]').forEach(page => { page.hidden = page.dataset.page !== route; });
  $('current-section').textContent = routes[route];
  document.title = routes[route] + ' · FinScope';
  $('period-host').hidden = !['overview', 'transactions', 'analytics', 'assistant'].includes(route);
  document.querySelectorAll('.nav a').forEach(link => {
    if (link.hash === '#' + route) {
      link.setAttribute('aria-current', 'page');
      const nav = link.parentElement;
      if (nav.scrollWidth > nav.clientWidth) nav.scrollLeft += link.getBoundingClientRect().left - nav.getBoundingClientRect().left;
    } else link.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
  if (route === 'archive') {
    $('archive-delete').hidden = true;
    renderArchive();
  } else if (route === 'budget') loadBudget();
  else if (route === 'assistant') {
    updateAgentScope();
    $('agent-log').scrollTop = $('agent-log').scrollHeight;
  }
}

function navigate(route) {
  if (location.hash !== '#' + route) location.hash = route;
  activate(route);
}

function updateAgentScope() {
  $('agent-scope').textContent = (state.base === demo || state.base === demoDuplicate ? 'Демовыписка' : 'Ваш CSV') +
    ' · ' + monthName(state.month) + ' · локальный анализ';
}

function budgetPeriod() {
  const month = $('budget-month').value;
  return /^(19\d{2}|20\d{2})-(0[1-9]|1[0-2])$/.test(month) ? month : state.month;
}

function updateBudgetInput() {
  const amount = state.limits.get($('budget-category').value);
  $('budget-amount').value = amount ? (amount / 100).toFixed(2) : '';
}

function renderBudget() {
  const month = budgetPeriod();
  const observed = state.data.months.includes(month);
  const snapshot = observed ? model.expenseMonth(state.data, month) : null;
  const totals = new Map(snapshot ? model.groups(snapshot.rows) : []);
  const limits = [...state.limits];
  const planned = limits.reduce((sum, [, cap]) => sum + cap, 0);
  const actual = limits.reduce((sum, [key]) => sum + (totals.get(key) || 0), 0);
  $('budget-result').textContent = !limits.length ? 'Добавьте первый лимит, чтобы начать планирование.' :
    'Лимиты ' + money(planned) + (observed ? ' · потрачено по ним ' + money(actual) : ' · месяц отсутствует в выписке');
  const pending = observed && state.data.duplicateGroups.some(group => !state.decisions.has(group.id) &&
    group.members.some(row => row.direction === 'out' && row.date.startsWith(month)));
  const partial = snapshot && (snapshot.first > 1 || snapshot.last < model.daysInMonth(month));
  $('budget-alert').hidden = !pending && !partial;
  $('budget-alert').textContent = [partial ? 'Факт по доступным дням выписки: ' + snapshot.first + '–' + snapshot.last + '.' : '',
    pending ? 'Есть непроверенные совпадения.' : ''].filter(Boolean).join(' ');
  $('budget-items').innerHTML = limits.map(([key, cap]) => {
    const amount = totals.get(key) || 0;
    const left = cap - amount;
    const category = model.categories[key];
    return '<article class="budget-entry"><div class="panel-head"><div><h3>' + category.label + '</h3><p>' +
      (observed ? escape(money(amount)) + ' из ' : '') + escape(money(cap)) + '</p></div>' +
      '<button type="button" class="button" data-budget-edit="' + key + '">Изменить</button></div>' +
      '<div class="budget-track' + (left < 0 ? ' over' : '') + '" aria-hidden="true"><i style="width:' +
      Math.min(100, amount / cap * 100) + '%"></i></div><div class="budget-entry-footer"><span>' +
      (observed ? (left < 0 ? 'Сверх лимита: ' : 'Остаток: ') + escape(money(Math.abs(left))) : 'Факт появится после загрузки выписки') +
      '</span><button class="archive-remove" type="button" data-budget-remove="' + key + '">Снять лимит</button></div></article>';
  }).join('');
}

async function loadBudget() {
  if (!$('budget-month').value) $('budget-month').value = state.month;
  const currency = state.data.currency;
  const month = budgetPeriod();
  const request = ++state.budgetRead;
  $('budget-context').textContent = monthName(month) + ' · ' + currency;
  $('budget-save').disabled = true;
  $('budget-items').replaceChildren();
  $('budget-result').textContent = 'Загрузка лимитов…';
  $('budget-form-status').textContent = '';
  try {
    const limits = await storage.readBudget(currency, month);
    if (request !== state.budgetRead) return;
    state.limits = limits;
    updateBudgetInput();
    renderBudget();
  } catch {
    if (request === state.budgetRead) $('budget-result').textContent = 'Локальная база недоступна.';
  } finally {
    if (request === state.budgetRead) $('budget-save').disabled = false;
  }
}

async function writeBudget(category, amount) {
  const currency = state.data.currency;
  const month = budgetPeriod();
  const request = ++state.budgetRead;
  $('budget-save').disabled = true;
  try {
    const limits = await storage.saveBudget(currency, month, category, amount);
    if (request !== state.budgetRead) return;
    state.limits = limits;
    updateBudgetInput();
    renderBudget();
    $('budget-form-status').textContent = amount === null ? 'Лимит снят.' : 'Лимит сохранён.';
  } catch {
    if (request === state.budgetRead) $('budget-form-status').textContent = 'Не удалось записать лимит в базу.';
  } finally {
    if (request === state.budgetRead) $('budget-save').disabled = false;
  }
}

function notify(message) {
  clearTimeout(toastTimer);
  const toast = $('toast');
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3600);
}

function appendMessage(text, sender, action) {
  const log = $('agent-log');
  const message = document.createElement('div');
  message.className = 'agent-message ' + sender;
  const body = document.createElement('p');
  body.textContent = text;
  message.append(body);
  if (action?.type === 'source') {
    const link = document.createElement('a');
    link.className = 'agent-action';
    link.href = action.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = action.label;
    message.append(link);
  } else if (action) {
    const button = document.createElement('button');
    button.className = 'agent-action';
    button.type = 'button';
    button.textContent = { table: 'Открыть операции', detail: 'Посмотреть операцию',
      import: 'Загрузить CSV', prices: 'Открыть график цен', audit: 'Проверить строки' }[action.type];
    button.addEventListener('click', () => followAnswer(action));
    message.append(button);
  }
  log.append(message);
  if (log.childElementCount > 31) log.firstElementChild.remove();
  message.scrollIntoView({ block: 'nearest' });
}

function resetAgent() {
  agentMemory = null;
  $('agent-log').replaceChildren();
  $('agent-form').reset();
  appendMessage('Сравню месяцы, объясню изменения и покажу строки, из-за которых возникло предупреждение.', 'assistant');
  $('agent-prompts').hidden = false;
}

function followAnswer(action) {
  if (action.type === 'import') {
    $('import-open').click();
    return;
  }
  if (action.type === 'prices') {
    navigate('prices');
    return;
  }
  if (action.type === 'audit') {
    navigate('quality');
    openAudit(action.groupId);
    return;
  }
  selectTargetMonth(action.month);
  if (action.type === 'detail') showDetail(action.id);
  else setTableFilter({ category: action.category, repeats: action.ids ? new Set(action.ids) : null,
    query: action.query, range: tableRange(action.range) });
}

function askAgent(text) {
  const question = text.trim();
  if (!question) return;
  appendMessage(question, 'user');
  const reply = agent.respond(question, {
    data: state.data, decisions: state.decisions, selected: state.month, currency: money, monthName, last: agentMemory,
  });
  if (reply.memory) agentMemory = reply.memory;
  appendMessage(reply.text, 'assistant', reply.action);
  $('agent-question').value = '';
}

window.addEventListener('hashchange', () => activate(location.hash.slice(1) || 'overview'));
$('period').addEventListener('change', selectMonth);
$('search').addEventListener('input', () => { state.page = 0; renderTable(); });
$('category-filter').addEventListener('change', () => { state.page = 0; renderSplit(); renderTable(); });
$('clear-filters').addEventListener('click', () => setTableFilter({ scroll: false }));
transactionControls.forEach(id => $(id).addEventListener('input', () => { state.page = 0; renderTable(); }));
$('export-rows').addEventListener('click', () => {
  const { rows } = transactionRows();
  if (!rows.length) return;
  const url = URL.createObjectURL(new Blob([model.exportExpenses(rows)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'finscope-' + state.month + '.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('page-prev').addEventListener('click', () => { state.page--; renderTable(); });
$('page-next').addEventListener('click', () => { state.page++; renderTable(); });
document.querySelectorAll('[data-bucket]').forEach(button => button.addEventListener('click', () => {
  state.bucket = button.dataset.bucket;
  state.range = null;
  state.page = 0;
  document.querySelectorAll('[data-bucket]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  renderChart();
  renderTable();
}));

$('growth-graph').addEventListener('click', event => {
  const month = event.target.closest('button')?.dataset.month;
  if (!month) return;
  selectTargetMonth(month);
  $('growth-graph').querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
});
$('price-bars').addEventListener('click', event => {
  const month = event.target.closest('button')?.dataset.month;
  if (!month) return;
  state.priceMonth = month;
  renderPrices();
  $('price-bars').querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
});
$('price-table').addEventListener('click', event => {
  const month = event.target.closest('button')?.dataset.priceMonth;
  if (!month) return;
  state.priceMonth = month;
  renderPrices();
  $('price-context').scrollIntoView({ block: 'start' });
});
document.querySelectorAll('[data-price]').forEach(button => button.addEventListener('click', () => {
  state.priceType = button.dataset.price;
  document.querySelectorAll('[data-price]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  renderPrices();
}));

$('audit-open').addEventListener('click', () => openAudit());
$('audit-example').addEventListener('click', () => {
  populate(demoDuplicate, 'Демо с дублем');
  $('audit-open').focus();
});
$('quality-demo').addEventListener('click', () => {
  populate(demoDuplicate, 'Демо с дублем');
  $('quality-list').querySelector('button')?.focus();
});
for (const id of ['quality-status', 'quality-kind']) $(id).addEventListener('change', () => {
  state.qualityPage = 0;
  renderQuality();
});
for (const [id, step] of [['quality-prev', -1], ['quality-next', 1]]) $(id).addEventListener('click', () => {
  state.qualityPage += step;
  renderQuality();
});
$('quality-list').addEventListener('click', event => {
  const id = Number(event.target.closest('button')?.dataset.group);
  if (id) openAudit(id);
});
for (const id of ['budget-month', 'budget-category']) $(id).addEventListener('change', () => {
  if (id === 'budget-month') loadBudget();
  else updateBudgetInput();
});
$('budget-form').addEventListener('submit', event => {
  event.preventDefault();
  const amount = Math.round($('budget-amount').valueAsNumber * 100);
  if (Number.isSafeInteger(amount) && amount > 0) writeBudget($('budget-category').value, amount);
});
$('budget-items').addEventListener('click', event => {
  const button = event.target.closest('button');
  if (button?.dataset.budgetEdit) {
    $('budget-category').value = button.dataset.budgetEdit;
    updateBudgetInput();
    $('budget-amount').focus();
  } else if (button?.dataset.budgetRemove) writeBudget(button.dataset.budgetRemove, null);
});
for (const [id, delta] of [['audit-prev', -1], ['audit-next', 1]]) {
  $(id).addEventListener('click', () => {
    state.auditIndex += delta;
    state.auditPage = 0;
    renderAuditDialog();
  });
}
for (const [id, delta] of [['audit-row-prev', -1], ['audit-row-next', 1]]) {
  $(id).addEventListener('click', () => {
    state.auditPage += delta;
    renderAuditDialog();
  });
}
for (const [id, single] of [['audit-all', false], ['audit-first', true]]) {
  $(id).addEventListener('click', () => {
    const group = auditGroup();
    const rows = single ? group.members.slice(0, 1) : group.members;
    state.auditDrafts.set(group.id, new Set(rows.map(row => row.id)));
    renderAuditDialog();
  });
}
$('audit-rows').addEventListener('change', event => {
  const id = Number(event.target.dataset.row);
  if (!id) return;
  const selected = draftFor(auditGroup());
  if (event.target.checked) selected.add(id);
  else selected.delete(id);
  renderAuditImpact();
});
$('audit-save').addEventListener('click', async () => {
  const group = auditGroup();
  const selected = new Set(draftFor(group));
  if (!selected.size || state.savingReview) return;
  const revision = sourceRevision;
  let decisions = new Map(state.decisions);
  decisions.set(group.id, selected);
  if (state.record) {
    state.savingReview = true;
    renderAuditImpact();
    try {
      const result = await storage.saveReview(state.record.id, group.id, selected);
      if (revision !== sourceRevision) return;
      state.record = result;
      decisions = new Map(result.decisions);
    } catch {
      if (revision !== sourceRevision) return;
      state.savingReview = false;
      renderAuditImpact();
      notify('Решение не записалось в базу. Повторите сохранение.');
      return;
    }
    state.savingReview = false;
  }
  state.data = model.reviewedData(state.base, decisions);
  state.decisions = decisions;
  syncPeriods(state.month);
  renderAuditBanner();
  renderStatementStatus();
  selectMonth();
  resetAgent();
  if ($('audit-dialog').open) renderAuditDialog();
  notify('Решение сохранено. Расходы пересчитаны.');
});
$('detail-content').addEventListener('click', event => {
  const id = Number(event.target.closest('button')?.dataset.audit);
  if (!id) return;
  $('detail-dialog').close();
  openAudit(id);
});

for (const id of ['legend', 'insight-grid', 'transaction-rows', 'change-factors', 'overview-categories', 'overview-recent']) {
  $(id).addEventListener('click', event => {
    const button = event.target.closest('button');
    if (button?.dataset.id) showDetail(Number(button.dataset.id));
    if (button?.dataset.audit) openAudit(Number(button.dataset.audit));
    if (button?.dataset.category) {
      const category = button.dataset.category;
      const range = button.hasAttribute('data-compared') ? tableRange(state.comparison) : null;
      selectTargetMonth(button.dataset.month);
      setTableFilter({ category: id === 'legend' && $('category-filter').value === category ? '' : category, range });
    }
    if (button?.hasAttribute('data-recurring')) setTableFilter({ repeats: new Set(state.repeats.map(row => row.id)) });
  });
}

$('agent-clear').addEventListener('click', resetAgent);
$('agent-form').addEventListener('submit', event => {
  event.preventDefault();
  askAgent($('agent-question').value);
});
$('agent-prompts').addEventListener('click', event => {
  const question = event.target.closest('button')?.dataset.question;
  if (question) {
    $('agent-question').focus();
    askAgent(question);
  }
});

$('about-open').addEventListener('click', () => $('about-dialog').showModal());
$('archive-search').addEventListener('input', renderArchiveList);
$('archive-demo').addEventListener('click', () => {
  openDemo();
  navigate('overview');
});
$('archive-import').addEventListener('click', () => {
  $('import-open').click();
});
$('archive-list').addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button) return;
  const id = button.dataset.record || button.dataset.remove;
  if (!id) return;
  button.disabled = true;
  try {
    const entry = await storage.load(id);
    if (state.route !== 'archive') return;
    if (!entry) throw new Error('Эта выписка больше не доступна.');
    if (button.dataset.remove) {
      $('archive-delete-apply').dataset.record = id;
      $('archive-delete-label').textContent = 'Удалить «' + entry.record.filename + '» и решения по её строкам из локальной базы?';
      $('archive-delete').hidden = false;
      $('archive-delete-cancel').focus();
      return;
    }
    await storage.setActive(id);
    populate(entry.data, entry.record.filename, entry.record);
    navigate('overview');
  } catch {
    $('archive-status').textContent = 'Не удалось открыть выписку из архива.';
  } finally {
    button.disabled = false;
  }
});
$('archive-delete-cancel').addEventListener('click', () => { $('archive-delete').hidden = true; });
$('archive-delete-apply').addEventListener('click', async event => {
  const button = event.currentTarget;
  const id = button.dataset.record;
  button.disabled = true;
  try {
    await storage.remove(id);
    if (state.record?.id === id) populate(demo);
    $('archive-delete').hidden = true;
    await renderArchive();
  } catch {
    $('archive-status').textContent = 'Не удалось удалить выписку из архива.';
  } finally {
    button.disabled = false;
  }
});
$('import-open').addEventListener('click', () => {
  importRequest++;
  $('import-submit').disabled = false;
  $('import-form').reset();
  $('filename').textContent = 'Выбрать CSV';
  $('import-error').hidden = true;
  $('import-dialog').showModal();
});
$('file-input').addEventListener('change', event => {
  importRequest++;
  $('import-submit').disabled = false;
  $('filename').textContent = event.target.files[0]?.name || 'Выбрать CSV';
  $('import-error').hidden = true;
});
$('import-form').addEventListener('submit', async event => {
  event.preventDefault();
  const file = $('file-input').files[0];
  if (!file) return;
  const request = ++importRequest;
  const options = { currency: $('import-currency').value, sign: $('import-sign').value };
  const button = $('import-submit');
  button.disabled = true;
  try {
    if (file.size > 4_000_000) throw new Error('Максимальный размер файла — 4 МБ.');
    const bytes = await file.arrayBuffer();
    if (request !== importRequest || !$('import-dialog').open) return;
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      text = new TextDecoder('windows-1251').decode(bytes);
    }
    const data = model.parseCsv(text, options);
    let record = null;
    try {
      record = await storage.save(file.name, data);
      storage.list().then(entries => renderArchiveCount(entries.length)).catch(() => {});
    } catch {
      // Keep the upload usable in memory when the browser blocks persistence.
    }
    if (request !== importRequest || !$('import-dialog').open) return;
    populate(data, file.name, record);
    $('import-dialog').close();
    notify(record ? 'Выписка сохранена. Расходных операций: ' + numbers.format(data.expenses.length) :
      'Выписка открыта. Браузер не смог сохранить её в архив.');
    if (data.duplicateGroups.length) {
      navigate('quality');
      $('quality-list').querySelector('button')?.focus({ preventScroll: true });
    } else navigate('overview');
  } catch (error) {
    $('import-error-text').textContent = error.message;
    $('import-error-details').replaceChildren(...(error.details || []).map(detail => {
      const item = document.createElement('li');
      item.textContent = detail;
      return item;
    }));
    $('import-error').hidden = false;
  } finally {
    if (request === importRequest) button.disabled = false;
  }
});
$('source-label').addEventListener('click', openDemo);

populate(demo);
renderPrices();
$('budget-category').replaceChildren(...Object.entries(model.categories).map(([key, category]) => new Option(category.label, key)));
activate(location.hash.slice(1) || 'overview');
restoreArchive();
