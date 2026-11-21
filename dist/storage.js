(function () {
  'use strict';

  const databaseName = 'finscope-ledger';
  const databaseVersion = 1;
  let connection;

  function database() {
    if (!connection) {
      connection = new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName, databaseVersion);
        request.onupgradeneeded = () => {
          const db = request.result;
          db.createObjectStore('statements', { keyPath: 'id' });
          db.createObjectStore('archive', { keyPath: 'id' });
          db.createObjectStore('settings');
        };
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Открытие базы заблокировано другой вкладкой.'));
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => {
            db.close();
            connection = null;
          };
          resolve(db);
        };
      }).catch(error => {
        connection = null;
        throw error;
      });
    }
    return connection;
  }

  function read(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function transaction(names, mode, operation) {
    const db = await database();
    const tx = db.transaction(names, mode);
    const stores = Object.fromEntries(names.map(name => [name, tx.objectStore(name)]));
    const finished = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || new Error('Транзакция базы прервана.'));
    });
    try {
      const [value] = await Promise.all([Promise.resolve().then(() => operation(stores)), finished]);
      return value;
    } catch (error) {
      try { tx.abort(); } catch { /* The transaction may already be closed. */ }
      throw error;
    }
  }

  function reviewSummary(data, decisions) {
    const reviewed = window.FinScopeModel.reviewedData(data, decisions);
    return { firstDate: reviewed.firstDate, lastDate: reviewed.lastDate,
      rows: data.imported, pending: data.duplicateGroups.length - reviewed.reviewed,
      excluded: reviewed.excluded.size, currency: data.currency };
  }

  async function save(filename, data, decisions = new Map()) {
    const id = crypto.randomUUID();
    const now = Date.now();
    const record = { id, filename, importedAt: now, updatedAt: now, decisions, ...reviewSummary(data, decisions) };
    await transaction(['statements', 'archive', 'settings'], 'readwrite', ({ statements, archive, settings }) => {
      statements.add({ id, data });
      archive.add(record);
      settings.put(id, 'active');
    });
    return record;
  }

  function list() {
    return transaction(['archive'], 'readonly', async ({ archive }) => {
      const records = await read(archive.getAll());
      return records.sort((a, b) => b.importedAt - a.importedAt);
    });
  }

  function load(id) {
    return transaction(['statements', 'archive', 'settings'], 'readonly', async ({ statements, archive, settings }) => {
      const key = id || await read(settings.get('active'));
      if (!key) return null;
      const [statement, record] = await Promise.all([read(statements.get(key)), read(archive.get(key))]);
      return statement && record ? { record, data: statement.data } : null;
    });
  }

  async function setActive(id) {
    return transaction(['settings'], 'readwrite', ({ settings }) => {
      if (id) settings.put(id, 'active');
      else settings.delete('active');
    });
  }

  async function saveReview(id, groupId, included) {
    return transaction(['statements', 'archive'], 'readwrite', async ({ statements, archive }) => {
      const [statement, entry] = await Promise.all([read(statements.get(id)), read(archive.get(id))]);
      if (!statement || !entry) throw new Error('Выписка больше не доступна в архиве.');
      const decisions = new Map(entry.decisions);
      decisions.set(groupId, new Set(included));
      const record = { ...entry, decisions, updatedAt: Date.now(), ...reviewSummary(statement.data, decisions) };
      archive.put(record);
      return record;
    });
  }

  async function remove(id) {
    return transaction(['statements', 'archive', 'settings'], 'readwrite', async ({ statements, archive, settings }) => {
      const active = await read(settings.get('active'));
      statements.delete(id);
      archive.delete(id);
      if (active === id) settings.delete('active');
    });
  }

  function budgetKey(currency, month) {
    return 'budget:' + currency + ':' + month;
  }

  function readBudget(currency, month) {
    return transaction(['settings'], 'readonly', async ({ settings }) =>
      await read(settings.get(budgetKey(currency, month))) || new Map());
  }

  function saveBudget(currency, month, category, amount) {
    return transaction(['settings'], 'readwrite', async ({ settings }) => {
      const key = budgetKey(currency, month);
      const limits = await read(settings.get(key)) || new Map();
      if (amount === null) limits.delete(category);
      else limits.set(category, amount);
      if (limits.size) settings.put(limits, key);
      else settings.delete(key);
      return limits;
    });
  }

  window.FinScopeStorage = { save, list, load, setActive, saveReview, remove, readBudget, saveBudget };
})();
