let _CRDT = null;

class SubdocManager {
  constructor(parentCrdt) {
    this.parent = parentCrdt;
    this.subdocs = new Map();
    this.autoLoad = false;
    this._listeners = new Map();
  }

  on(event, handler) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(handler);
    return () => {
      const handlers = this._listeners.get(event);
      if (handlers) {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      }
    };
  }

  _emit(event, data) {
    const handlers = this._listeners.get(event);
    if (handlers) {
      for (const h of handlers) h(data);
    }
  }

  getSubdoc(name) {
    if (this.subdocs.has(name)) {
      return this.subdocs.get(name);
    }
    const subdoc = new SubdocCRDT(this.parent, name, this.autoLoad);
    this.subdocs.set(name, subdoc);
    this._emit('subdocs', { action: 'add', name, subdoc });
    return subdoc;
  }

  removeSubdoc(name) {
    const subdoc = this.subdocs.get(name);
    if (subdoc) {
      subdoc.destroy();
      this.subdocs.delete(name);
      this._emit('subdocs', { action: 'remove', name, subdoc });
      return true;
    }
    return false;
  }

  hasSubdoc(name) {
    return this.subdocs.has(name);
  }

  getSubdocNames() {
    return Array.from(this.subdocs.keys());
  }

  getSubdocGuids() {
    return this.getSubdocNames();
  }

  getLoadedSubdocs() {
    const result = [];
    for (const [name, subdoc] of this.subdocs) {
      if (subdoc.loaded) result.push({ name, subdoc });
    }
    return result;
  }

  load(name) {
    const subdoc = this.subdocs.get(name);
    if (subdoc && !subdoc.loaded) {
      subdoc.load();
      return true;
    }
    return false;
  }

  forEach(fn) {
    for (const [name, subdoc] of this.subdocs) {
      fn(subdoc, name);
    }
  }

  destroy() {
    for (const [name, subdoc] of this.subdocs) {
      subdoc.destroy();
    }
    this.subdocs.clear();
    this._listeners.clear();
  }
}

class SubdocCRDT {
  constructor(parentCrdt, name, autoLoad) {
    this.parentCrdt = parentCrdt;
    this.name = name;
    this.autoLoad = autoLoad;
    this.loaded = false;
    this.crdt = null;

  }

  load() {
    if (this.loaded) return;
    if (!_CRDT) _CRDT = require('./crdt').CRDT;
    this.crdt = new _CRDT(this.parentCrdt.clientId + 1000 + this.parentCrdt.subdocManager.subdocs.size);
    this.loaded = true;
    if (this.autoLoad) {
      this.crdt.transact(() => {});
    }
  }

  ensureLoaded() {
    if (!this.loaded) this.load();
    return this.crdt;
  }

  getText(name) {
    return this.ensureLoaded().getText(name);
  }

  getMap(name) {
    return this.ensureLoaded().getMap(name);
  }

  getArray(name) {
    return this.ensureLoaded().getArray(name);
  }

  getCounter(name) {
    return this.ensureLoaded().getCounter(name);
  }

  transact(fn) {
    return this.ensureLoaded().transact(fn);
  }

  observe(type, handler) {
    return this.ensureLoaded().observe(type, handler);
  }

  getStateVector() {
    if (!this.loaded) return [];
    return this.crdt.getStateVector();
  }

  destroy() {
    this.loaded = false;
    this.crdt = null;
  }
}

module.exports = { SubdocManager, SubdocCRDT };
