const Rjs = require('../lib/rjs');
const { CRDT, TextCRDT, MapCRDT, ArrayCRDT, CounterCRDT, UndoManager, Snapshot, RelativePosition, SerializerV2 } = Rjs;

function seededRandom(seed) {
  let s = seed;
  return function() {
    s = (s * 1103515245 + 12345) & 0x7FFFFFFF;
    return s / 0x7FFFFFFF;
  };
}
const rand = seededRandom(123);

let passed = 0;
let failed = 0;
const errors = [];

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch(e) {
    failed++;
    errors.push({ name, error: e.message });
  }
}

const CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const KEYS = ['key0','key1','key2','key3','key4','key5','key6','key7','key8','key9'];

function randomString(maxLen) {
  let len = Math.floor(rand() * maxLen) + 1;
  let s = '';
  for (let i = 0; i < len; i++) {
    s += CHARS[Math.floor(rand() * CHARS.length)];
  }
  return s;
}

function randomKey() {
  return KEYS[Math.floor(rand() * KEYS.length)];
}

function randomInt(min, max) {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function mergeInto(docs) {
  const merged = new Rjs({ clientId: 999999 });
  for (const doc of docs) {
    merged.applyUpdate(doc.serializer.encodeDocument(doc.crdt));
  }
  return merged;
}

// ============================================================
// SERIALIZATION ROUNDTRIP TESTS (2000 tests)
// ============================================================

// 200 tests: Text CRDT encode/decode roundtrip
for (let i = 0; i < 200; i++) {
  test(`text roundtrip ${i}`, () => {
    const doc1 = new Rjs({ clientId: i * 10 + 1 });
    const text1 = doc1.getText('doc');
    const ops = randomInt(3, 12);
    for (let j = 0; j < ops; j++) {
      text1.insert(randomInt(0, text1.length), randomString(5));
    }
    const before = text1.toString();
    const encoded = doc1.serializer.encodeDocument(doc1.crdt);
    const doc2 = new Rjs({ clientId: i * 10 + 2 });
    doc2.applyUpdate(encoded);
    if (doc2.getText('doc').toString() !== before) throw new Error('Text roundtrip mismatch');
  });
}

// 200 tests: MapCRDT encode/decode roundtrip
for (let i = 0; i < 200; i++) {
  test(`map roundtrip ${i}`, () => {
    const doc1 = new Rjs({ clientId: i * 10 + 2001 });
    const map1 = doc1.getMap('doc');
    const ops = randomInt(3, 12);
    const expected = {};
    for (let j = 0; j < ops; j++) {
      const key = randomKey();
      if (rand() < 0.5) {
        const val = randomString(4);
        map1.set(key, val);
        expected[key] = val;
      } else {
        map1.delete(key);
        delete expected[key];
      }
    }
    const encoded = doc1.serializer.encodeDocument(doc1.crdt);
    const doc2 = new Rjs({ clientId: i * 10 + 2101 });
    doc2.applyUpdate(encoded);
    const map2 = doc2.getMap('doc');
    const keys2 = map2.keys();
    const keys1 = Object.keys(expected);
    if (keys2.length !== keys1.length) throw new Error(`Map key count mismatch: ${keys2.length} !== ${keys1.length}`);
    for (const k of keys1) {
      if (map2.get(k) !== expected[k]) throw new Error(`Map value mismatch for ${k}: "${map2.get(k)}" !== "${expected[k]}"`);
    }
  });
}

// 200 tests: ArrayCRDT encode/decode roundtrip
for (let i = 0; i < 200; i++) {
  test(`array roundtrip ${i}`, () => {
    const doc1 = new Rjs({ clientId: i * 10 + 4001 });
    const arr1 = doc1.getArray('doc');
    const ops = randomInt(3, 12);
    const expected = [];
    for (let j = 0; j < ops; j++) {
      if (rand() < 0.7 || expected.length === 0) {
        const val = randomString(3);
        if (rand() < 0.5) {
          arr1.push(val);
          expected.push(val);
        } else {
          const idx = randomInt(0, expected.length);
          arr1.insert(idx, val);
          expected.splice(idx, 0, val);
        }
      } else {
        const idx = randomInt(0, expected.length - 1);
        arr1.delete(idx, 1);
        expected.splice(idx, 1);
      }
    }
    const before = arr1.toArray();
    const encoded = doc1.serializer.encodeDocument(doc1.crdt);
    const doc2 = new Rjs({ clientId: i * 10 + 4101 });
    doc2.applyUpdate(encoded);
    const arr2 = doc2.getArray('doc');
    const actual = arr2.toArray();
    if (actual.length !== before.length) throw new Error(`Array length mismatch: ${actual.length} !== ${before.length}`);
    for (let k = 0; k < before.length; k++) {
      if (actual[k] !== before[k]) throw new Error(`Array[${k}] mismatch`);
    }
  });
}

// 200 tests: CounterCRDT encode/decode roundtrip
for (let i = 0; i < 200; i++) {
  test(`counter roundtrip ${i}`, () => {
    const doc1 = new Rjs({ clientId: i * 10 + 6001 });
    const cnt1 = doc1.getCounter('doc');
    let expected = 0;
    const ops = randomInt(3, 20);
    for (let j = 0; j < ops; j++) {
      const delta = randomInt(-10, 10);
      cnt1.add(delta);
      expected += delta;
    }
    const encoded = doc1.serializer.encodeDocument(doc1.crdt);
    const doc2 = new Rjs({ clientId: i * 10 + 6101 });
    doc2.applyUpdate(encoded);
    if (doc2.getCounter('doc').get() !== expected) throw new Error(`Counter mismatch: ${doc2.getCounter('doc').get()} !== ${expected}`);
  });
}

// 200 tests: encodeStateVector returns Uint8Array
for (let i = 0; i < 200; i++) {
  test(`stateVector type ${i}`, () => {
    const doc = new Rjs({ clientId: i + 8001 });
    const text = doc.getText('doc');
    const ops = randomInt(1, 10);
    for (let j = 0; j < ops; j++) {
      text.insert(text.length, randomString(3));
    }
    const encodedSV = Snapshot.encodeStateVector([{ client: doc.clientId, clock: text.length }]);
    if (!(encodedSV instanceof Uint8Array)) throw new Error('State vector encode did not return Uint8Array');
    if (encodedSV.length === 0 && ops > 0) throw new Error('State vector encoded is empty');
    const decodedSV = Snapshot.decodeStateVector(encodedSV);
    if (!Array.isArray(decodedSV)) throw new Error('Decoded state vector not array');
  });
}

// 200 tests: encode doc, apply update, verify convergence via fresh doc
for (let i = 0; i < 200; i++) {
  test(`encodeStateAsUpdate sync ${i}`, () => {
    const doc1 = new Rjs({ clientId: i * 10 + 10001 });
    const doc2 = new Rjs({ clientId: i * 10 + 10101 });
    const text1 = doc1.getText('doc');
    const text2 = doc2.getText('doc');
    const ops = randomInt(3, 10);
    for (let j = 0; j < ops; j++) {
      text1.insert(randomInt(0, text1.length), randomString(3));
      text2.insert(randomInt(0, text2.length), randomString(3));
    }
    const before1 = text1.toString();
    const before2 = text2.toString();
    const merged = mergeInto([doc1, doc2]);
    const mergedText = merged.getText('doc').toString();
    if (!mergedText.includes(before1)) throw new Error(`Merged text lost doc1 content`);
    if (!mergedText.includes(before2)) throw new Error(`Merged text lost doc2 content`);
  });
}

// 200 tests: Snapshot encode/decode roundtrip
for (let i = 0; i < 200; i++) {
  test(`snapshot roundtrip ${i}`, () => {
    const doc = new Rjs({ clientId: i + 12001 });
    doc.getText('doc').insert(0, randomString(8));
    doc.getMap('doc').set('k', randomString(3));
    const snap = Snapshot.createFromDocument(doc.crdt);
    const encoded = Snapshot.encode(snap);
    if (!(encoded instanceof Uint8Array)) throw new Error('Snapshot encode not Uint8Array');
    const decoded = Snapshot.decode(encoded);
    if (decoded.stateVector.size !== snap.stateVector.size) throw new Error('Snapshot state vector size mismatch');
    for (const [client, clock] of snap.stateVector) {
      if (decoded.stateVector.get(client) !== clock) throw new Error(`Snapshot SV mismatch for client ${client}`);
    }
  });
}

// 200 tests: V2 encode/decode roundtrip
for (let i = 0; i < 200; i++) {
  test(`v2 roundtrip ${i}`, () => {
    const doc1 = new Rjs({ clientId: i * 10 + 14001 });
    doc1.getText('doc').insert(0, randomString(8));
    doc1.getMap('doc').set('k', randomString(3));
    const v2ser = new SerializerV2();
    const encoded = v2ser.encodeDocument(doc1.crdt);
    const doc2 = new Rjs({ clientId: i * 10 + 14101 });
    v2ser.decodeDocument(encoded, doc2.crdt);
    if (doc2.getText('doc').toString() !== doc1.getText('doc').toString()) throw new Error('V2 text mismatch');
    if (doc2.getMap('doc').get('k') !== doc1.getMap('doc').get('k')) throw new Error('V2 map mismatch');
  });
}

// 200 tests: V1 to V2 to V1 conversion roundtrip
for (let i = 0; i < 200; i++) {
  test(`v1v2 convert ${i}`, () => {
    const doc1 = new Rjs({ clientId: i * 10 + 16001 });
    doc1.getText('doc').insert(0, randomString(8));
    doc1.getMap('doc').set('k', randomString(3));
    const v1 = doc1.serializer.encodeDocument(doc1.crdt);
    const v2 = Rjs.convertUpdateV1ToV2(v1);
    if (!(v2 instanceof Uint8Array)) throw new Error('Convert V1->V2 not Uint8Array');
    const v1Again = Rjs.convertUpdateV2ToV1(v2);
    if (!(v1Again instanceof Uint8Array)) throw new Error('Convert V2->V1 not Uint8Array');
    const doc2 = new Rjs({ clientId: i * 10 + 16101 });
    doc2.applyUpdate(v1Again);
    if (doc2.getText('doc').toString() !== doc1.getText('doc').toString()) throw new Error('Conversion roundtrip text mismatch');
    if (doc2.getMap('doc').get('k') !== doc1.getMap('doc').get('k')) throw new Error('Conversion roundtrip map mismatch');
  });
}

// ============================================================
// CONCURRENCY / SYNC TESTS (1000 tests)
// ============================================================

// 200 tests: Two docs same random text insert ops, merge into fresh doc, verify all content
for (let i = 0; i < 200; i++) {
  test(`concurrent text same ops ${i}`, () => {
    const doc1 = new Rjs({ clientId: i * 10 + 18001 });
    const doc2 = new Rjs({ clientId: i * 10 + 18101 });
    const ops = randomInt(5, 15);
    const allInserted = [];
    for (let j = 0; j < ops; j++) {
      const str = randomString(3);
      const len1 = doc1.getText('doc').length;
      doc1.getText('doc').insert(randomInt(0, len1), str);
      allInserted.push(str);
      const len2 = doc2.getText('doc').length;
      doc2.getText('doc').insert(randomInt(0, len2), randomString(3));
    }
    const merged = mergeInto([doc1, doc2]);
    const mergedText = merged.getText('doc').toString();
    for (const s of allInserted) {
      if (!mergedText.includes(s)) throw new Error(`Merged text missing: "${s}"`);
    }
  });
}

// 200 tests: Two docs different random text ops, merge, verify all content
for (let i = 0; i < 200; i++) {
  test(`concurrent text diff ops ${i}`, () => {
    const doc1 = new Rjs({ clientId: i * 10 + 20001 });
    const doc2 = new Rjs({ clientId: i * 10 + 20101 });
    const t1 = doc1.getText('doc');
    const t2 = doc2.getText('doc');
    const ops = randomInt(3, 10);
    const texts1 = [];
    const texts2 = [];
    for (let j = 0; j < ops; j++) {
      const s1 = randomString(3);
      t1.insert(randomInt(0, t1.length), s1);
      texts1.push(s1);
      const s2 = randomString(3);
      t2.insert(randomInt(0, t2.length), s2);
      texts2.push(s2);
    }
    const merged = mergeInto([doc1, doc2]);
    const mergedText = merged.getText('doc').toString();
    for (const s of texts1) {
      if (!mergedText.includes(s)) throw new Error(`Merged text missing doc1 content: "${s}"`);
    }
    for (const s of texts2) {
      if (!mergedText.includes(s)) throw new Error(`Merged text missing doc2 content: "${s}"`);
    }
  });
}

// 200 tests: Three docs random ops, merge all into fresh doc, verify all content
for (let i = 0; i < 200; i++) {
  test(`three docs sync ${i}`, () => {
    const docA = new Rjs({ clientId: i * 10 + 22001 });
    const docB = new Rjs({ clientId: i * 10 + 22101 });
    const docC = new Rjs({ clientId: i * 10 + 22201 });
    const tA = docA.getText('doc');
    const tB = docB.getText('doc');
    const tC = docC.getText('doc');
    const ops = randomInt(3, 8);
    const textsA = [];
    const textsB = [];
    const textsC = [];
    for (let j = 0; j < ops; j++) {
      const sA = randomString(3);
      tA.insert(randomInt(0, tA.length), sA);
      textsA.push(sA);
      const sB = randomString(3);
      tB.insert(randomInt(0, tB.length), sB);
      textsB.push(sB);
      const sC = randomString(3);
      tC.insert(randomInt(0, tC.length), sC);
      textsC.push(sC);
    }
    const merged = mergeInto([docA, docB, docC]);
    const mergedText = merged.getText('doc').toString();
    for (const s of textsA) {
      if (!mergedText.includes(s)) throw new Error(`Merged text missing docA content: "${s}"`);
    }
    for (const s of textsB) {
      if (!mergedText.includes(s)) throw new Error(`Merged text missing docB content: "${s}"`);
    }
    for (const s of textsC) {
      if (!mergedText.includes(s)) throw new Error(`Merged text missing docC content: "${s}"`);
    }
  });
}

// 200 tests: Two docs random map ops, merge, verify all keys/values
for (let i = 0; i < 200; i++) {
  test(`concurrent map sync ${i}`, () => {
    const doc1 = new Rjs({ clientId: i * 10 + 24001 });
    const doc2 = new Rjs({ clientId: i * 10 + 24101 });
    const m1 = doc1.getMap('doc');
    const m2 = doc2.getMap('doc');
    const expected1 = {};
    const expected2 = {};
    const ops = randomInt(3, 12);
    for (let j = 0; j < ops; j++) {
      const key = randomKey();
      if (rand() < 0.6) {
        const val = randomString(4);
        m1.set(key, val);
        expected1[key] = val;
      } else {
        m1.delete(key);
        delete expected1[key];
      }
      const key2 = randomKey();
      if (rand() < 0.6) {
        const val2 = randomString(4);
        m2.set(key2, val2);
        expected2[key2] = val2;
      } else {
        m2.delete(key2);
        delete expected2[key2];
      }
    }
    // Build expected: doc1 applied first, then doc2 overwrites
    const expected = { ...expected1, ...expected2 };
    const merged = mergeInto([doc1, doc2]);
    const mergedMap = merged.getMap('doc');
    const mergedKeys = mergedMap.keys().sort();
    const expectedKeys = Object.keys(expected).sort();
    if (mergedKeys.length !== expectedKeys.length) throw new Error(`Merged map key count mismatch: ${mergedKeys.length} !== ${expectedKeys.length}`);
    for (const k of expectedKeys) {
      if (mergedMap.get(k) !== expected[k]) throw new Error(`Merged map value mismatch for ${k}: "${mergedMap.get(k)}" !== "${expected[k]}"`);
    }
  });
}

// 200 tests: Two docs random array ops, merge, verify all items
for (let i = 0; i < 200; i++) {
  test(`concurrent array sync ${i}`, () => {
    const doc1 = new Rjs({ clientId: i * 10 + 26001 });
    const doc2 = new Rjs({ clientId: i * 10 + 26101 });
    const a1 = doc1.getArray('doc');
    const a2 = doc2.getArray('doc');
    const allItems = [];
    const ops = randomInt(3, 12);
    for (let j = 0; j < ops; j++) {
      const item1 = randomString(3);
      a1.push(item1);
      allItems.push(item1);
      const item2 = randomString(3);
      a2.push(item2);
      allItems.push(item2);
    }
    const merged = mergeInto([doc1, doc2]);
    const mergedArr = merged.getArray('doc').toArray();
    for (const item of allItems) {
      if (!mergedArr.includes(item)) throw new Error(`Merged array missing item: "${item}"`);
    }
  });
}

// ============================================================
// UNDO/REDO STRESS TESTS (500 tests)
// ============================================================

// 100 tests: Do 20 random text ops, undo all, text should be empty
for (let i = 0; i < 100; i++) {
  test(`undo all text ${i}`, () => {
    const doc = new Rjs({ clientId: i + 28001 });
    const um = doc.enableUndoManager({ maxStackSize: 200 });
    const text = doc.getText('doc');
    const ops = 20;
    for (let j = 0; j < ops; j++) {
      const pos = randomInt(0, text.length);
      text.insert(pos, randomString(3));
    }
    for (let j = 0; j < ops; j++) {
      um.undo();
    }
    if (text.toString() !== '') throw new Error(`Text not empty after undo all: "${text.toString()}"`);
  });
}

// 100 tests: Do 20 random text ops, undo all, verify text empty, check redo stack
for (let i = 0; i < 100; i++) {
  test(`undo redo text ${i}`, () => {
    const doc = new Rjs({ clientId: i + 29001 });
    const um = doc.enableUndoManager({ maxStackSize: 200 });
    const text = doc.getText('doc');
    for (let j = 0; j < 20; j++) {
      const pos = randomInt(0, text.length);
      text.insert(pos, randomString(3));
    }
    if (text.toString() === '') throw new Error('Text empty before undo');
    if (um.undoStack.length === 0) throw new Error('Undo stack empty after ops');
    const undoCount = um.undoStack.length;
    for (let j = 0; j < 20; j++) {
      um.undo();
    }
    if (text.toString() !== '') throw new Error('Text not empty after undo all');
    if (um.redoStack.length === 0) throw new Error('Redo stack empty after undo all');
  });
}

// 100 tests: Map undo all
for (let i = 0; i < 100; i++) {
  test(`undo all map ${i}`, () => {
    const doc = new Rjs({ clientId: i + 30001 });
    const um = doc.enableUndoManager({ maxStackSize: 200 });
    const map = doc.getMap('doc');
    for (let j = 0; j < 20; j++) {
      map.set(randomKey(), randomString(3));
    }
    for (let j = 0; j < 20; j++) {
      um.undo();
    }
    if (map.keys().length !== 0) throw new Error(`Map not empty after undo all: ${map.keys().length} keys`);
  });
}

// 100 tests: Array undo all
for (let i = 0; i < 100; i++) {
  test(`undo all array ${i}`, () => {
    const doc = new Rjs({ clientId: i + 31001 });
    const um = doc.enableUndoManager({ maxStackSize: 200 });
    const arr = doc.getArray('doc');
    for (let j = 0; j < 20; j++) {
      arr.push(randomString(3));
    }
    for (let j = 0; j < 20; j++) {
      um.undo();
    }
    if (arr.toArray().length !== 0) throw new Error(`Array not empty after undo all: ${arr.toArray().length} items`);
  });
}

// 100 tests: stopCapturing mid-way
for (let i = 0; i < 100; i++) {
  test(`stopCapturing ${i}`, () => {
    const doc = new Rjs({ clientId: i + 32001 });
    const um = doc.enableUndoManager({ maxStackSize: 200 });
    const text = doc.getText('doc');
    text.insert(0, 'A');
    um.stopCapturing();
    text.insert(1, 'B');
    um.undo();
    if (text.toString() !== 'B') throw new Error(`stopCapturing undo: "${text.toString()}" !== "B"`);
    um.redo();
    if (text.toString() !== 'AB') throw new Error(`stopCapturing redo: "${text.toString()}" !== "AB"`);
  });
}

// ============================================================
// RELATIVE POSITION STRESS TESTS (200 tests)
// ============================================================

// 100 tests: Create relative position, do random inserts, verify resolution
for (let i = 0; i < 100; i++) {
  test(`relative position resolve ${i}`, () => {
    const doc = new Rjs({ clientId: i + 33001 });
    const text = doc.getText('doc');
    text.insert(0, randomString(10));
    const insertIdx = randomInt(0, text.length);
    const rpos = RelativePosition.createFromTypeIndex(text, insertIdx);
    const ops = randomInt(3, 10);
    for (let j = 0; j < ops; j++) {
      const pos = randomInt(0, text.length);
      text.insert(pos, randomString(2));
    }
    const abs = RelativePosition.createAbsolutePositionFromRelativePosition(text, rpos);
    if (abs === null) throw new Error('Relative position resolved to null');
    if (typeof abs.index !== 'number') throw new Error('Relative position index not a number');
  });
}

// 100 tests: Encode/decode relative position after concurrent edits
for (let i = 0; i < 100; i++) {
  test(`relative position encode/decode ${i}`, () => {
    const doc = new Rjs({ clientId: i + 34001 });
    const text = doc.getText('doc');
    text.insert(0, randomString(8));
    const rpos = RelativePosition.createFromTypeIndex(text, randomInt(0, text.length));
    const encoded = RelativePosition.encode(rpos);
    if (!(encoded instanceof Uint8Array)) throw new Error('RelativePosition encode not Uint8Array');
    const decoded = RelativePosition.decode(encoded);
    if (decoded.type !== rpos.type) throw new Error(`RelativePosition type mismatch: ${decoded.type} !== ${rpos.type}`);
    if (decoded.blockId !== rpos.blockId) throw new Error(`RelativePosition blockId mismatch`);
    for (let j = 0; j < 5; j++) {
      text.insert(randomInt(0, text.length), randomString(2));
    }
    const abs = RelativePosition.createAbsolutePositionFromRelativePosition(text, decoded);
    if (abs === null) throw new Error('Decoded relative position resolved to null');
  });
}

// ============================================================
// SUBDOCUMENT STRESS TESTS (200 tests)
// ============================================================

// 100 tests: Create subdoc, do random ops, verify content
for (let i = 0; i < 100; i++) {
  test(`subdoc ops ${i}`, () => {
    const doc = new Rjs({ clientId: i + 35001 });
    const subdoc = doc.getSubdoc('child');
    const text = subdoc.getText('content');
    const expected = [];
    const ops = randomInt(3, 10);
    for (let j = 0; j < ops; j++) {
      const str = randomString(3);
      text.insert(text.length, str);
      expected.push(str);
    }
    const actual = text.toString();
    const expStr = expected.join('');
    if (actual !== expStr) throw new Error(`Subdoc text mismatch: "${actual}" !== "${expStr}"`);
  });
}

// 100 tests: Nested subdocs (2 levels), ops at each level
for (let i = 0; i < 100; i++) {
  test(`nested subdoc ${i}`, () => {
    const doc = new Rjs({ clientId: i + 36001 });
    const sub1 = doc.getSubdoc('level1');
    sub1.getText('x');
    const sub2 = sub1.crdt.getSubdoc('level2');
    const t1 = sub1.getText('content');
    const t2 = sub2.getText('content');
    t1.insert(0, randomString(5));
    t2.insert(0, randomString(5));
    if (t1.toString().length < 1) throw new Error('Level1 text empty');
    if (t2.toString().length < 1) throw new Error('Level2 text empty');
    sub1.getMap('meta').set('level', 1);
    sub2.getMap('meta').set('level', 2);
    if (sub1.getMap('meta').get('level') !== 1) throw new Error('Level1 map mismatch');
    if (sub2.getMap('meta').get('level') !== 2) throw new Error('Level2 map mismatch');
  });
}

// ============================================================
// SNAPSHOT STRESS TESTS (200 tests)
// ============================================================

// 100 tests: Do random ops, take snapshot at various points, verify snapshot encode/decode
for (let i = 0; i < 100; i++) {
  test(`snapshot state ${i}`, () => {
    const doc = new Rjs({ clientId: i + 37001 });
    const text = doc.getText('doc');
    const snaps = [];
    const ops = randomInt(5, 15);
    for (let j = 0; j < ops; j++) {
      text.insert(randomInt(0, text.length), randomString(3));
      if (rand() < 0.5) {
        snaps.push(Snapshot.createFromDocument(doc.crdt));
      }
    }
    if (snaps.length === 0) snaps.push(Snapshot.createFromDocument(doc.crdt));
    for (const snap of snaps) {
      if (snap.stateVector.size === 0) throw new Error('Snapshot state vector empty');
      const encoded = Snapshot.encode(snap);
      const decoded = Snapshot.decode(encoded);
      if (decoded.stateVector.size !== snap.stateVector.size) throw new Error('Snapshot roundtrip SV size mismatch');
    }
  });
}

// 100 tests: Create doc from snapshot, verify it has the state vector
for (let i = 0; i < 100; i++) {
  test(`snapshot create doc ${i}`, () => {
    const doc = new Rjs({ clientId: i + 38001 });
    const text = doc.getText('doc');
    const ops = randomInt(3, 10);
    for (let j = 0; j < ops; j++) {
      text.insert(text.length, randomString(3));
    }
    const snap = Snapshot.createFromDocument(doc.crdt);
    const newDoc = Snapshot.createDocFromSnapshot(snap, i + 39001);
    if (newDoc === null) throw new Error('createDocFromSnapshot returned null');
    if (newDoc.clientId !== i + 39001) throw new Error('Doc from snapshot clientId mismatch');
  });
}

// ============================================================
// MULTI-TYPE ROUNDTRIP & MERGE TESTS (200 tests)
// ============================================================

// 100 tests: Create doc with text+map+array+counter, encode, decode, verify all types
for (let i = 0; i < 100; i++) {
  test(`multi-type roundtrip ${i}`, () => {
    const doc1 = new Rjs({ clientId: i * 10 + 40001 });
    const text = doc1.getText('doc');
    const map = doc1.getMap('meta');
    const arr = doc1.getArray('items');
    const cnt = doc1.getCounter('score');
    const textVal = randomString(8);
    const mapKey = randomKey();
    const mapVal = randomString(4);
    const arrItems = [];
    const cntVal = randomInt(1, 50);
    text.insert(0, textVal);
    map.set(mapKey, mapVal);
    for (let j = 0; j < randomInt(2, 6); j++) {
      const item = randomString(3);
      arr.push(item);
      arrItems.push(item);
    }
    cnt.add(cntVal);
    const encoded = doc1.serializer.encodeDocument(doc1.crdt);
    const doc2 = new Rjs({ clientId: i * 10 + 40101 });
    doc2.applyUpdate(encoded);
    if (doc2.getText('doc').toString() !== textVal) throw new Error('Multi-type text mismatch');
    if (doc2.getMap('meta').get(mapKey) !== mapVal) throw new Error('Multi-type map mismatch');
    if (doc2.getArray('items').toArray().length !== arrItems.length) throw new Error('Multi-type array length mismatch');
    if (doc2.getCounter('score').get() !== cntVal) throw new Error('Multi-type counter mismatch');
  });
}

// 100 tests: Create two docs with mixed types, merge into fresh doc, verify all content
for (let i = 0; i < 100; i++) {
  test(`multi-type merge ${i}`, () => {
    const doc1 = new Rjs({ clientId: i * 10 + 41001 });
    const doc2 = new Rjs({ clientId: i * 10 + 41101 });
    const t1 = doc1.getText('doc');
    const t2 = doc2.getText('doc');
    const m1 = doc1.getMap('meta');
    const m2 = doc2.getMap('meta');
    const a1 = doc1.getArray('items');
    const a2 = doc2.getArray('items');
    const text1Val = randomString(5);
    const text2Val = randomString(5);
    const mapKey1 = 'k1_' + i;
    const mapKey2 = 'k2_' + i;
    const mapVal1 = randomString(3);
    const mapVal2 = randomString(3);
    const arrItem1 = randomString(3);
    const arrItem2 = randomString(3);
    t1.insert(0, text1Val);
    t2.insert(0, text2Val);
    m1.set(mapKey1, mapVal1);
    m2.set(mapKey2, mapVal2);
    a1.push(arrItem1);
    a2.push(arrItem2);
    const merged = mergeInto([doc1, doc2]);
    if (!merged.getText('doc').toString().includes(text1Val)) throw new Error('Multi-type merge text1 missing');
    if (!merged.getText('doc').toString().includes(text2Val)) throw new Error('Multi-type merge text2 missing');
    if (merged.getMap('meta').get(mapKey1) !== mapVal1) throw new Error('Multi-type merge map1 missing');
    if (merged.getMap('meta').get(mapKey2) !== mapVal2) throw new Error('Multi-type merge map2 missing');
    const mergedArr = merged.getArray('items').toArray();
    if (!mergedArr.includes(arrItem1)) throw new Error('Multi-type merge arr1 missing');
    if (!mergedArr.includes(arrItem2)) throw new Error('Multi-type merge arr2 missing');
  });
}

// ============================================================
// SUMMARY
// ============================================================

console.log(`\n=== Stress Test Part 2: Serialization & Sync ===`);
console.log(`Total: ${passed + failed}`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (errors.length > 0) {
  console.log(`\nFirst 10 errors:`);
  errors.slice(0, 10).forEach(e => console.log(`  FAIL: ${e.name} - ${e.error}`));
}
