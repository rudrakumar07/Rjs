const { ID, IDGenerator } = require('./id');
const { BlockRGA, RGABlock } = require('./block_rga');
const { SubdocManager, SubdocCRDT } = require('./subdoc');
const { linkBlockToTail, importBlocks } = require('./helpers');
const { YXmlFragment, YXmlElement, YXmlText, YXmlHook } = require('./xml');
const { YEvent, YTextEvent, YMapEvent, YArrayEvent, YXmlElementEvent } = require('./events');

class CRDT {
  constructor(clientId, arena) {
    this.clientId = clientId;
    this.idGen = new IDGenerator(clientId);
    this.arena = arena || null;
    this.texts = new Map();
    this.maps = new Map();
    this.arrays = new Map();
    this.counters = new Map();
    this.xmlFragments = new Map();
    this.xmlElements = new Map();
    this.xmlTexts = new Map();
    this.xmlHooks = new Map();
    this.observers = new Map();
    this.txn = null;
    this.clock = 0;
    this.stateVector = new Map();
    this.subdocManager = new SubdocManager(this);
    this._gcEnabled = true;
  }

  getText(name) {
    if (!this.texts.has(name)) {
      this.texts.set(name, new TextCRDT(this, name));
    }
    return this.texts.get(name);
  }

  getMap(name) {
    if (!this.maps.has(name)) {
      this.maps.set(name, new MapCRDT(this, name));
    }
    return this.maps.get(name);
  }

  getArray(name) {
    if (!this.arrays.has(name)) {
      this.arrays.set(name, new ArrayCRDT(this, name));
    }
    return this.arrays.get(name);
  }

  getCounter(name) {
    if (!this.counters.has(name)) {
      this.counters.set(name, new CounterCRDT(this, name));
    }
    return this.counters.get(name);
  }

  getXmlFragment(name) {
    if (!this.xmlFragments.has(name)) {
      this.xmlFragments.set(name, new YXmlFragment(this, name));
    }
    return this.xmlFragments.get(name);
  }

  getXmlElement(name) {
    if (!this.xmlElements.has(name)) {
      this.xmlElements.set(name, new YXmlElement(this, name));
    }
    return this.xmlElements.get(name);
  }

  getXmlText(name) {
    if (!this.xmlTexts.has(name)) {
      this.xmlTexts.set(name, new YXmlText(this, name));
    }
    return this.xmlTexts.get(name);
  }

  getXmlHook(name) {
    if (!this.xmlHooks.has(name)) {
      this.xmlHooks.set(name, new YXmlHook(this, name));
    }
    return this.xmlHooks.get(name);
  }

  getSubdoc(name) { return this.subdocManager.getSubdoc(name); }
  removeSubdoc(name) { return this.subdocManager.removeSubdoc(name); }
  getSubdocs() { return this.subdocManager; }

  nextId() {
    return this.idGen.next();
  }

  getStateVector() {
    if (this.stateVector.size > 0) {
      return Array.from(this.stateVector, (clock, client) => ({ client, clock }));
    }
    const svMap = new Map();
    for (const [, text] of this.texts) {
      let cur = text.rga.head;
      while (cur) {
        const client = ID.client(cur.id);
        const clock = ID.clock(cur.id);
        const prev = svMap.get(client) || 0;
        if (clock + 1 > prev) svMap.set(client, clock + 1);
        cur = cur.next;
      }
    }
    return Array.from(svMap, (clock, client) => ({ client, clock }));
  }

  updateStateVector(client, clock) {
    const prev = this.stateVector.get(client) || 0;
    if (clock > prev) this.stateVector.set(client, clock);
  }

  transact(fn) {
    if (typeof fn !== 'function') throw new Error('transact requires a function');
    const prevTxn = this.txn;
    const txn = new Transaction(this);
    this.txn = txn;
    this._emit('beforeAllTransactions', this);
    try {
      this._emit('beforeTransaction', [txn]);
      fn(txn);
    } finally {
      this._emit('afterTransaction', [txn]);
      this.txn = prevTxn;
      this._emit('afterAllTransactions', this, [txn]);
    }
    const ops = txn.getOperations();
    if (ops.length > 0) this._emit('update', ops);
    return ops;
  }

  observe(type, handler) {
    if (!this.observers.has(type)) this.observers.set(type, []);
    this.observers.get(type).push(handler);
    return () => {
      const handlers = this.observers.get(type);
      if (handlers) {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      }
    };
  }

  _emit(type, data) {
    const handlers = this.observers.get(type);
    if (handlers) {
      for (const handler of handlers) handler(data);
    }
  }

  _emitTracked(op) {
    this._emit('before-update', [op]);
  }

  _emitUpdate(op) {
    if (!this.txn) this._emit('update', [op]);
  }

  toJSON() {
    const obj = {};
    for (const [name, text] of this.texts) obj[`text:${name}`] = text.toJSON();
    for (const [name, map] of this.maps) obj[`map:${name}`] = map.toJSON();
    for (const [name, arr] of this.arrays) obj[`array:${name}`] = arr.toJSON();
    for (const [name, counter] of this.counters) obj[`counter:${name}`] = counter.value;
    return obj;
  }

  get(type, name) {
    if (type === TextCRDT) return this.getText(name);
    if (type === MapCRDT) return this.getMap(name);
    if (type === ArrayCRDT) return this.getArray(name);
    if (type === CounterCRDT) return this.getCounter(name);
    return undefined;
  }

  get gc() { return this._gcEnabled; }
  set gc(val) { this._gcEnabled = val; }

  on(event, handler) {
    return this.observe(event, handler);
  }

  off(event, handler) {
    const handlers = this.observers.get(event);
    if (handlers) {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
    }
  }

  applyOp(op) {
    switch (op.type) {
      case 'text-insert':
        this.getText(op.name).insert(op.pos, op.content);
        break;
      case 'text-delete':
        this.getText(op.name).delete(op.pos, op.len);
        break;
      case 'map-set':
        this.getMap(op.name)._set(op.key, op.value);
        break;
      case 'map-delete':
        this.getMap(op.name)._delete(op.key);
        break;
      case 'array-insert':
        this.getArray(op.name)._insert(op.pos, op.value);
        break;
      case 'array-delete':
        this.getArray(op.name)._delete(op.pos, op.len);
        break;
      case 'counter-add':
        this.getCounter(op.name)._add(op.value);
        break;
    }
  }

  applyRemoteOps(ops) {
    for (const op of ops) this.applyOp(op);
    this._emit('remote-update', ops);
  }

  getStats() {
    const result = {
      texts: this.texts.size,
      maps: this.maps.size,
      arrays: this.arrays.size,
      counters: this.counters.size
    };
    for (const [name, text] of this.texts) {
      result[`text:${name}`] = text.rga.getStats();
    }
    return result;
  }

  merge(otherCrdt) {
    const ops = [];
    this._mergeTexts(otherCrdt, ops);
    this._mergeMaps(otherCrdt, ops);
    this._emit('update', ops);
    return ops;
  }

  _mergeTexts(otherCrdt, ops) {
    for (const [name, text] of otherCrdt.texts) {
      const localText = this.getText(name);
      let cur = text.rga.head;
      while (cur) {
        if (!localText.rga.findById(cur.id)) {
          const clone = new RGABlock(cur.id, cur.content, cur.originLeft, cur.originRight);
          clone.isDeleted = cur.isDeleted;
          clone.len = cur.len;
          linkBlockToTail(localText.rga, clone);
          localText.rga.byId.set(clone.id, clone);
          if (!clone.isDeleted) localText.rga._visibleLen += clone.len;
          ops.push({ type: 'text-insert', name, pos: 0, content: cur.content });
        }
        cur = cur.next;
      }
      localText.rga.invalidateCache();
    }
  }

  _mergeMaps(otherCrdt, ops) {
    for (const [name, map] of otherCrdt.maps) {
      const localMap = this.getMap(name);
      for (const [key, value] of map._vals) {
        localMap._set(key, value);
        ops.push({ type: 'map-set', name, key, value });
      }
    }
  }
}

class Transaction {
  constructor(crdt) {
    this.crdt = crdt;
    this.operations = [];
  }

  getOperations() { return this.operations; }

  textInsert(name, pos, content) {
    this.crdt.getText(name).insert(pos, content);
    this.operations.push({ type: 'text-insert', name, pos, content });
  }

  textDelete(name, pos, len) {
    this.crdt.getText(name).delete(pos, len);
    this.operations.push({ type: 'text-delete', name, pos, len });
  }

  mapSet(name, key, value) {
    this.crdt.getMap(name)._set(key, value);
    this.operations.push({ type: 'map-set', name, key, value });
  }

  mapDelete(name, key) {
    this.crdt.getMap(name)._delete(key);
    this.operations.push({ type: 'map-delete', name, key });
  }

  arrayInsert(name, pos, value) {
    this.crdt.getArray(name)._insert(pos, value);
    this.operations.push({ type: 'array-insert', name, pos, value });
  }

  arrayDelete(name, pos, len) {
    this.crdt.getArray(name)._delete(pos, len);
    this.operations.push({ type: 'array-delete', name, pos, len });
  }

  counterAdd(name, value) {
    this.crdt.getCounter(name)._add(value);
    this.operations.push({ type: 'counter-add', name, value });
  }
}

class TextCRDT {
  constructor(crdt, name) {
    this.crdt = crdt;
    this.name = name;
    this._parent = null;
    this.rga = new BlockRGA(crdt.clientId);
    this.rga.idGen = crdt.idGen;
    this._observers = [];
    this._deepObservers = [];
    this._formats = new Map();
  }

  insert(pos, content, attrs) {
    const op = { type: 'text-insert', name: this.name, pos, content };
    this.crdt._emitTracked(op);
    const result = this.rga.insertAt(pos, content);
    const delta = [{ retain: pos }, { insert: content }];
    const event = new YTextEvent(this, { delta, oldText: '' }, null);
    this._emit(event);
    this.crdt._emitUpdate(op);
    if (attrs) {
      this.format(pos, content.length, attrs);
    }
    return result;
  }

  delete(pos, len) {
    const op = { type: 'text-delete', name: this.name, pos, len };
    this.crdt._emitTracked(op);
    const result = this.rga.deleteAt(pos, len);
    const delta = [{ retain: pos }, { delete: len }];
    const event = new YTextEvent(this, { delta, oldText: '' }, null);
    this._emit(event);
    this.crdt._emitUpdate(op);
    return result;
  }

  observe(handler) {
    this._observers.push(handler);
    return () => {
      const idx = this._observers.indexOf(handler);
      if (idx >= 0) this._observers.splice(idx, 1);
    };
  }

  unobserve(handler) {
    const idx = this._observers.indexOf(handler);
    if (idx >= 0) this._observers.splice(idx, 1);
  }

  observeDeep(handler) {
    this._deepObservers.push(handler);
    return () => {
      const idx = this._deepObservers.indexOf(handler);
      if (idx >= 0) this._deepObservers.splice(idx, 1);
    };
  }

  unobserveDeep(handler) {
    const idx = this._deepObservers.indexOf(handler);
    if (idx >= 0) this._deepObservers.splice(idx, 1);
  }

  get parent() { return this._parent; }

  _emit(event) {
    if (this._observers.length > 0) {
      for (const h of this._observers) h(event, this);
    }
    if (this._deepObservers.length > 0) {
      for (const h of this._deepObservers) h([event], this);
    }
  }

  contentAt(pos, len) {
    return this.rga.toString().slice(pos, pos + len);
  }

  toString() { return this.rga.toString(); }
  get length() { return this.rga.getVisibleLength(); }
  toArray() { return this.rga.toArray(); }

  toJSON() { return this.toString(); }

  applyDelta(delta) {
    let pos = 0;
    for (const op of delta) {
      if (op.insert) {
        this.insert(pos, op.insert);
        pos += op.insert.length;
      } else if (op.delete) {
        this.delete(pos, op.delete);
      } else if (op.retain) {
        pos += op.retain;
      }
    }
    return this;
  }

  format(pos, len, attrs) {
    const key = `${pos}:${len}`;
    this._formats.set(key, { pos, len, attrs });
    const event = new YTextEvent(this, { format: { pos, len, attrs } }, null);
    this._emit(event);
    return { pos, len, attrs };
  }

  toDelta() {
    const text = this.toString();
    const deltas = [];
    let pos = 0;
    for (const [, fmt] of this._formats) {
      if (fmt.pos > pos) {
        deltas.push({ insert: text.slice(pos, fmt.pos) });
      }
      deltas.push({ insert: text.slice(fmt.pos, fmt.pos + fmt.len), attributes: fmt.attrs });
      pos = fmt.pos + fmt.len;
    }
    if (pos < text.length) {
      deltas.push({ insert: text.slice(pos) });
    }
    if (deltas.length === 0 && text.length > 0) {
      deltas.push({ insert: text });
    }
    return deltas;
  }

  clone() {
    const c = new TextCRDT(this.crdt, this.name);
    const text = this.toString();
    c.rga.insertAt(0, text);
    for (const [key, fmt] of this._formats) {
      c._formats.set(key, { ...fmt });
    }
    return c;
  }
}

class MapCRDT {
  constructor(crdt, name) {
    this.crdt = crdt;
    this.name = name;
    this._parent = null;
    this._vals = new Map();
    this._versions = new Map();
    this._observers = [];
    this._deepObservers = [];
  }

  _set(key, value) {
    const id = this.crdt.nextId();
    const prevVer = this._versions.get(key);
    if (prevVer !== undefined && prevVer > id.clock) return;
    this._vals.set(key, value);
    this._versions.set(key, id.clock);
  }

  _delete(key) {
    this._vals.delete(key);
    this._versions.delete(key);
  }

  set(key, value) {
    const oldVal = this._vals.get(key);
    const had = this._vals.has(key);
    const op = { type: 'map-set', name: this.name, key, value };
    this.crdt._emitTracked(op);
    this._set(key, value);
    const changes = {
      keysChanged: new Set([key]),
      delta: { key, oldValue: had ? oldVal : undefined, newValue: value }
    };
    const event = new YMapEvent(this, changes, null);
    this._emit(event);
    this.crdt._emitUpdate(op);
    return this;
  }

  delete(key) {
    const had = this._vals.has(key);
    const oldVal = this._vals.get(key);
    const op = { type: 'map-delete', name: this.name, key };
    this.crdt._emitTracked(op);
    this._delete(key);
    if (had) {
      const changes = {
        keysChanged: new Set([key]),
        delta: { key, oldValue: oldVal }
      };
      const event = new YMapEvent(this, changes, null);
      this._emit(event);
    }
    this.crdt._emitUpdate(op);
    return this;
  }

  observe(handler) {
    this._observers.push(handler);
    return () => {
      const idx = this._observers.indexOf(handler);
      if (idx >= 0) this._observers.splice(idx, 1);
    };
  }

  unobserve(handler) {
    const idx = this._observers.indexOf(handler);
    if (idx >= 0) this._observers.splice(idx, 1);
  }

  observeDeep(handler) {
    this._deepObservers.push(handler);
    return () => {
      const idx = this._deepObservers.indexOf(handler);
      if (idx >= 0) this._deepObservers.splice(idx, 1);
    };
  }

  unobserveDeep(handler) {
    const idx = this._deepObservers.indexOf(handler);
    if (idx >= 0) this._deepObservers.splice(idx, 1);
  }

  get parent() { return this._parent; }

  _emit(event) {
    if (this._observers.length > 0) {
      for (const h of this._observers) h(event, this);
    }
    if (this._deepObservers.length > 0) {
      for (const h of this._deepObservers) h([event], this);
    }
  }

  get(key) { return this._vals.get(key); }
  has(key) { return this._vals.has(key); }
  keys() { return Array.from(this._vals.keys()); }
  values() { return Array.from(this._vals.values()); }
  entries() { return Array.from(this._vals.entries()); }
  get size() { return this._vals.size; }

  forEach(fn) {
    for (const [key, value] of this._vals) fn(value, key, this);
  }

  toJSON() {
    const obj = {};
    for (const [key, value] of this._vals) obj[key] = value;
    return obj;
  }

  clear() {
    const op = { type: 'map-clear', name: this.name };
    this.crdt._emitTracked(op);
    this._vals.clear();
    this._versions.clear();
    const event = new YMapEvent(this, { keysChanged: new Set(this.keys()), delta: {} }, null);
    this._emit(event);
    this.crdt._emitUpdate(op);
    return this;
  }

  clone() {
    const c = new MapCRDT(this.crdt, this.name);
    for (const [key, value] of this._vals) {
      c._vals.set(key, value);
    }
    for (const [key, ver] of this._versions) {
      c._versions.set(key, ver);
    }
    return c;
  }
}

class ArrayCRDT {
  constructor(crdt, name) {
    this.crdt = crdt;
    this.name = name;
    this._parent = null;
    this.items = [];
    this._observers = [];
    this._deepObservers = [];
  }

  _insert(pos, value) {
    if (pos < 0) pos = 0;
    if (pos > this.items.length) pos = this.items.length;
    this.items.splice(pos, 0, value);
  }

  _delete(pos, len) {
    this.items.splice(pos, len);
  }

  insert(pos, value) {
    const op = { type: 'array-insert', name: this.name, pos, value };
    this.crdt._emitTracked(op);
    this._insert(pos, value);
    const delta = [{ retain: pos }, { insert: Array.isArray(value) ? value : [value] }];
    const event = new YArrayEvent(this, { delta }, null);
    this._emit(event);
    this.crdt._emitUpdate(op);
    return this;
  }

  delete(pos, len) {
    const op = { type: 'array-delete', name: this.name, pos, len };
    this.crdt._emitTracked(op);
    this._delete(pos, len);
    const delta = [{ retain: pos }, { delete: len }];
    const event = new YArrayEvent(this, { delta }, null);
    this._emit(event);
    this.crdt._emitUpdate(op);
    return this;
  }

  observe(handler) {
    this._observers.push(handler);
    return () => {
      const idx = this._observers.indexOf(handler);
      if (idx >= 0) this._observers.splice(idx, 1);
    };
  }

  unobserve(handler) {
    const idx = this._observers.indexOf(handler);
    if (idx >= 0) this._observers.splice(idx, 1);
  }

  observeDeep(handler) {
    this._deepObservers.push(handler);
    return () => {
      const idx = this._deepObservers.indexOf(handler);
      if (idx >= 0) this._deepObservers.splice(idx, 1);
    };
  }

  unobserveDeep(handler) {
    const idx = this._deepObservers.indexOf(handler);
    if (idx >= 0) this._deepObservers.splice(idx, 1);
  }

  get parent() { return this._parent; }

  _emit(event) {
    if (this._observers.length > 0) {
      for (const h of this._observers) h(event, this);
    }
    if (this._deepObservers.length > 0) {
      for (const h of this._deepObservers) h([event], this);
    }
  }

  get(pos) { return this.items[pos]; }

  push(value) {
    const pos = this.items.length;
    const op = { type: 'array-insert', name: this.name, pos, value };
    this.crdt._emitTracked(op);
    this._insert(pos, value);
    const delta = [{ retain: pos }, { insert: [value] }];
    const event = new YArrayEvent(this, { delta }, null);
    this._emit(event);
    this.crdt._emitUpdate(op);
    return this;
  }

  pop() {
    const pos = this.items.length - 1;
    const op = { type: 'array-delete', name: this.name, pos, len: 1 };
    this.crdt._emitTracked(op);
    const val = this.items.pop();
    if (val !== undefined) {
      const delta = [{ retain: pos }, { delete: 1 }];
      const event = new YArrayEvent(this, { delta }, null);
      this._emit(event);
      this.crdt._emitUpdate(op);
    }
    return val;
  }

  unshift(value) {
    const op = { type: 'array-insert', name: this.name, pos: 0, value };
    this.crdt._emitTracked(op);
    this._insert(0, value);
    const delta = [{ insert: [value] }];
    const event = new YArrayEvent(this, { delta }, null);
    this._emit(event);
    this.crdt._emitUpdate(op);
    return this;
  }

  shift() {
    const op = { type: 'array-delete', name: this.name, pos: 0, len: 1 };
    this.crdt._emitTracked(op);
    const val = this.items.shift();
    if (val !== undefined) {
      const delta = [{ delete: 1 }];
      const event = new YArrayEvent(this, { delta }, null);
      this._emit(event);
      this.crdt._emitUpdate(op);
    }
    return val;
  }

  slice(start, end) { return this.items.slice(start, end); }
  splice(start, deleteCount, ...items) {
    const deleted = this.items.splice(start, deleteCount, ...items);
    return deleted;
  }

  indexOf(value) { return this.items.indexOf(value); }
  includes(value) { return this.items.includes(value); }
  find(fn) { return this.items.find(fn); }
  findIndex(fn) { return this.items.findIndex(fn); }

  forEach(fn) {
    for (let i = 0; i < this.items.length; i++) fn(this.items[i], i, this);
  }

  map(fn) { return this.items.map(fn); }
  filter(fn) { return this.items.filter(fn); }
  reduce(fn, acc) { return this.items.reduce(fn, acc); }

  toJSON() { return [...this.items]; }
  get length() { return this.items.length; }
  toArray() { return [...this.items]; }

  clone() {
    const c = new ArrayCRDT(this.crdt, this.name);
    c.items = [...this.items];
    return c;
  }
}

class CounterCRDT {
  constructor(crdt, name) {
    this.crdt = crdt;
    this.name = name;
    this._parent = null;
    this.value = 0;
  }

  get parent() { return this._parent; }

  _add(value) { this.value += value; }

  add(value) {
    const op = { type: 'counter-add', name: this.name, value };
    this.crdt._emitTracked(op);
    this._add(value);
    this.crdt._emitUpdate(op);
    return this;
  }

  get() { return this.value; }

  increment() { return this.add(1); }
  decrement() { return this.add(-1); }

  clone() {
    const c = new CounterCRDT(this.crdt, this.name);
    c.value = this.value;
    return c;
  }
}

module.exports = {
  CRDT, Transaction, TextCRDT, MapCRDT, ArrayCRDT, CounterCRDT,
  SubdocManager, SubdocCRDT,
  YXmlFragment, YXmlElement, YXmlText, YXmlHook,
  YEvent, YTextEvent, YMapEvent, YArrayEvent, YXmlElementEvent
};
