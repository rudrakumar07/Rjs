const { ID } = require('./id');
const { Encoder, Decoder } = require('../serialization/encoder');
const { CRDT } = require('./crdt');
const { Serializer } = require('../serialization/serializer');
const { YjsEncoder } = require('../serialization/serializer_yjs');

class Snapshot {
  constructor(stateVector, deleteSet) {
    this.stateVector = stateVector || new Map();
    this.deleteSet = deleteSet || new Map();
  }

  static empty() { return new Snapshot(new Map(), new Map()); }

  clone() {
    const sv = new Map(this.stateVector);
    const ds = new Map();
    for (const [k, v] of this.deleteSet) ds.set(k, new Set(v));
    return new Snapshot(sv, ds);
  }

  toJSON() {
    const sv = {};
    for (const [client, clock] of this.stateVector) sv[client] = clock;
    const ds = {};
    for (const [client, clocks] of this.deleteSet) ds[client] = Array.from(clocks);
    return { stateVector: sv, deleteSet: ds };
  }

  static fromJSON(j) {
    const sv = new Map();
    for (const [client, clock] of Object.entries(j.stateVector || {})) {
      sv.set(parseInt(client), clock);
    }
    const ds = new Map();
    for (const [client, clocks] of Object.entries(j.deleteSet || {})) {
      ds.set(parseInt(client), new Set(clocks));
    }
    return new Snapshot(sv, ds);
  }

  static encode(snapshot) {
    const enc = new Encoder();
    enc.writeVarint(snapshot.stateVector.size);
    for (const [client, clock] of snapshot.stateVector) {
      enc.writeVarint(client);
      enc.writeVarint(clock);
    }
    enc.writeVarint(snapshot.deleteSet.size);
    for (const [client, clocks] of snapshot.deleteSet) {
      enc.writeVarint(client);
      enc.writeVarint(clocks.size);
      let prev = 0;
      for (const clock of Array.from(clocks).sort((a, b) => a - b)) {
        enc.writeVarint(clock - prev);
        prev = clock;
      }
    }
    return enc.toBuffer();
  }

  static decode(buffer) {
    const dec = new Decoder(buffer);
    const sv = new Map();
    const svSize = dec.readVarint();
    for (let i = 0; i < svSize; i++) {
      sv.set(dec.readVarint(), dec.readVarint());
    }
    const ds = new Map();
    const dsSize = dec.readVarint();
    for (let i = 0; i < dsSize; i++) {
      const client = dec.readVarint();
      const count = dec.readVarint();
      const clocks = new Set();
      let prev = 0;
      for (let j = 0; j < count; j++) {
        prev += dec.readVarint();
        clocks.add(prev);
      }
      ds.set(client, clocks);
    }
    return new Snapshot(sv, ds);
  }

  static encodeStateVector(sv) {
    const enc = new Encoder();
    enc.writeVarint(sv.length);
    for (const entry of sv) {
      enc.writeVarint(entry.client);
      enc.writeVarint(entry.clock);
    }
    return enc.toBuffer();
  }

  static decodeStateVector(buffer) {
    const dec = new Decoder(buffer);
    const count = dec.readVarint();
    const sv = [];
    for (let i = 0; i < count; i++) {
      sv.push({ client: dec.readVarint(), clock: dec.readVarint() });
    }
    return sv;
  }

  static createFromDocument(crdt) {
    const sv = new Map();
    const ds = new Map();
    for (const [, text] of crdt.texts) {
      let cur = text.rga.head;
      while (cur) {
        const client = ID.client(cur.id);
        const clock = ID.clock(cur.id);
        if (clock + 1 > (sv.get(client) || 0)) sv.set(client, clock + 1);
        if (cur.isDeleted) {
          if (!ds.has(client)) ds.set(client, new Set());
          ds.get(client).add(clock);
        }
        cur = cur.next;
      }
    }
    return new Snapshot(sv, ds);
  }

  static createDocFromSnapshot(snapshot, clientId) {
    const crdt = new CRDT(clientId);
    for (const [client, clock] of snapshot.stateVector) {
      crdt.stateVector.set(client, clock);
    }
    return crdt;
  }

  containsUpdate(update) {
    for (const op of update) {
      if (op.type === 'text-insert' || op.type === 'text-delete') {
        const maxClock = this.stateVector.get(op.client || 0) || 0;
        if ((op.clock || 0) > maxClock) return false;
      }
    }
    return true;
  }

  static equal(a, b) {
    if (a.stateVector.size !== b.stateVector.size) return false;
    for (const [client, clock] of a.stateVector) {
      if (b.stateVector.get(client) !== clock) return false;
    }
    if (a.deleteSet.size !== b.deleteSet.size) return false;
    for (const [client, clocks] of a.deleteSet) {
      const bClocks = b.deleteSet.get(client);
      if (!bClocks || clocks.size !== bClocks.size) return false;
      for (const c of clocks) {
        if (!bClocks.has(c)) return false;
      }
    }
    return true;
  }
}

function mergeUpdates(updates) {
  if (!updates || updates.length === 0) return null;
  if (updates.length === 1) return updates[0];

  const mergedBlockIds = new Set();
  const mergedBlocks = [];
  const mergedMaps = new Map();
  const mergedCounters = new Map();
  const ser = new YjsEncoder();

  for (const update of updates) {
    const tempCrdt = new CRDT(0);
    ser.decodeDocument(update, tempCrdt);

    for (const [, text] of tempCrdt.texts) {
      let cur = text.rga.head;
      while (cur) {
        if (!mergedBlockIds.has(cur.id)) {
          mergedBlockIds.add(cur.id);
          mergedBlocks.push({ text: text.name, block: cur });
        }
        cur = cur.next;
      }
    }
    for (const [name, map] of tempCrdt.maps) {
      if (!mergedMaps.has(name)) mergedMaps.set(name, new Map());
      for (const [key, value] of map._vals) mergedMaps.get(name).set(key, value);
    }
    for (const [name, counter] of tempCrdt.counters) {
      mergedCounters.set(name, (mergedCounters.get(name) || 0) + counter.value);
    }
  }

  const outCrdt = new CRDT(0);
  const texts = new Map();
  for (const { text: name, block } of mergedBlocks) {
    if (!texts.has(name)) texts.set(name, outCrdt.getText(name));
    const rga = texts.get(name).rga;
    rga.byId.set(block.id, block);
    if (rga.tail) {
      rga.tail.next = block;
      block.prev = rga.tail;
      rga.tail = block;
    } else {
      rga.head = block;
      rga.tail = block;
    }
    if (!block.isDeleted) rga._visibleLen += block.len;
  }
  for (const [, t] of texts) t.rga.invalidateCache();

  for (const [name, entries] of mergedMaps) {
    for (const [key, value] of entries) outCrdt.getMap(name)._set(key, value);
  }
  for (const [name, counter] of mergedCounters) {
    outCrdt.getCounter(name).value = counter;
  }

  return ser.encodeDocument(outCrdt);
}

function diffUpdate(update, stateVector) {
  const tempCrdt = new CRDT(0);
  const ser = new YjsEncoder();
  ser.decodeDocument(update, tempCrdt);

  const svMap = new Map(stateVector.map(s => [s.client, s.clock]));
  const outCrdt = new CRDT(0);
  const texts = new Map();

  for (const [, text] of tempCrdt.texts) {
    let cur = text.rga.head;
    while (cur) {
      const client = ID.client(cur.id);
      const clock = ID.clock(cur.id);
      if (!svMap.has(client) || svMap.get(client) < clock) {
        if (!texts.has(text.name)) texts.set(text.name, outCrdt.getText(text.name));
        const rga = texts.get(text.name).rga;
        rga.byId.set(cur.id, cur);
        if (rga.tail) {
          rga.tail.next = cur;
          cur.prev = rga.tail;
          rga.tail = cur;
        } else {
          rga.head = cur;
          rga.tail = cur;
        }
        if (!cur.isDeleted) rga._visibleLen += cur.len;
      }
      cur = cur.next;
    }
  }
  for (const [, t] of texts) t.rga.invalidateCache();

  return ser.encodeDocument(outCrdt);
}

module.exports = { Snapshot, mergeUpdates, diffUpdate };
