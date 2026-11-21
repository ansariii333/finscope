const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../dist/model.js');
const agent = require('../dist/agent.js');

const header = 'date;description;amount;direction;transaction_id;account';
const purchase = '2026-10-12;Кафе Север;2500;out';
const csv = (...rows) => model.parseCsv([header, ...rows].join('\r\n'));
const twice = () => csv(purchase + ';;A', purchase + ';;A');
const amount = data => model.total(data.expenses);
const review = (data, ids) => model.reviewedData(data, new Map([[data.duplicateGroups[0].id, new Set(ids)]]));

test('same date, description, amount and direction without ID is a candidate', () => {
  const data = twice();
  assert.deepEqual(data.duplicateGroups.map(group => group.kind), ['candidate']);
  assert.deepEqual(data.duplicateGroups[0].members.map(row => row.line), [2, 3]);
});

test('identical records with the same bank ID get a stronger flag', () => {
  assert.equal(csv(purchase + ';00017;A', purchase + ';00017;A').duplicateGroups[0].kind, 'reference');
});

test('equal IDs with different requisites are conflicts', () => {
  const data = csv(purchase + ';X;A', '2026-10-13;Кафе Север;2600;out;X;A');
  assert.equal(data.duplicateGroups[0].kind, 'conflict');
  assert.deepEqual(data.duplicateGroups[0].members.map(row => row.amount), [250000, 260000]);
});

test('different filled bank IDs keep equal purchases independent', () => {
  assert.equal(csv(purchase + ';X;A', purchase + ';Y;A').duplicateGroups.length, 0);
});

test('the same ID on separate accounts does not collide', () => {
  assert.equal(csv(purchase + ';X;A', purchase + ';X;B').duplicateGroups.length, 0);
});

test('identical subscriptions on different dates are not duplicates', () => {
  assert.equal(csv(purchase + ';;A', purchase.replace('10-12', '09-12') + ';;A').duplicateGroups.length, 0);
});

test('different explicit purchase times without matching reference are independent', () => {
  const data = csv(purchase.replace('10-12;', '10-12T14:30:00;') + ';;A',
    purchase.replace('10-12;', '10-12T14:31:00;') + ';;A');
  assert.equal(data.duplicateGroups.length, 0);
});

test('a refund is not marked as a duplicate of its matching expense', () => {
  const data = csv(purchase + ';;A', purchase.replace(';out', ';in') + ';;A');
  assert.equal(data.duplicateGroups.length, 0);
  assert.equal(amount(data), 250000);
});

test('two matching credits are flagged without changing expense totals', () => {
  const data = csv(purchase.replace(';out', ';in') + ';X;A', purchase.replace(';out', ';in') + ';X;A');
  assert.equal(data.duplicateGroups.length, 1);
  assert.equal(amount(review(data, [1])), 0);
});

test('CSV canonicalizes presentation-only amount, date and description variations', () => {
  const data = csv(purchase + ';;A', '12.10.2026;КАФЕ   СЕВЕР;2 500,00;out;;A');
  assert.equal(data.duplicateGroups[0].kind, 'candidate');
});

test('a group with three copies is counted once and keeps three line references', () => {
  const data = csv(...Array(3).fill(purchase + ';X;A'));
  assert.equal(data.duplicateGroups.length, 1);
  assert.equal(data.duplicateGroups[0].members.length, 3);
});

test('unreviewed candidates remain in the spending total', () => {
  assert.equal(amount(twice()), 500000);
});

test('saving a confirmed exclusion updates totals without mutating the original', () => {
  const data = twice();
  const filtered = review(data, [1]);
  assert.equal(amount(filtered), 250000);
  assert.deepEqual([...filtered.excluded], [2]);
  assert.equal(amount(data), 500000);
});

test('keeping all records resolves a candidate and retains the original sum', () => {
  const data = review(twice(), [1, 2]);
  assert.equal(data.reviewed, 1);
  assert.equal(data.excluded.size, 0);
  assert.equal(amount(data), 500000);
});

test('review can restore every previously excluded row', () => {
  const corrected = review(twice(), [1]);
  assert.equal(amount(review(corrected, [1, 2])), 500000);
});

test('review rejects empty selection and row IDs from outside the group', () => {
  const data = twice();
  assert.throws(() => review(data, []), /хотя бы одну/);
  assert.throws(() => review(data, [1, 100]), /хотя бы одну/);
});

test('physical row references survive blank lines and quoted multiline CSV fields', () => {
  const data = model.parseCsv(['', header, '', purchase.replace('Кафе Север', '"Кафе\r\nСевер"') + ';;A',
    purchase + ';;A'].join('\r\n'));
  assert.deepEqual(data.duplicateGroups[0].members.map(row => row.line), [4, 6]);
});

test('invalid rows are reported together with the bad fields and physical line numbers', () => {
  assert.throws(() => csv('2026-02-30;Кафе;50;out;;A', '', '2026-10-13;Такси;не число;out;;A'), error => {
    assert.match(error.message, /строках: 2/);
    assert.deepEqual(error.details, ['Строка 2 — неверная дата.', 'Строка 4 — неверная сумма.']);
    return true;
  });
});

test('permuting input lines preserves group kinds and business identities', () => {
  const rows = [purchase + ';X;A', purchase + ';X;A', purchase + ';Y;B',
    '2026-10-14;Такси;1200;out;Y;B', '2026-10-15;Кафе;1600;out;;A'];
  const signature = data => data.duplicateGroups.map(group =>
    [group.kind, group.members.map(row => row.reference + ':' + row.amount).sort()]);
  assert.deepEqual(signature(csv(...rows)), signature(csv(...rows.reverse())));
});

test('agent reports review evidence and avoids flagging the clean demo', () => {
  const ask = data => agent.respond('Есть ли дубли в выписке?', {
    data, selected: '2026-10', currency: String, monthName: String,
  });
  assert.equal(ask(twice()).action.type, 'audit');
  assert.match(ask(review(twice(), [1])).text, /Исключено строк: 1/);
  assert.match(ask(model.parseCsv(model.demo)).text, /не найдено/);
});

test('export preserves the selected operation amount, category, and bank reference on reimport', () => {
  const input = csv(purchase + ';0017;A', '2026-10-13;Такси;1550;out;B012;A');
  const exported = model.exportExpenses(input.expenses.slice(0, 1));
  const [row] = model.parseCsv(exported).expenses;
  assert.equal(row.amount, 250000);
  assert.equal(row.classification.key, 'dining');
  assert.equal(row.reference, '0017');
  assert.equal(row.account, 'A');
});

test('export neutralizes formula markers in spreadsheet cells', () => {
  const data = csv('2026-10-12;"=1+1";2500;out;@ref;A');
  const exported = model.exportExpenses(data.expenses);
  assert.ok(exported.includes('"\'=1+1"'));
  assert.ok(exported.includes('"\'@ref"'));
});
