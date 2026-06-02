class StorageProvider {
  constructor(options = {}) {
    this.options = options;
    this.type = options.type || 'memory';
    this.store = new Map();
    this.docs = new Map();
  }

  async save(key, data) {
    switch (this.type) {
      case 'memory':
        this.store.set(key, data);
        return true;
      default:
        this.store.set(key, data);
        return true;
    }
  }

  async load(key) {
    return this.store.get(key) || null;
  }

  async delete(key) {
    return this.store.delete(key);
  }

  async has(key) {
    return this.store.has(key);
  }

  async keys() {
    return Array.from(this.store.keys());
  }

  async clear() {
    this.store.clear();
    return true;
  }
}

class MemoryStorage extends StorageProvider {
  constructor(options = {}) {
    super({ ...options, type: 'memory' });
  }
}

class IndexedDBStorage extends StorageProvider {
  constructor(options = {}) {
    super({ ...options, type: 'indexeddb' });
    this.dbName = options.dbName || 'rjs-store';
    this.dbVersion = options.dbVersion || 1;
    this.storeName = options.storeName || 'rjs-docs';
    this.db = null;
    this.ready = false;
  }

  async init() {
    if (this.ready) return;
    if (typeof indexedDB === 'undefined') {
      this.type = 'memory';
      return;
    }
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
      request.onsuccess = (event) => {
        this.db = event.target.result;
        this.ready = true;
        resolve();
      };
      request.onerror = (event) => {
        this.type = 'memory';
        resolve();
      };
    });
  }

  async save(key, data) {
    await this.init();
    if (!this.db) return super.save(key, data);
    return new Promise((resolve) => {
      try {
        const txn = this.db.transaction(this.storeName, 'readwrite');
        const store = txn.objectStore(this.storeName);
        store.put(data, key);
        txn.oncomplete = () => resolve(true);
        txn.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }

  async load(key) {
    await this.init();
    if (!this.db) return super.load(key);
    return new Promise((resolve) => {
      try {
        const txn = this.db.transaction(this.storeName, 'readonly');
        const store = txn.objectStore(this.storeName);
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async delete(key) {
    await this.init();
    if (!this.db) return super.delete(key);
    return new Promise((resolve) => {
      try {
        const txn = this.db.transaction(this.storeName, 'readwrite');
        const store = txn.objectStore(this.storeName);
        store.delete(key);
        txn.oncomplete = () => resolve(true);
        txn.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }

  async keys() {
    await this.init();
    if (!this.db) return super.keys();
    return new Promise((resolve) => {
      try {
        const txn = this.db.transaction(this.storeName, 'readonly');
        const store = txn.objectStore(this.storeName);
        const request = store.getAllKeys();
        request.onsuccess = () => resolve(Array.from(request.result));
        request.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  }
}

const { Serializer } = require('../serialization/serializer');

class AutoPersist {
  constructor(crdt, storage, options = {}) {
    this.crdt = crdt;
    this.storage = storage;
    this.docKey = options.docKey || `rjs-doc-${crdt.clientId}`;
    this.interval = options.persistInterval || 5000;
    this.timer = null;
    this.dirty = false;
    this.serializer = options.serializer || new Serializer();
    this._bound = this._markDirty.bind(this);
    this.crdt.observe('update', this._bound);
    this._startTimer();
  }

  _markDirty() {
    this.dirty = true;
  }

  _startTimer() {
    this.timer = setInterval(() => {
      if (this.dirty) {
        this.persist();
      }
    }, this.interval);
  }

  async persist() {
    try {
      const buf = this.serializer.encodeDocument(this.crdt);
      await this.storage.save(this.docKey, buf);
      this.dirty = false;
      return true;
    } catch {
      return false;
    }
  }

  async load() {
    try {
      const buf = await this.storage.load(this.docKey);
      if (buf) {
        this.serializer.decodeDocument(buf, this.crdt);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  destroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

module.exports = { StorageProvider, MemoryStorage, IndexedDBStorage, AutoPersist };
