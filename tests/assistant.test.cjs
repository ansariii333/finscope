const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../dist/model.js');
const agent = require('../dist/agent.js');

const demo = model.parseCsv(model.demo);
const duplicate = model.parseCsv('date;description;amount\n2026-09-01;Кафе;500\n2026-10-01;Кафе;2700\n2026-10-01;Кафе;2700');
const ask = (question, options = {}) => agent.respond(question, {
  data: demo, selected: '2026-10', currency: cents => (cents / 100) + ' ₸', monthName: String, ...options,
});

test('assistant compares two explicitly requested months and uses their exact totals', () => {
  const reply = ask('Сравни расходы за июль и октябрь');
  assert.equal(reply.memory.comparisonMonth, '2026-07');
  assert.equal(reply.memory.month, '2026-10');
  assert.match(reply.text, /197760 ₸ → 293240 ₸ \(\+95480 ₸\)/);
});

test('category follow-up preserves both periods in an explicit comparison', () => {
  const before = ask('Сравни 2026-07 и 2026-10');
  const followUp = ask('А по транспорту?', { last: before.memory });
  assert.equal(followUp.memory.comparisonMonth, '2026-07');
  assert.equal(followUp.action.category, 'transport');
  assert.match(followUp.text, /18830 ₸ → 40740 ₸/);
});

test('comparison truncates both periods to the common days when coverage is incomplete', () => {
  const source = model.parseCsv('date;description;amount\n2026-08-08;Кафе;300\n2026-08-11;Кофе;100\n2026-10-04;Кафе;800\n2026-10-10;Такси;200');
  const result = model.comparePeriods(source, '2026-10', '2026-08');
  assert.deepEqual([result.first, result.last, result.base, result.sum, result.delta], [8, 10, 30000, 20000, -10000]);
});

test('assistant marks relevant expense totals as preliminary while a candidate is pending', () => {
  assert.match(ask('Сколько я потратил?', { data: duplicate, decisions: new Map() }).text, /Предварительно.*\(1\)/);
  assert.doesNotMatch(ask('Сколько я потратил в сентябре?', { data: duplicate, decisions: new Map() }).text, /Предварительно/);
});

test('assistant reports the original and corrected totals from a saved review', () => {
  const group = duplicate.duplicateGroups[0];
  const decisions = new Map([[group.id, new Set([group.members[0].id])]]);
  const reply = ask('Что изменилось после проверки дублей?', { data: model.reviewedData(duplicate, decisions), decisions });
  assert.match(reply.text, /5900 ₸ до проверки, 3200 ₸ сейчас/);
  assert.match(reply.text, /строки 4/);
});

test('assistant links a question about a CSV line to the matching review', () => {
  const reply = ask('Почему отмечена строка 4?', { data: duplicate });
  assert.equal(reply.action.groupId, duplicate.duplicateGroups[0].id);
  assert.match(reply.text, /Строка 3/);
  assert.match(reply.text, /Строка 4/);
});

test('official CPI entries keep their exact period, publication date and source', () => {
  assert.equal(agent.prices.length, 10);
  const reply = ask('Какая инфляция в январе 2026?');
  assert.match(reply.text, /12,2% за год/);
  assert.match(reply.action.label, /02\.02\.2026/);
  assert.match(reply.action.url, /^https:\/\/stat\.gov\.kz\/.*\/281083\/$/);
});
