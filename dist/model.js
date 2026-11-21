(function () {
  'use strict';

  const categories = {
    grocery: { label: 'Продукты', color: '#348a6a', examples: [
      'продукты супермаркет магазин у дома', 'magnum продукты и бакалея', 'small супермаркет', 'spar касса магазин', 'овощи фрукты на рынке', 'хлеб молоко пекарня', 'фермерские продукты мясо', 'grocery market supermarket', 'арбуз фрукты овощи', 'супермаркет продукты молоко',
    ] },
    shopping: { label: 'Покупки', color: '#8e86bf', examples: [
      'техника электроника наушники монитор', 'технодом technodom ноутбук', 'sulpak телевизор электроника', 'магазин одежда ботинки', 'wildberries одежда обувь', 'ozon заказ товары', 'маркетплейс покупки', 'книга канцелярия магазин', 'мебель декор дом', 'zara одежда куртка',
    ] },
    dining: { label: 'Кафе и доставка', color: '#da9e62', examples: [
      'кафе кофе кофейня обед', 'coffee espresso капучино латте', 'ресторан ужин еда', 'пицца доставка бургер', 'wolt доставка еды', 'glovo доставка обеда', 'doner донер шаурма', 'столовая обед ланч', 'суши роллы ресторан', 'чай кофе выпечка кофейня',
    ] },
    transport: { label: 'Транспорт', color: '#6596be', examples: [
      'такси yandex go поездка', 'яндекс такси поездка', 'onay проезд автобус метро', 'заправка бензин топливо азс', 'парковка автостоянка', 'indrive taxi такси поездка', 'автобус маршрутка проезд', 'билет поезд железная дорога', 'каршеринг аренда авто', 'uber taxi transport',
    ] },
    bills: { label: 'Счета и подписки', color: '#a6bc67', examples: [
      'оплата интернета wifi', 'сотовая связь мобильный тариф', 'beeline пополнение связи', 'tele2 тариф связь', 'коммунальные услуги электричество', 'квартплата вода отопление', 'подписка spotify музыка', 'apple icloud облако подписка', 'кинопоиск подписка netflix', 'абонентская плата аренда платеж',
    ] },
    health: { label: 'Здоровье', color: '#c78593', examples: [
      'аптека лекарства таблетки', 'медцентр клиника врач', 'стоматология прием стоматолога', 'анализы лаборатория кровь', 'аптека витамины медикаменты', 'optika оптика очки линзы', 'фитнес спортзал абонемент', 'поликлиника медицинский осмотр', 'pharmacy meds аптечный пункт', 'аптека лекарства рецепты',
    ] },
    other: { label: 'Другое', color: '#a4b4ad', examples: [] },
  };

  function normalize(value) {
    return value.toLowerCase().replaceAll('ё', 'е');
  }

  function tokens(value) {
    return (normalize(value).match(/[\p{L}]{2,}/gu) || []).map(word => ({ word, stem: word.slice(0, 5) }));
  }

  function train(examples) {
    const lexicon = new Set();
    const classes = Object.entries(examples).map(([key, phrases]) => {
      const counts = new Map();
      let total = 0;
      for (const example of phrases) {
        for (const { stem } of tokens(example)) {
          counts.set(stem, (counts.get(stem) || 0) + 1);
          lexicon.add(stem);
          total++;
        }
      }
      return { key, counts, total };
    });
    return text => {
      const features = [...new Map(tokens(text).map(token => [token.stem, token])).values()]
        .filter(token => lexicon.has(token.stem));
      if (!features.length) return null;
      const ranked = classes.map(({ key, counts, total }) => ({
        key,
        score: features.reduce((sum, { stem }) => sum + Math.log(((counts.get(stem) || 0) + 0.35) / (total + lexicon.size * 0.35)), 0),
        words: features.filter(({ stem }) => counts.has(stem)).map(({ word }) => word),
      })).sort((a, b) => b.score - a.score);
      const best = ranked[0];
      return best.words.length && best.score - ranked[1].score >= 0.48 ? best : null;
    };
  }

  const classifyPurchase = train(Object.fromEntries(Object.entries(categories)
    .filter(([, row]) => row.examples.length).map(([key, row]) => [key, row.examples])));

  function classify(description, supplied = '') {
    const explicit = Object.keys(categories).find(key => key === normalize(supplied) || normalize(categories[key].label) === normalize(supplied));
    if (explicit) return { key: explicit, method: 'file', words: [] };
    const result = classifyPurchase(description);
    return result ? { key: result.key, method: 'model', words: result.words } : { key: 'other', method: 'unknown', words: [] };
  }

  function dateValue(raw) {
    const day = raw.trim().replace(/[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/i, '');
    const local = day.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    const value = local ? [local[3], local[2].padStart(2, '0'), local[1].padStart(2, '0')].join('-') : day;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '2099-12-31') return '';
    const parsed = new Date(value + 'T00:00:00Z');
    return !Number.isNaN(+parsed) && parsed.toISOString().startsWith(value) ? value : '';
  }

  function amountValue(raw) {
    const value = raw.trim().replace(/[\s\u00a0\u202f]/g, '').replace('−', '-').replace(',', '.');
    if (!/^[+-]?\d{1,9}(\.\d{1,2})?$/.test(value)) return null;
    return Math.round(Number(value) * 100);
  }

  function headerDelimiter(input) {
    let quoted = false;
    const counts = { ',': 0, ';': 0, '\t': 0 };
    for (const char of input) {
      if (char === '"') quoted = !quoted;
      if (!quoted && /[\r\n]/.test(char)) break;
      if (!quoted && Object.hasOwn(counts, char)) counts[char]++;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  function csvRows(input, offset = 0) {
    const delimiter = headerDelimiter(input);
    const rows = [];
    let row = [], value = '', quoted = false, closed = false, line = offset + 1, rowLine = line;
    for (let index = 0; index <= input.length; index++) {
      const char = input[index];
      const lineBreak = char === '\r' || (char === '\n' && input[index - 1] !== '\r');
      if (quoted) {
        if (char === '"' && input[index + 1] === '"') {
          value += '"';
          index++;
        } else if (char === '"') {
          quoted = false;
          closed = true;
        } else if (char === undefined) {
          throw new Error('Незакрытая кавычка в записи со строки ' + rowLine + '.');
        } else {
          value += char;
        }
      } else if (char === undefined || char === '\n' || char === '\r' || char === delimiter) {
        row.push(value.trim());
        value = '';
        closed = false;
        if (char !== delimiter) {
          if (row.some(Boolean)) rows.push({ cells: row, line: rowLine });
          row = [];
          if (char === '\r' && input[index + 1] === '\n') index++;
          rowLine = line + 1;
        }
      } else if (char === '"' && !value.trim() && !closed) {
        quoted = true;
        value = '';
      } else if (char === '"' || (closed && char.trim())) {
        throw new Error('Проверьте кавычки в строке ' + line + '.');
      } else if (!closed) {
        value += char;
      }
      if (lineBreak) line++;
    }
    return rows;
  }

  const headersByField = {
    date: ['date', 'transaction date', 'operation date', 'дата', 'дата операции', 'дата транзакции', 'дата платежа'],
    description: ['description', 'name', 'merchant', 'details', 'описание', 'описание операции', 'детали', 'детали операции', 'наименование', 'магазин', 'назначение платежа'],
    amount: ['amount', 'transaction amount', 'сумма', 'сумма операции', 'сумма платежа'],
    debit: ['debit', 'withdrawal', 'расход', 'расходы', 'списание', 'сумма списания', 'дебет'],
    credit: ['credit', 'deposit', 'приход', 'поступление', 'пополнение', 'зачисление', 'кредит'],
    currency: ['currency', 'currency code', 'валюта', 'код валюты'],
    direction: ['direction', 'направление', 'тип операции', 'operation type'],
    category: ['category', 'категория', 'категория расходов'],
    reference: ['transaction id', 'operation id', 'reference', 'rrn', 'id операции', 'ид операции', 'номер операции', 'идентификатор операции'],
    account: ['account', 'account id', 'счет', 'номер счета'],
  };

  function fieldsFrom(headers) {
    const normalized = headers.map(name => normalize(name).replace(/[^\p{L}\p{N}]+/gu, ' ').trim());
    return Object.fromEntries(Object.entries(headersByField).flatMap(([field, aliases]) => {
      const used = aliases.find(alias => normalized.includes(alias));
      return used ? [[field, normalized.indexOf(used)]] : [];
    }));
  }

  function parseCsv(content, options = {}) {
    const input = content.replace(/^\uFEFF/, '');
    const leading = input.match(/^\s*/)[0];
    const offset = (leading.match(/\r\n|[\r\n]/g) || []).length;
    const [header, ...rows] = csvRows(input.slice(leading.length), offset);
    const headers = header?.cells || [];
    const columns = fieldsFrom(headers);
    const separate = !Object.hasOwn(columns, 'amount');
    if (!['date', 'description'].every(name => Object.hasOwn(columns, name)) ||
        (separate && !['debit', 'credit'].some(name => Object.hasOwn(columns, name)))) {
      throw new Error('Нужны колонки «Дата», «Описание» и «Сумма» либо «Списание» / «Зачисление». Можно скачать пример.');
    }
    if (new Set(headers.filter(Boolean).map(normalize)).size !== headers.filter(Boolean).length) {
      throw new Error('Названия столбцов в CSV должны быть уникальными.');
    }
    if (!rows.length) throw new Error('В файле есть заголовки, но нет операций.');
    if (rows.length > 15000) throw new Error('В одном CSV можно обработать до 15 000 операций.');

    const issues = [];
    let invalidCount = 0;
    function recordError(line, reason) {
      invalidCount++;
      if (issues.length < 10) issues.push('Строка ' + line + ' — ' + reason + '.');
    }
    const raw = rows.flatMap(({ cells: row, line }, index) => {
      if (row.length !== headers.length) {
        recordError(line, 'неверное количество столбцов');
        return [];
      }
      const rawDate = row[columns.date];
      const date = dateValue(rawDate);
      const timeMatch = rawDate.match(/[T ](\d{2}:\d{2})(:\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i);
      const time = timeMatch ? timeMatch[1] + (timeMatch[2] || ':00') + (timeMatch[3] || '').toUpperCase() : '';
      const description = row[columns.description];
      const cellAmount = field => amountValue((row[columns[field]] || '').replace(/^[-—–]$/, '') || '0');
      const debit = separate ? cellAmount('debit') : 0;
      const credit = separate ? cellAmount('credit') : 0;
      const amount = separate ? debit || credit : amountValue(row[columns.amount]);
      const type = normalize(row[columns.direction] || '');
      const directions = {
        'out': 'out', 'debit': 'out', 'списание': 'out', 'расход': 'out', 'покупка': 'out', 'оплата': 'out',
        'in': 'in', 'credit': 'in', 'пополнение': 'in', 'зачисление': 'in', 'поступление': 'in', 'возврат': 'in',
        'transfer': 'transfer', 'перевод между своими счетами': 'transfer',
      };
      const direction = Object.hasOwn(directions, type) ? directions[type] : separate ? (debit ? 'out' : 'in') : '';
      const currencyText = row[columns.currency] || options.currency || 'KZT';
      const symbols = { '₸': 'KZT', 'ТГ': 'KZT', 'ТЕНГЕ': 'KZT', '₽': 'RUB', 'РУБ': 'RUB', '$': 'USD', '€': 'EUR' };
      const code = currencyText.toUpperCase().replace(/\.$/, '');
      const currency = Object.hasOwn(symbols, code) ? symbols[code] : code;
      const explicitType = ['direction', 'направление'].includes(normalize(headers[columns.direction] || ''));
      const reference = row[columns.reference] || '';
      const account = row[columns.account] || '';
      const problems = [];
      if (!date) problems.push('неверная дата');
      if (!description || description.length > 240) problems.push('нужно описание до 240 символов');
      if (amount === null || debit === null || credit === null) problems.push('неверная сумма');
      if (debit && credit) problems.push('одновременно указаны списание и зачисление');
      if (!/^[A-Z]{3}$/.test(currency)) problems.push('неверная валюта');
      if (explicitType && type && !Object.hasOwn(directions, type)) problems.push('неизвестное направление');
      if (reference.length > 160 || account.length > 160) problems.push('слишком длинный номер операции или счёта');
      if (problems.length) {
        recordError(line, problems.join(', '));
        return [];
      }
      return [{ id: index + 1, line, date, time, description, amount, direction, currency, reference, account, category: row[columns.category] || '' }];
    });
    if (invalidCount) {
      const error = new Error(invalidCount === 1 ? issues[0] : 'Найдены ошибки в строках: ' + invalidCount + '. Исправьте CSV и загрузите снова.');
      if (invalidCount > 1) error.details = issues;
      if (invalidCount > issues.length) error.details.push('Других строк с ошибками: ' + (invalidCount - issues.length) + '.');
      throw error;
    }

    const currencies = new Set(raw.map(row => row.currency));
    if (currencies.size > 1) throw new Error('Для сравнения сумм загрузите выписку в одной валюте.');
    const negativeDebits = options.sign === 'negative' || (options.sign !== 'positive' && raw.some(row => !row.direction && row.amount < 0));
    const operations = raw.map(row => {
      const direction = row.direction || (row.amount && (negativeDebits ? row.amount < 0 : row.amount > 0) ? 'out' : 'in');
      return { ...row, amount: Math.abs(row.amount), direction,
        classification: direction === 'out' ? classify(row.description, row.category) : null };
    });
    const duplicateGroups = detectDuplicates(operations);
    return reviewedData({ operations, currency: raw[0].currency, imported: raw.length, duplicateGroups });
  }

  function bucketRows(rows, key) {
    const buckets = new Map();
    for (const row of rows) {
      const value = key(row);
      if (!value) continue;
      if (!buckets.has(value)) buckets.set(value, []);
      buckets.get(value).push(row);
    }
    return [...buckets.values()].filter(group => group.length > 1);
  }

  function detectDuplicates(rows) {
    const signature = row => JSON.stringify([row.account, row.date, row.time,
      normalize(row.description.normalize('NFC')).replace(/\s+/g, ' '), row.amount, row.direction, row.currency]);
    const candidates = rows.filter(row => row.amount || row.reference);
    const knownIds = bucketRows(candidates, row => row.reference && JSON.stringify([row.account, row.reference]));
    const claimed = new Set(knownIds.flatMap(group => group.map(row => row.id)));
    const groups = knownIds.map(members => ({ kind: new Set(members.map(signature)).size === 1 ? 'reference' : 'conflict', members }));
    const similar = bucketRows(candidates.filter(row => row.amount && !claimed.has(row.id)), signature);
    for (const members of similar) {
      if (new Set(members.map(row => row.reference).filter(Boolean)).size <= 1) groups.push({ kind: 'candidate', members });
    }
    const priority = { conflict: 0, reference: 1, candidate: 2 };
    return groups.map(group => ({ ...group, id: group.members[0].id }))
      .sort((a, b) => priority[a.kind] - priority[b.kind] || a.members[0].line - b.members[0].line);
  }

  function reviewedData(data, decisions = new Map()) {
    const excluded = new Set();
    let reviewed = 0;
    for (const group of data.duplicateGroups) {
      if (!decisions.has(group.id)) continue;
      const included = decisions.get(group.id);
      const selected = group.members.filter(row => included.has(row.id));
      if (!selected.length || selected.length !== included.size) throw new Error('Оставьте хотя бы одну строку из этой группы.');
      reviewed++;
      for (const row of group.members) if (!included.has(row.id)) excluded.add(row.id);
    }
    const activeRows = data.operations.filter(row => !excluded.has(row.id));
    const expenses = activeRows.filter(row => row.amount > 0 && row.direction === 'out');
    const orderedDates = activeRows.map(row => row.date).sort();
    const months = [...new Set(orderedDates.map(day => day.slice(0, 7)))];
    return { ...data, expenses, excluded, reviewed, firstDate: orderedDates[0], lastDate: orderedDates.at(-1), months };
  }

  function groups(rows) {
    const totals = new Map();
    for (const row of rows) {
      const key = row.classification.key;
      totals.set(key, (totals.get(key) || 0) + row.amount);
    }
    return [...totals].sort((a, b) => b[1] - a[1]);
  }

  function total(rows) {
    return rows.reduce((sum, row) => sum + row.amount, 0);
  }

  function exportExpenses(rows) {
    function cell(value) {
      const text = String(value);
      const safe = /^[\s\u0000-\u001f]*[=+\-@]|^[\t\r\n]/.test(text) ? "'" + text : text;
      return '"' + safe.replace(/"/g, '""') + '"';
    }
    const header = 'date;description;amount;currency;direction;category;transaction_id;account;source_line';
    const lines = rows.map(row => [row.date, row.description, (row.amount / 100).toFixed(2), row.currency, row.direction,
      row.classification.key, row.reference, row.account, row.line].map(cell).join(';'));
    return '\uFEFF' + [header, ...lines].join('\r\n') + '\r\n';
  }

  function daysInMonth(month) {
    const [year, number] = month.split('-').map(Number);
    return new Date(Date.UTC(year, number, 0)).getUTCDate();
  }

  function priorMonth(month) {
    const [year, number] = month.split('-').map(Number);
    return new Date(Date.UTC(year, number - 2, 1)).toISOString().slice(0, 7);
  }

  function monthBounds(data, month) {
    return {
      first: data.firstDate.startsWith(month) ? Number(data.firstDate.slice(-2)) : 1,
      last: data.lastDate.startsWith(month) ? Number(data.lastDate.slice(-2)) : daysInMonth(month),
    };
  }

  function expenseMonth(data, month) {
    const bounds = monthBounds(data, month);
    const rows = data.expenses.filter(row => row.date.startsWith(month));
    return { month, rows, ...bounds, sum: total(rows) };
  }

  function compareMonth(data, month) {
    return comparePeriods(data, month, priorMonth(month));
  }

  function comparePeriods(data, month, prior) {
    if (!data.months.includes(month) || !data.months.includes(prior)) return null;
    const now = expenseMonth(data, month);
    const before = expenseMonth(data, prior);
    const partial = now.first > 1 || before.first > 1 || now.last < daysInMonth(month) || before.last < daysInMonth(prior);
    const first = Math.max(now.first, before.first);
    const last = Math.min(now.last, before.last);
    if (first > last) return null;
    const inRange = row => {
      const day = Number(row.date.slice(-2));
      return day >= first && day <= last;
    };
    const current = partial ? now.rows.filter(inRange) : now.rows;
    const previous = partial ? before.rows.filter(inRange) : before.rows;
    const sum = total(current);
    const base = total(previous);
    return { first, last, current, previous, sum, base, delta: sum - base,
      ratio: base ? (sum - base) / base : null, partial };
  }

  function categoryChanges(comparison) {
    if (!comparison) return [];
    const now = new Map(groups(comparison.current));
    const before = new Map(groups(comparison.previous));
    return [...new Set([...now.keys(), ...before.keys()])].map(key => {
      const amount = now.get(key) || 0;
      const old = before.get(key) || 0;
      return { key, amount, old, delta: amount - old };
    }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }

  function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function anomaly(rows, previous) {
    const large = [];
    const byCategory = new Map();
    for (const row of [...rows, ...previous]) {
      const key = row.classification.key;
      if (!byCategory.has(key)) byCategory.set(key, []);
      byCategory.get(key).push(row);
    }
    for (const peers of byCategory.values()) {
      if (peers.length < 5) continue;
      const ordered = [...peers].sort((a, b) => a.amount - b.amount);
      for (const row of ordered.slice(-3)) {
        if (!rows.includes(row) || row.classification.key === 'other') continue;
        const amounts = ordered.filter(peer => peer !== row).map(peer => peer.amount);
        const baseline = median(amounts);
        const deviation = median(amounts.map(amount => Math.abs(amount - baseline)));
        if (row.amount > Math.max(2.5 * baseline, baseline + 5 * deviation)) large.push({ row, baseline });
      }
    }
    return large.sort((a, b) => b.row.amount - a.row.amount)[0];
  }

  function recurring(rows, previous) {
    const payee = row => normalize(row.description).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const byPayee = new Map();
    for (const row of previous) {
      const key = payee(row);
      if (!byPayee.has(key)) byPayee.set(key, []);
      byPayee.get(key).push(row);
    }
    const matches = new Map();
    for (const row of rows) {
      if (row.classification.key !== 'bills') continue;
      const key = payee(row);
      const match = byPayee.get(key)?.find(old => Math.abs(row.amount - old.amount) <= row.amount * 0.05 &&
        Math.abs(Number(row.date.slice(-2)) - Number(old.date.slice(-2))) <= 6);
      if (match && (!matches.has(key) || matches.get(key).date < row.date)) matches.set(key, row);
    }
    return [...matches.values()];
  }

  const demo = `date;description;amount;currency
2026-06-01;ICloud подписка;990;KZT
2026-06-03;Magnum супермаркет;23100;KZT
2026-06-05;Beeline тариф;4990;KZT
2026-06-07;Бензин АЗС;15100;KZT
2026-06-09;Овощи на рынке;12700;KZT
2026-06-11;Ресторан ужин;15600;KZT
2026-06-14;Wildberries одежда;15900;KZT
2026-06-15;Spotify подписка;1990;KZT
2026-06-17;Оплата интернета;7490;KZT
2026-06-21;Magnum супермаркет;28250;KZT
2026-06-26;Аптека лекарства;10400;KZT
2026-06-30;Wolt доставка еды;18800;KZT
2026-07-01;ICloud подписка;990;KZT
2026-07-03;Magnum супермаркет;24500;KZT
2026-07-05;Beeline тариф;4990;KZT
2026-07-07;Бензин АЗС;18830;KZT
2026-07-09;Стоматология прием;23500;KZT
2026-07-13;Wolt доставка еды;17600;KZT
2026-07-15;Spotify подписка;1990;KZT
2026-07-17;Оплата интернета;7490;KZT
2026-07-20;Wildberries одежда;28400;KZT
2026-07-23;Magnum супермаркет;34120;KZT
2026-07-28;Ресторан ужин;13200;KZT
2026-07-31;Small супермаркет;22150;KZT
2026-08-01;ICloud подписка;990;KZT
2026-08-03;Magnum супермаркет;17900;KZT
2026-08-05;Beeline тариф;4990;KZT
2026-08-07;Бензин АЗС;15300;KZT
2026-08-09;Кофейня Coffee Lab;7200;KZT
2026-08-11;Wildberries одежда;19100;KZT
2026-08-15;Spotify подписка;1990;KZT
2026-08-17;Оплата интернета;7490;KZT
2026-08-21;Magnum супермаркет;38100;KZT
2026-08-24;Аптека лекарства;12000;KZT
2026-08-26;Ресторан ужин;19700;KZT
2026-08-31;Small супермаркет;24700;KZT
2026-09-01;ICloud подписка;990;KZT
2026-09-02;Magnum супермаркет;13800;KZT
2026-09-03;Кофейня Coffee Lab;2200;KZT
2026-09-04;Ozon заказ;4200;KZT
2026-09-05;Beeline тариф;4990;KZT
2026-09-06;Apteka · лекарства;6800;KZT
2026-09-07;Yandex Go такси;2800;KZT
2026-09-08;Small супермаркет;6700;KZT
2026-09-09;Столовая обед;3400;KZT
2026-09-10;Бензин АЗС;11100;KZT
2026-09-10;Wildberries одежда;7200;KZT
2026-09-11;Magnum супермаркет;12700;KZT
2026-09-12;Wolt доставка еды;5600;KZT
2026-09-13;Стоматология прием;8200;KZT
2026-09-14;Яндекс такси;2400;KZT
2026-09-15;Spotify подписка;1990;KZT
2026-09-16;Кофейня Coffee Lab;1800;KZT
2026-09-17;Оплата интернета;7490;KZT
2026-09-18;Small супермаркет;8400;KZT
2026-09-19;Книга и канцелярия;4400;KZT
2026-09-20;Парковка;1300;KZT
2026-09-21;Ресторан ужин;6100;KZT
2026-09-22;Овощи на рынке;3900;KZT
2026-09-24;Ozon заказ;3900;KZT
2026-09-25;Onay проезд;2500;KZT
2026-09-27;Magnum супермаркет;14400;KZT
2026-09-29;Glovo доставка обеда;4800;KZT
2026-09-30;Аптека витамины;4300;KZT
2026-10-01;ICloud подписка;990;KZT
2026-10-02;Magnum супермаркет;11890;KZT
2026-10-02;Кофейня Coffee Lab;2450;KZT
2026-10-03;Яндекс такси;2850;KZT
2026-10-04;Ozon заказ;5900;KZT
2026-10-05;Beeline тариф;4990;KZT
2026-10-06;Wolt доставка еды;7990;KZT
2026-10-06;Small супермаркет;7430;KZT
2026-10-07;Аптека витамины;4150;KZT
2026-10-08;Onay проезд;3900;KZT
2026-10-09;Ресторан ужин;9200;KZT
2026-10-09;Фермерские продукты;5300;KZT
2026-10-10;Бензин АЗС;13500;KZT
2026-10-10;Книга и канцелярия;3790;KZT
2026-10-11;Magnum супермаркет;14910;KZT
2026-10-11;Кофейня Coffee Lab;2100;KZT
2026-10-12;Wildberries одежда;6200;KZT
2026-10-13;Wolt доставка еды;6400;KZT
2026-10-14;Яндекс такси;3100;KZT
2026-10-15;Spotify подписка;1990;KZT
2026-10-15;Small супермаркет;8160;KZT
2026-10-16;Аптека лекарства;6300;KZT
2026-10-17;Оплата интернета;7490;KZT
2026-10-18;Пицца доставка;7200;KZT
2026-10-19;Овощи на рынке;4600;KZT
2026-10-19;Яндекс такси;1990;KZT
2026-10-20;Zara одежда;8900;KZT
2026-10-21;Ресторан ужин;13500;KZT
2026-10-22;Magnum супермаркет;16240;KZT
2026-10-23;Бензин АЗС;11700;KZT
2026-10-24;Кофейня Coffee Lab;2750;KZT
2026-10-25;Technodom · наушники;34990;KZT
2026-10-26;Small супермаркет;10320;KZT
2026-10-26;Парковка;1500;KZT
2026-10-27;Glovo доставка обеда;6800;KZT
2026-10-28;Аптека лекарства;5800;KZT
2026-10-29;Yandex Go такси;2200;KZT
2026-10-29;Магазин у дома · продукты;3480;KZT
2026-10-30;Ресторан ужин;7600;KZT
2026-10-31;Magnum супермаркет;12690;KZT`;

  const api = { categories, normalize, train, parseCsv, reviewedData, groups, total, exportExpenses, daysInMonth, priorMonth, expenseMonth, compareMonth, comparePeriods,
    categoryChanges, anomaly, recurring, demo };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else window.FinScopeModel = api;
})();
