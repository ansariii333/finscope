(function () {
  'use strict';

  const model = typeof module === 'object' && module.exports ? require('./model.js') : window.FinScopeModel;
  const sourceBase = 'https://stat.gov.kz/ru/industries/economy/prices/publications/';
  const prices = [
    ['2026-01', 12.2, 1.0, '2026-02-02', '281083'],
    ['2026-02', 11.7, 1.1, '2026-03-02', '281448'],
    ['2026-03', 11.0, .6, '2026-04-01', '480322'],
    ['2026-04', 10.6, .8, '2026-05-04', '346502'],
    ['2026-05', 10.4, .7, '2026-06-01', '346888'],
    ['2026-06', 10.3, .8, '2026-07-01', '347710'],
    ['2026-07', 10.2, .6, '2026-08-03', '509832'],
    ['2026-08', 9.8, .6, '2026-09-01', '347964'],
    ['2026-09', 9.3, .6, '2026-10-01', '353604'],
    ['2026-10', 9.2, .5, '2026-11-02', '355080'],
  ].map(([month, annual, monthly, published, id]) => ({ month, annual, monthly, published, source: sourceBase + id + '/' }));
  const monthStems = [
    /^январ/, /^феврал/, /^март/, /^апрел/, /^ма[йея]$/, /^июн/, /^июл/, /^август/, /^сентябр/, /^октябр/, /^ноябр/, /^декабр/,
  ];
  const categoryWords = {
    grocery: /^(продукт|супермаркет|бакалея)/,
    dining: /^(кафе|ресторан|доставк|кофей)/,
    shopping: /^(покупк|одежд|техник|маркетплейс)/,
    transport: /^(транспорт|проезд|поездк)/,
    bills: /^(подписк|коммунал|счета$|счетов)/,
    health: /^(здоровь|аптек|медицин)/,
    other: /^(другое|прочие)/,
  };
  const ignored = new Set(['и', 'а', 'за', 'на', 'по', 'в', 'у', 'к', 'из', 'о', 'мне', 'мои', 'мой', 'что', 'где', 'есть',
    'ли', 'бы', 'пожалуйста', 'какие', 'какая', 'какой', 'какую', 'это', 'месяце', 'месяц', 'этот', 'года']);
  const questionWords = text => (model.normalize(text).match(/[\p{L}\p{N}]+/gu) || []);
  const meaningful = word => word.length >= 2 && !ignored.has(word) && !monthStems.some(pattern => pattern.test(word));
  const clean = text => questionWords(text).filter(meaningful).join(' ');
  const examples = {
    change: [
      'почему выросли расходы', 'из за чего траты увеличились', 'что изменилось по сравнению с прошлым месяцем',
      'почему расходы упали', 'стало больше или меньше', 'как изменилась динамика затрат', 'какой рост',
      'на сколько снизились расходы', 'сравни с предыдущим месяцем', 'в чем причина роста', 'что повлияло на снижение',
      'что больше всего повлияло на рост', 'объясни рост затрат', 'какие статьи выросли сильнее всего',
      'сравни июль и октябрь', 'сравни расходы двух периодов', 'сопоставь траты августа и октября',
    ],
    sum: [
      'сколько я потратил', 'сколько ушло на продукты', 'сумма всех трат', 'сумма по категории',
      'итого доставка', 'покажи общие расходы', 'сколько заплатил за транспорт', 'сколько было операций',
      'сколько мы потратили на кафе', 'сколько потратила на продукты',
    ],
    largest: [
      'какая самая большая трата', 'покажи крупнейшие операции', 'на что больше всего ушло денег',
      'куда ушли деньги', 'топ расходов', 'назови самые дорогие покупки', 'на что потратил больше всего',
      'самая крупная покупка', 'топ категорий', 'самый большой платеж', 'покажи основные траты',
    ],
    recurring: [
      'какие платежи повторяются', 'найди регулярные списания', 'есть ли повторяющиеся подписки',
      'подписки и регулярные расходы', 'периодические платежи', 'что списывается каждый месяц',
      'постоянные списания', 'какие у меня подписки', 'что по подпискам',
    ],
    audit: [
      'есть ли дубли в выписке', 'проверь дубликаты', 'покажи дублированные операции',
      'двойное списание', 'ошибки в выписке', 'подозрительные совпадения строк',
      'одна операция прошла два раза', 'одинаковые номера операций', 'где возможный дубль',
      'что изменилось после проверки дублей', 'объясни почему строки совпали', 'сколько исключили из расходов',
    ],
    anomaly: [
      'какая операция нетипичная', 'есть ли аномалии', 'покажи необычные траты', 'найди выбросы',
      'какие расходы выделяются', 'нетипичная сумма покупки', 'странные операции', 'какой расход аномальный',
    ],
    prices: [
      'какая инфляция в казахстане', 'как изменились цены', 'на сколько выросли цены',
      'что с инфляцией', 'рост цен в казахстане', 'официальные данные статистики ипц',
      'покажи индекс потребительских цен', 'что показывает индекс цен',
    ],
    import: [
      'как загрузить выписку', 'как импортировать файл', 'где загрузить csv', 'какой формат выписки',
      'принимаете ли банковский файл', 'хочу добавить свою выписку', 'не получается загрузить мои операции',
      'поддерживается ли кириллица в csv',
    ],
  };
  const classify = model.train(Object.fromEntries(Object.entries(examples).map(([intent, phrases]) => [intent, phrases.map(clean)])));

  function findMonth(text, words, months, base) {
    const exact = text.match(/(?:^|\D)(20\d{2}|19\d{2})-(0[1-9]|1[0-2])(?:\D|$)/);
    if (exact) return exact[1] + '-' + exact[2];
    const pos = monthStems.findIndex(pattern => words.some(word => pattern.test(word)));
    if (pos >= 0) {
      const suffix = '-' + String(pos + 1).padStart(2, '0');
      const year = text.match(/\b(19\d{2}|20\d{2})\b/)?.[0];
      const local = base.slice(0, 4) + suffix;
      return year ? year + suffix : months.includes(local) ? local : [...months].reverse().find(month => month.endsWith(suffix)) || local;
    }
    return /(?:в|за) (?:прошл|предыдущ)[а-я]+ месяц/.test(text) && !/сравн|сравни/.test(text) ? model.priorMonth(base) : '';
  }

  function mentionedMonths(text, months, base) {
    const words = text.match(/(?:19|20)\d{2}-(?:0[1-9]|1[0-2])|[\p{L}\p{N}]+/gu) || [];
    const found = words.flatMap((word, index) => {
      if (/^\d{4}-\d{2}$/.test(word)) return [word];
      if (!monthStems.some(pattern => pattern.test(word))) return [];
      const year = /^\d{4}$/.test(words[index + 1] || '') ? words[index + 1] : '';
      return [findMonth(word + ' ' + year, [word], months, base)];
    });
    return [...new Set(found)];
  }

  function groupEvidence(group, format) {
    const reason = {
      conflict: 'У строк один банковский номер, реквизиты различаются.',
      reference: 'Совпадают банковский номер и реквизиты.',
      candidate: 'Совпадают дата, доступное время, описание, направление и сумма.',
    }[group.kind];
    const entries = group.members.slice(0, 4).map(row => 'Строка ' + row.line + ' · ' + row.description + ' · ' +
      row.date + ' · ' + format(row.amount));
    if (group.members.length > entries.length) entries.push('Других строк в группе: ' + (group.members.length - entries.length) + '.');
    return reason + '\n' + entries.join('\n');
  }

  function respond(query, context) {
    const { data, selected, currency, monthName, last } = context;
    const cooked = model.normalize(query);
    const words = questionWords(query);
    const namedMerchant = query.match(/[«"“]([^»"”]{1,120})[»"”]/)?.[1]?.trim();
    const category = Object.keys(categoryWords).find(key => words.some(word => categoryWords[key].test(word)));
    const relativeBase = /^[аи] /.test(cooked) ? last?.month || selected : selected;
    const dateMention = findMonth(cooked, words, data.months, relativeBase);
    const explicitMonths = mentionedMonths(cooked, data.months, selected);
    const isFollowup = (dateMention || category) && (cooked.startsWith('а ') || cooked.startsWith('и ') ||
      (dateMention && words.filter(meaningful).every(word => /^\d+$/.test(word))));
    const modelIntent = classify(clean(query))?.key;
    const rowNumber = cooked.match(/строк[аеуиы]?\s*(?:№\s*)?(\d+)/)?.[1];
    const intent = (rowNumber && 'audit') || (namedMerchant && 'find') || (isFollowup && last?.intent) || modelIntent || (category && 'sum');
    const priceBase = prices.at(-1).month;
    const customCompare = intent === 'change' && explicitMonths.length === 2;
    const month = (customCompare ? explicitMonths[1] : intent === 'prices' ?
      findMonth(cooked, words, prices.map(row => row.month), isFollowup ? last?.month || priceBase : priceBase) : dateMention) ||
      (isFollowup ? last?.month : '') || (intent === 'prices' ? priceBase : selected);
    const comparisonMonth = customCompare ? explicitMonths[0] : intent === 'change' && isFollowup && !dateMention ?
      last?.comparisonMonth || model.priorMonth(month) : model.priorMonth(month);
    const group = category || (isFollowup ? last?.category : '');
    const merchant = namedMerchant || (isFollowup ? last?.merchant : '');
    const answer = (text, action) => ({ text, action, memory: { intent, month, comparisonMonth, category: group, merchant } });
    const caveat = (text, action, months = [month]) => {
      const pending = data.duplicateGroups.filter(entry => entry.members.some(row =>
        row.direction === 'out' && months.some(value => row.date.startsWith(value))) &&
        !context.decisions?.has(entry.id)).length;
      return answer(text + (pending ? '\nПредварительно: в этих периодах есть непроверенные совпадения (' + pending + ').' : ''), action);
    };
    const unknown = () => ({ text: 'Я разбираю выписку и официальные данные о ценах. Спросите, что изменилось за месяц, сколько ушло на продукты, есть ли дубли, или найдите магазин по названию в кавычках.' });
    const prettyPercent = new Intl.NumberFormat('ru-KZ', { maximumFractionDigits: 1 });
    const signedMoney = amount => (amount > 0 ? '+' : amount < 0 ? '−' : '') + currency(Math.abs(amount));

    if (!intent) return unknown();
    if (intent === 'import') return answer('Загрузите CSV с датой, описанием и суммой либо с колонками списания и зачисления. Подойдут русские и английские заголовки. Файл обрабатывается в браузере.', { type: 'import' });
    if (intent === 'audit') {
      const found = data.duplicateGroups.length;
      const pending = found - data.reviewed;
      if (rowNumber) {
        const match = data.duplicateGroups.find(entry => entry.members.some(row => row.line === Number(rowNumber)));
        return match ? answer(groupEvidence(match, currency), { type: 'audit', groupId: match.id }) :
          answer('Строка ' + rowNumber + ' не входит ни в одну найденную группу совпадений.');
      }
      if (!found) return answer('В открытой выписке подозрительных совпадений по номерам операций или реквизитам не найдено.');
      const removed = data.operations.filter(row => row.direction === 'out' && data.excluded.has(row.id));
      const after = model.total(data.expenses);
      const difference = model.total(removed);
      const first = data.duplicateGroups.find(entry => !context.decisions?.has(entry.id));
      const impact = '\nРасходы по всей выписке: ' + currency(after + difference) + ' до проверки, ' + currency(after) + ' сейчас.';
      const lines = removed.length ? '\nИсключённые списания: строки ' + removed.slice(0, 5).map(row => row.line).join(', ') +
        (removed.length > 5 ? ' и ещё ' + (removed.length - 5) : '') + '.' : '';
      return answer('Групп совпадений: ' + found + '. На проверке: ' + pending + '. Исключено строк: ' + data.excluded.size +
        '.' + impact + lines + (first && pending ? '\n\n' + groupEvidence(first, currency) : ''),
      { type: 'audit', groupId: first?.id });
    }
    if (intent === 'prices') {
      const entry = prices.find(item => item.month === month);
      if (!entry) return answer('У меня есть опубликованные показатели Бюро национальной статистики Казахстана за январь–октябрь 2026 года. Выберите месяц из этого диапазона.', { type: 'prices' });
      const before = prices[prices.indexOf(entry) - 1];
      const diff = before ? '\nГодовой темп изменился на ' + prettyPercent.format(entry.annual - before.annual) + ' п. п.' : '';
      return answer(monthName(month) + '. В Казахстане цены выросли на ' + prettyPercent.format(entry.monthly) +
        '% за месяц и на ' + prettyPercent.format(entry.annual) + '% за год.' + diff,
      { type: 'source', label: 'БНС · ' + entry.published.split('-').reverse().join('.'), url: entry.source });
    }
    if (!data.months.includes(month)) return answer('За этот месяц в открытой выписке нет данных. Выберите месяц из списка в дашборде или загрузите выписку за нужный период.');
    const snapshot = model.expenseMonth(data, month);
    const comparison = intent === 'change' ? model.comparePeriods(data, month, comparisonMonth) : model.compareMonth(data, month);
    const rows = group ? snapshot.rows.filter(row => row.classification.key === group) : snapshot.rows;
    const table = { type: 'table', month, category: group };
    const header = monthName(month) + (snapshot.first > 1 || snapshot.last < model.daysInMonth(month) ?
      ' · ' + snapshot.first + '–' + snapshot.last + ' числа' : '');

    if (intent === 'change') {
      if (explicitMonths.length > 2) return answer('Назовите два месяца, которые нужно сравнить.');
      if (!comparison) return answer('Для сравнения «' + monthName(comparisonMonth) + '» и «' + monthName(month) +
        '» нужны операции за оба месяца и пересекающиеся дни.');
      const contributions = model.categoryChanges(comparison);
      const matched = contributions.find(item => item.key === group);
      const delta = group ? matched?.delta || 0 : comparison.delta;
      const totalBefore = group ? matched?.old || 0 : comparison.base;
      const totalAfter = group ? matched?.amount || 0 : comparison.sum;
      const main = contributions.filter(item => item.delta).slice(0, 3);
      let message = monthName(comparisonMonth) + ' → ' + monthName(month) +
        (comparison.partial ? ' · ' + comparison.first + '–' + comparison.last + ' числа' : '') +
        '\n' + (group ? model.categories[group].label : 'Расходы') + ': ' + currency(totalBefore) + ' → ' + currency(totalAfter) +
        ' (' + signedMoney(delta) + ').';
      if (totalBefore && delta) message += ' На ' + prettyPercent.format(Math.abs(delta / totalBefore) * 100) +
        (delta > 0 ? '% больше.' : '% меньше.');
      if (!group && main.length) message += '\n' + main.map(item => model.categories[item.key].label + ': ' + signedMoney(item.delta)).join(' · ');
      const leading = matched || main.find(item => Math.sign(item.delta) === Math.sign(delta));
      const action = { ...table, month: leading && !leading.amount && leading.old ? comparisonMonth : month,
        category: group || leading?.key, range: comparison.partial ? comparison : null };
      return caveat(message, action, [month, comparisonMonth]);
    }
    if (intent === 'sum') {
      return caveat(header + '\n' + (group ? model.categories[group].label : 'Расходы') + ': ' + currency(model.total(rows)) +
        ' · операций: ' + rows.length + '.', table);
    }
    if (intent === 'find') {
      const matched = snapshot.rows.filter(row => model.normalize(row.description).includes(model.normalize(merchant)));
      return caveat(header + '\n«' + merchant + '»: операций ' + matched.length + ' на ' + currency(model.total(matched)) + '.',
        { ...table, category: '', query: merchant });
    }
    if (!rows.length) return answer(header + '. За этот период подходящих расходных операций нет.', table);
    if (intent === 'largest') {
      const [key, amount] = model.groups(rows)[0];
      const first = rows.reduce((largest, row) => row.amount > largest.amount ? row : largest);
      return caveat(header + '\nБольше всего ушло на «' + model.categories[key].label + '» — ' + currency(amount) +
        '. Крупнейшее списание: ' + first.description + ' — ' + currency(first.amount) + ' (строка ' + first.line + ').', { type: 'detail', month, id: first.id });
    }
    if (intent === 'recurring') {
      const repeats = model.recurring(comparison?.current || [], comparison?.previous || []);
      return repeats.length ? caveat(header + '\nПовторяющихся платежей: ' + repeats.length + ' на ' + currency(model.total(repeats)) +
        '. Основание: совпадает описание, суммы и даты близки.\n' + repeats.slice(0, 5)
        .map(row => row.description + ' — ' + currency(row.amount) + ' (строка ' + row.line + ')').join('\n'),
      { type: 'table', month, ids: repeats.map(row => row.id) }, [month, model.priorMonth(month)]) :
        answer(header + '. Повторяющиеся платежи по предыдущему месяцу не подтверждены.', table);
    }
    if (intent === 'anomaly') {
      const before = group ? (comparison?.previous || []).filter(row => row.classification.key === group) : comparison?.previous || [];
      const signal = model.anomaly(rows, before);
      return signal ? caveat(header + '\n' + signal.row.description + ' — ' + currency(signal.row.amount) + ' (строка ' + signal.row.line + ')' +
        '. Медиана сопоставимых операций в этой категории — ' + currency(signal.baseline) + '.', { type: 'detail', month, id: signal.row.id }) :
        answer(header + '. Не нашлось операции, которая явно превышала бы обычную сумму в своей категории.', table);
    }
    return unknown();
  }

  const api = { respond, prices };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else window.FinScopeAgent = api;
})();
