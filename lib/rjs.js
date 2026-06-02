const { CRDT, Transaction, TextCRDT, MapCRDT, ArrayCRDT, CounterCRDT, SubdocManager,
  YXmlFragment, YXmlElement, YXmlText, YXmlHook,
  YEvent, YTextEvent, YMapEvent, YArrayEvent, YXmlElementEvent } = require('../src/core/crdt');
const { ID, IDGenerator } = require('../src/core/id');
const { SharedArena, StringArena, MemoryPool } = require('../src/memory/arena');
const { GarbageCollector } = require('../src/memory/gc');
const { Serializer } = require('../src/serialization/serializer');
const { YjsEncoder } = require('../src/serialization/serializer_yjs');
const { SerializerV2 } = require('../src/serialization/serializer_v2');
const { Encoder, Decoder } = require('../src/serialization/encoder');
const Compressor = require('../src/serialization/compression');
const { NetworkManager } = require('../src/net/index');
const { PerformanceOptimizer } = require('../src/perf/index');
const { StorageProvider, MemoryStorage, IndexedDBStorage, AutoPersist } = require('../src/storage/index');
const { UndoManager } = require('../src/core/undo');
const { RelativePosition } = require('../src/core/relative_position');
const { Snapshot, mergeUpdates, diffUpdate } = require('../src/core/snapshot');
const { importBlocks } = require('../src/core/helpers');

class Rjs {
  constructor(options = {}) {
    this.clientId = options.clientId || Rjs._generateId();
    this.arena = new SharedArena();
    this.crdt = new CRDT(this.clientId, this.arena);
    this.gc = new GarbageCollector({
      tombstoneThreshold: options.tombstoneThreshold || 1000,
      gcInterval: options.gcInterval || 5000,
      ageThreshold: options.ageThreshold || 30000
    });

    this.serializer = new YjsEncoder();
    this.compressor = new Compressor(options.compression || {});
    this.network = null;
    this.perf = null;
    this.storage = null;
    this.autoPersist = null;
    this.undoManager = null;
    this._options = options;
  }

  static _generateId() {
    return Math.floor(Math.random() * 0xFFFFFFFF) + 1;
  }

  getText(name) { return this.crdt.getText(name); }
  getMap(name) { return this.crdt.getMap(name); }
  getArray(name) { return this.crdt.getArray(name); }
  getCounter(name) { return this.crdt.getCounter(name); }
  getXmlFragment(name) { return this.crdt.getXmlFragment(name); }
  getXmlElement(name) { return this.crdt.getXmlElement(name); }
  getXmlText(name) { return this.crdt.getXmlText(name); }
  getXmlHook(name) { return this.crdt.getXmlHook(name); }
  getSubdoc(name) { return this.crdt.getSubdoc(name); }
  removeSubdoc(name) { return this.crdt.removeSubdoc(name); }
  transact(fn) { return this.crdt.transact(fn); }
  observe(type, handler) { return this.crdt.observe(type, handler); }

  enableUndoManager(options = {}) {
    this.undoManager = new UndoManager(this.crdt, options);
    return this.undoManager;
  }

  applyOperation(docId, operation) {
    if (operation.type === 'insert') {
      this.crdt.transact((txn) => txn.textInsert(docId, operation.pos, operation.text));
    } else if (operation.type === 'delete') {
      this.crdt.transact((txn) => txn.textDelete(docId, operation.pos, operation.len));
    }
    return this.crdt.getText(docId);
  }

  createDocument(docId) {
    return this.getText(docId);
  }

  getDocument(docId) {
    return this.crdt.texts.get(docId) || null;
  }

  encodeStateAsUpdate(docId) {
    const text = this.crdt.texts.get(docId);
    if (!text) return null;
    const tempDoc = new CRDT(this.clientId);
    const tempText = tempDoc.getText(docId);
    importBlocks(text.rga, tempText.rga);
    return this.serializer.encodeDocument(tempDoc);
  }

  applyRemoteOps(ops) {
    this.crdt.applyRemoteOps(ops);
  }

  applyUpdate(update) {
    const tempCrdt = new CRDT(this.clientId + 1000000);
    this.serializer.decodeDocument(update, tempCrdt);

    for (const [name, text] of tempCrdt.texts) {
      importBlocks(text.rga, this.getText(name).rga);
    }
    for (const [name, map] of tempCrdt.maps) {
      const localMap = this.getMap(name);
      for (const [key, value] of map._vals) localMap._set(key, value);
    }
    for (const [name, arr] of tempCrdt.arrays) {
      const localArr = this.getArray(name);
      for (const item of arr.items) localArr.push(item);
    }
    for (const [name, counter] of tempCrdt.counters) {
      this.getCounter(name).value += counter.value;
    }
    for (const [name, frag] of tempCrdt.xmlFragments) {
      const localFrag = this.getXmlFragment(name);
      for (const child of frag._children) localFrag._children.push(child);
    }
    for (const [name, elem] of tempCrdt.xmlElements) {
      const localElem = this.getXmlElement(name);
      for (const child of elem._children) localElem._children.push(child);
    }
    for (const [name, xmlText] of tempCrdt.xmlTexts) {
      const localXmlText = this.getXmlText(name);
      localXmlText._text = xmlText._text;
    }
  }

  decodeUpdate(buffer) {
    const tempCrdt = new CRDT(this.clientId + 1000001);
    this.serializer.decodeDocument(buffer, tempCrdt);
    return tempCrdt;
  }

  encodeStateAsUpdateV2(docId) {
    const text = this.crdt.texts.get(docId);
    if (!text) return null;
    const tempDoc = new CRDT(this.clientId);
    const tempText = tempDoc.getText(docId);
    importBlocks(text.rga, tempText.rga);
    const v2Serializer = new SerializerV2();
    return v2Serializer.encodeDocument(tempDoc);
  }

  applyUpdateV2(update) {
    const v2Serializer = new SerializerV2();
    const tempCrdt = new CRDT(this.clientId + 1000002);
    v2Serializer.decodeDocument(update, tempCrdt);

    for (const [name, text] of tempCrdt.texts) {
      importBlocks(text.rga, this.getText(name).rga);
    }
    for (const [name, map] of tempCrdt.maps) {
      const localMap = this.getMap(name);
      for (const [key, value] of map._vals) localMap._set(key, value);
    }
    for (const [name, arr] of tempCrdt.arrays) {
      const localArr = this.getArray(name);
      for (const item of arr.items) localArr.push(item);
    }
    for (const [name, counter] of tempCrdt.counters) {
      this.getCounter(name).value += counter.value;
    }
  }

  static decodeUpdate(buffer) {
    const tempCrdt = new CRDT(0);
    const ser = new YjsEncoder();
    ser.decodeDocument(buffer, tempCrdt);
    return tempCrdt;
  }

  static decodeUpdateV2(buffer) {
    const tempCrdt = new CRDT(0);
    const v2Serializer = new SerializerV2();
    v2Serializer.decodeDocument(buffer, tempCrdt);
    return tempCrdt;
  }

  static convertUpdateV1ToV2(buffer) {
    const tempCrdt = new CRDT(0);
    const ser = new YjsEncoder();
    ser.decodeDocument(buffer, tempCrdt);
    const v2Serializer = new SerializerV2();
    return v2Serializer.encodeDocument(tempCrdt);
  }

  static convertUpdateV2ToV1(buffer) {
    const tempCrdt = new CRDT(0);
    const v2Serializer = new SerializerV2();
    v2Serializer.decodeDocument(buffer, tempCrdt);
    const ser = new YjsEncoder();
    return ser.encodeDocument(tempCrdt);
  }

  static mergeUpdatesV2(updates) {
    if (!updates || updates.length === 0) return null;
    if (updates.length === 1) return updates[0];

    const v1Updates = updates.map(u => Rjs.convertUpdateV2ToV1(u));
    const merged = mergeUpdates(v1Updates);
    if (!merged) return null;

    return Rjs.convertUpdateV1ToV2(merged);
  }

  static diffUpdateV2(update, stateVector) {
    const v1Update = Rjs.convertUpdateV2ToV1(update);
    return diffUpdate(v1Update, stateVector);
  }

  static encodeStateVectorFromUpdate(update) {
    const tempCrdt = new CRDT(0);
    const ser = new YjsEncoder();
    ser.decodeDocument(update, tempCrdt);
    return Snapshot.encodeStateVector(tempCrdt.getStateVector());
  }

  static encodeStateVectorFromUpdateV2(update) {
    const tempCrdt = new CRDT(0);
    const v2Serializer = new SerializerV2();
    v2Serializer.decodeDocument(update, tempCrdt);
    return Snapshot.encodeStateVector(tempCrdt.getStateVector());
  }

  get gc() { return this.crdt.gc; }
  set gc(v) { this.crdt.gc = v; }

  toJSON() { return this.crdt.toJSON(); }

  get(type, name) { return this.crdt.get(type, name); }

  on(event, handler) { return this.crdt.on(event, handler); }
  off(event, handler) { this.crdt.off(event, handler); }

  static obfuscateUpdate(update, options = {}) {
    const tempCrdt = new CRDT(0);
    const ser = new YjsEncoder();
    ser.decodeDocument(update, tempCrdt);

    if (options.removeKeys) {
      for (const [name, map] of tempCrdt.maps) {
        for (const key of options.removeKeys) {
          map._vals.delete(key);
          map._versions.delete(key);
        }
      }
    }

    if (options.removeValues) {
      for (const [name, map] of tempCrdt.maps) {
        for (const [key, value] of map._vals) {
          if (options.removeValues.includes(value)) {
            map._vals.delete(key);
            map._versions.delete(key);
          }
        }
      }
    }

    return ser.encodeDocument(tempCrdt);
  }

  snapshotQuery(type, name) {
    switch (type) {
      case 'text': {
        const text = this.crdt.texts.get(name);
        return text ? text.toString() : null;
      }
      case 'map': {
        const map = this.crdt.maps.get(name);
        return map ? map.toJSON() : null;
      }
      case 'array': {
        const arr = this.crdt.arrays.get(name);
        return arr ? arr.toArray() : null;
      }
      case 'counter': {
        const counter = this.crdt.counters.get(name);
        return counter ? counter.get() : null;
      }
      default:
        return null;
    }
  }

  typeListToArray(typeName) {
    const arr = this.crdt.arrays.get(typeName);
    return arr ? arr.toArray() : [];
  }

  typeMapGetAll(typeName) {
    const map = this.crdt.maps.get(typeName);
    return map ? map.toJSON() : {};
  }

  typeMapGetSnapshot(typeName, key) {
    const map = this.crdt.maps.get(typeName);
    if (!map) return undefined;
    return map.get(key);
  }

  typeListToArraySnapshot(typeName, snapshot) {
    if (!snapshot) return this.typeListToArray(typeName);
    const arr = this.crdt.arrays.get(typeName);
    if (!arr) return [];
    return arr.toArray();
  }

  typeMapGetAllSnapshot(typeName, snapshot) {
    if (!snapshot) return this.typeMapGetAll(typeName);
    const map = this.crdt.maps.get(typeName);
    if (!map) return {};
    return map.toJSON();
  }

  getStats() {
    return {
      crdt: this.crdt.getStats(),
      gc: this.gc.getStats(),
      arena: this.arena.getStats(),
      perf: this.perf ? this.perf.getStats() : null,
      networkConnected: this.network ? this.network.isConnected() : false
    };
  }

  runGC() { return this.gc.collect(this.crdt); }
  compress(data) { return this.compressor.compress(data); }

  enableNetwork(options = {}) {
    this.network = new NetworkManager(this.crdt, options);
    return this.network;
  }

  enablePerformanceOptimizer(options = {}) {
    this.perf = new PerformanceOptimizer(this.crdt, { ...this._options, ...options });
    return this.perf;
  }

  enableStorage(options = {}) {
    this.storage = new MemoryStorage(options);
    this.autoPersist = new AutoPersist(this.crdt, this.storage, {
      ...options,
      docKey: options.docKey || `rjs-doc-${this.clientId}`
    });
    return this.storage;
  }

  async enableIndexedDB(options = {}) {
    this.storage = new IndexedDBStorage(options);
    this.autoPersist = new AutoPersist(this.crdt, this.storage, {
      ...options,
      docKey: options.docKey || `rjs-doc-${this.clientId}`
    });
    await this.storage.init();
    return this.storage;
  }

  async save() {
    if (this.autoPersist) return this.autoPersist.persist();
    if (this.storage) {
      const buf = this.serializer.encodeDocument(this.crdt);
      return this.storage.save(`rjs-doc-${this.clientId}`, buf);
    }
    return false;
  }

  async load() {
    if (this.autoPersist) return this.autoPersist.load();
    if (this.storage) {
      const buf = await this.storage.load(`rjs-doc-${this.clientId}`);
      if (buf) {
        this.serializer.decodeDocument(buf, this.crdt);
        return true;
      }
    }
    return false;
  }

  saveToFile(filePath) {
    const fs = require('fs');
    const buf = this.serializer.encodeDocument(this.crdt);
    fs.writeFileSync(filePath, Buffer.from(buf));
  }

  loadFromFile(filePath) {
    const fs = require('fs');
    const buf = fs.readFileSync(filePath);
    this.serializer.decodeDocument(new Uint8Array(buf), this.crdt);
  }

  destroy() {
    if (this.undoManager) this.undoManager.destroy();
    if (this.network) this.network.disconnect();
    if (this.perf) this.perf.destroy();
    if (this.autoPersist) this.autoPersist.destroy();
    this.gc = null;
  }
}

Rjs.ID = ID;
Rjs.IDGenerator = IDGenerator;
Rjs.CRDT = CRDT;
Rjs.Transaction = Transaction;
Rjs.TextCRDT = TextCRDT;
Rjs.MapCRDT = MapCRDT;
Rjs.ArrayCRDT = ArrayCRDT;
Rjs.CounterCRDT = CounterCRDT;
Rjs.SharedArena = SharedArena;
Rjs.StringArena = StringArena;
Rjs.MemoryPool = MemoryPool;
Rjs.GarbageCollector = GarbageCollector;
Rjs.Serializer = Serializer;
Rjs.SerializerV2 = SerializerV2;
Rjs.YjsEncoder = YjsEncoder;
Rjs.Encoder = Encoder;
Rjs.Decoder = Decoder;
Rjs.Compressor = Compressor;
Rjs.NetworkManager = NetworkManager;
Rjs.PerformanceOptimizer = PerformanceOptimizer;
Rjs.StorageProvider = StorageProvider;
Rjs.MemoryStorage = MemoryStorage;
Rjs.IndexedDBStorage = IndexedDBStorage;
Rjs.AutoPersist = AutoPersist;
Rjs.UndoManager = UndoManager;
Rjs.RelativePosition = RelativePosition;
Rjs.Snapshot = Snapshot;
Rjs.SubdocManager = SubdocManager;
Rjs.mergeUpdates = mergeUpdates;
Rjs.diffUpdate = diffUpdate;
Rjs.YXmlFragment = YXmlFragment;
Rjs.YXmlElement = YXmlElement;
Rjs.YXmlText = YXmlText;
Rjs.YXmlHook = YXmlHook;
Rjs.YEvent = YEvent;
Rjs.YTextEvent = YTextEvent;
Rjs.YMapEvent = YMapEvent;
Rjs.YArrayEvent = YArrayEvent;
Rjs.YXmlElementEvent = YXmlElementEvent;

module.exports = Rjs;
