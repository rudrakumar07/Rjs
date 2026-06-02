class YEvent {
  constructor(target, transaction) {
    this.target = target;
    this.currentTarget = target;
    this.transaction = transaction;
    this._changed = new Map();
    this._added = new Map();
    this._deleted = new Map();
    this._delta = [];
  }

  get changed() { return this._changed; }
  get added() { return this._added; }
  get deleted() { return this._deleted; }
  get delta() { return this._delta; }

  keysChanged() { return this._changed.size > 0; }
}

class YTextEvent extends YEvent {
  constructor(target, changes, transaction) {
    super(target, transaction);
    this._delta = changes.delta || [];
    this._changes = changes;
  }

  get delta() { return this._delta; }
  get changes() { return this._changes; }
}

class YMapEvent extends YEvent {
  constructor(target, changes, transaction) {
    super(target, transaction);
    this._changes = changes || {};
  }

  get keysChanged() { return this._changes.keysChanged || new Set(); }
  get changes() { return this._changes; }
}

class YArrayEvent extends YEvent {
  constructor(target, changes, transaction) {
    super(target, transaction);
    this._delta = changes.delta || [];
    this._changes = changes;
  }

  get delta() { return this._delta; }
  get changes() { return this._changes; }
}

class YXmlElementEvent extends YEvent {
  constructor(target, changes, transaction) {
    super(target, transaction);
    this._changes = changes || {};
  }

  get changes() { return this._changes; }
}

class AbstractType {
  constructor() {
    this._crdt = null;
    this._name = '';
    this._parent = null;
    this._observers = new Map();
    this._deepObservers = new Map();
  }

  get parent() { return this._parent; }

  observe(handler) {
    if (!this._observers.has('default')) this._observers.set('default', []);
    this._observers.get('default').push(handler);
    return () => this.unobserve(handler);
  }

  unobserve(handler) {
    const handlers = this._observers.get('default');
    if (handlers) {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
    }
  }

  observeDeep(handler) {
    if (!this._deepObservers.has('default')) this._deepObservers.set('default', []);
    this._deepObservers.get('default').push(handler);
    return () => this.unobserveDeep(handler);
  }

  unobserveDeep(handler) {
    const handlers = this._deepObservers.get('default');
    if (handlers) {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
    }
  }

  _emit(event) {
    const handlers = this._observers.get('default');
    if (handlers) {
      for (const h of handlers) h(event, this);
    }
  }

  _emitDeep(event, path) {
    const handlers = this._deepObservers.get('default');
    if (handlers) {
      for (const h of handlers) h([event], this);
    }
    if (this._parent && this._parent._emitDeep) {
      this._parent._emitDeep(event, path);
    }
  }

  toJSON() { return null; }
  toString() { return ''; }
  toArray() { return []; }
  get length() { return 0; }
}

module.exports = { YEvent, YTextEvent, YMapEvent, YArrayEvent, YXmlElementEvent, AbstractType };
