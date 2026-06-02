const Rjs = require('../lib/rjs');
const { CRDT, TextCRDT, MapCRDT, ArrayCRDT, CounterCRDT, UndoManager, Snapshot, RelativePosition, SerializerV2 } = require('../lib/rjs');

function seededRandom(seed) {
  let s = seed;
  return function () {
    s = (s * 1103515245 + 12345) & 0x7FFFFFFF;
    return s / 0x7FFFFFFF;
  };
}
const rand = seededRandom(456);

function randomString(len) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < len; i++) result += chars[Math.floor(rand() * chars.length)];
  return result;
}

function randomInt(min, max) {
  return Math.floor(rand() * (max - min + 1)) + min;
}

let passed = 0;
let failed = 0;
const errors = [];

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    errors.push({ name, error: e.message });
  }
}

// ============================================================
// EDGE CASE TESTS (1500 tests)
// ============================================================

// 100 tests: Insert at position 0 (beginning) with random strings
for (let i = 0; i < 100; i++) {
  test(`insert at position 0 - ${i}`, () => {
    const rjs = new Rjs({ clientId: 1000 + i });
    const text = rjs.getText('edge');
    const strings = [];
    for (let j = 0; j < 10; j++) {
      const s = randomString(5);
      strings.unshift(s);
      text.insert(0, s);
    }
    if (text.toString() !== strings.join('')) {
      throw new Error(`Expected "${strings.join('')}" got "${text.toString()}"`);
    }
  });
}

// 100 tests: Insert at position text.length (end) with random strings
for (let i = 0; i < 100; i++) {
  test(`insert at end - ${i}`, () => {
    const rjs = new Rjs({ clientId: 2000 + i });
    const text = rjs.getText('edge');
    const parts = [];
    for (let j = 0; j < 10; j++) {
      const s = randomString(5);
      parts.push(s);
      text.insert(text.length, s);
    }
    if (text.toString() !== parts.join('')) {
      throw new Error(`Expected "${parts.join('')}" got "${text.toString()}"`);
    }
  });
}

// 100 tests: Delete at position 0 repeatedly until empty
for (let i = 0; i < 100; i++) {
  test(`delete at position 0 until empty - ${i}`, () => {
    const rjs = new Rjs({ clientId: 3000 + i });
    const text = rjs.getText('edge');
    const s = randomString(20);
    text.insert(0, s);
    while (text.length > 0) {
      text.delete(0, 1);
    }
    if (text.toString() !== '') {
      throw new Error(`Expected empty got "${text.toString()}"`);
    }
  });
}

// 100 tests: Delete at last position repeatedly until empty
for (let i = 0; i < 100; i++) {
  test(`delete at last position until empty - ${i}`, () => {
    const rjs = new Rjs({ clientId: 4000 + i });
    const text = rjs.getText('edge');
    const s = randomString(15);
    text.insert(0, s);
    while (text.length > 0) {
      text.delete(text.length - 1, 1);
    }
    if (text.toString() !== '') {
      throw new Error(`Expected empty got "${text.toString()}"`);
    }
  });
}

// 100 tests: Insert single char at every position (0 through length) and verify
for (let i = 0; i < 100; i++) {
  test(`insert single char at every position - ${i}`, () => {
    const rjs = new Rjs({ clientId: 5000 + i });
    const text = rjs.getText('edge');
    let result = '';
    const numInserts = randomInt(3, 8);
    for (let pos = 0; pos <= numInserts; pos++) {
      const ch = randomString(1);
      result = result.slice(0, pos) + ch + result.slice(pos);
      text.insert(pos, ch);
    }
    if (text.toString() !== result) {
      throw new Error(`Expected "${result}" got "${text.toString()}"`);
    }
  });
}

// 100 tests: Empty string insert - should be no-op
for (let i = 0; i < 100; i++) {
  test(`empty string insert is no-op - ${i}`, () => {
    const rjs = new Rjs({ clientId: 6000 + i });
    const text = rjs.getText('edge');
    const before = text.toString();
    text.insert(0, '');
    text.insert(5, '');
    text.insert(100, '');
    if (text.toString() !== before) {
      throw new Error(`Empty insert changed text to "${text.toString()}"`);
    }
  });
}

// 100 tests: Map set with empty string key and value
for (let i = 0; i < 100; i++) {
  test(`map empty string key and value - ${i}`, () => {
    const rjs = new Rjs({ clientId: 7000 + i });
    const map = rjs.getMap('edge');
    map.set('', '');
    if (!map.has('')) {
      throw new Error('has("") returned false');
    }
    if (map.get('') !== '') {
      throw new Error(`Expected "" got "${map.get('')}"`);
    }
    map.set('a', 'b');
    if (map.get('') !== '') {
      throw new Error('Empty key lost after set');
    }
  });
}

// 100 tests: Map set with very long keys (100+ chars)
for (let i = 0; i < 100; i++) {
  test(`map very long key - ${i}`, () => {
    const rjs = new Rjs({ clientId: 8000 + i });
    const map = rjs.getMap('edge');
    const longKey = randomString(100 + randomInt(0, 100));
    const longVal = randomString(100 + randomInt(0, 100));
    map.set(longKey, longVal);
    if (map.get(longKey) !== longVal) {
      throw new Error('Long key value mismatch');
    }
    if (!map.has(longKey)) {
      throw new Error('Long key not found');
    }
  });
}

// 100 tests: Array insert at position 0 (beginning) repeatedly
for (let i = 0; i < 100; i++) {
  test(`array insert at position 0 - ${i}`, () => {
    const rjs = new Rjs({ clientId: 9000 + i });
    const arr = rjs.getArray('edge');
    const expected = [];
    for (let j = 0; j < 10; j++) {
      const val = randomString(3);
      expected.unshift(val);
      arr.insert(0, val);
    }
    const actual = arr.toArray();
    if (actual.length !== expected.length) {
      throw new Error(`Length mismatch: ${actual.length} vs ${expected.length}`);
    }
    for (let j = 0; j < expected.length; j++) {
      if (actual[j] !== expected[j]) {
        throw new Error(`Index ${j}: expected "${expected[j]}" got "${actual[j]}"`);
      }
    }
  });
}

// 100 tests: Array insert at last position repeatedly
for (let i = 0; i < 100; i++) {
  test(`array insert at last position - ${i}`, () => {
    const rjs = new Rjs({ clientId: 10000 + i });
    const arr = rjs.getArray('edge');
    const expected = [];
    for (let j = 0; j < 10; j++) {
      const val = randomString(3);
      expected.push(val);
      arr.push(val);
    }
    const actual = arr.toArray();
    if (actual.length !== expected.length) {
      throw new Error(`Length mismatch: ${actual.length} vs ${expected.length}`);
    }
    for (let j = 0; j < expected.length; j++) {
      if (actual[j] !== expected[j]) {
        throw new Error(`Index ${j}: expected "${expected[j]}" got "${actual[j]}"`);
      }
    }
  });
}

// 100 tests: Counter add(0) - should not change value
for (let i = 0; i < 100; i++) {
  test(`counter add(0) no-op - ${i}`, () => {
    const rjs = new Rjs({ clientId: 11000 + i });
    const counter = rjs.getCounter('edge');
    const before = counter.get();
    counter.add(0);
    if (counter.get() !== before) {
      throw new Error(`Expected ${before} got ${counter.get()}`);
    }
  });
}

// 100 tests: Counter add(-1) then add(1) - should return to original
for (let i = 0; i < 100; i++) {
  test(`counter add(-1) then add(1) roundtrip - ${i}`, () => {
    const rjs = new Rjs({ clientId: 12000 + i });
    const counter = rjs.getCounter('edge');
    const initial = randomInt(0, 100);
    counter.add(initial);
    const before = counter.get();
    counter.add(-1);
    counter.add(1);
    if (counter.get() !== before) {
      throw new Error(`Expected ${before} got ${counter.get()}`);
    }
  });
}

// 100 tests: UndoManager with empty document - undo/redo should be no-ops
for (let i = 0; i < 100; i++) {
  test(`undo/redo empty document - ${i}`, () => {
    const rjs = new Rjs({ clientId: 13000 + i });
    const um = rjs.enableUndoManager();
    const text = rjs.getText('edge');
    um.undo();
    um.redo();
    um.undo();
    um.undo();
    um.redo();
    um.redo();
    if (text.toString() !== '') {
      throw new Error(`Expected empty got "${text.toString()}"`);
    }
  });
}

// 100 tests: Snapshot of empty document - should encode/decode correctly
for (let i = 0; i < 100; i++) {
  test(`snapshot empty document - ${i}`, () => {
    const rjs = new Rjs({ clientId: 14000 + i });
    const snap = Rjs.Snapshot.createFromDocument(rjs.crdt);
    const encoded = Rjs.Snapshot.encode(snap);
    const decoded = Rjs.Snapshot.decode(encoded);
    if (decoded.stateVector.size !== snap.stateVector.size) {
      throw new Error(`State vector size mismatch`);
    }
  });
}

// 100 tests: Relative position at position 0 of empty doc
for (let i = 0; i < 100; i++) {
  test(`relative position at 0 of empty doc - ${i}`, () => {
    const rjs = new Rjs({ clientId: 15000 + i });
    const text = rjs.getText('edge');
    const rpos = Rjs.RelativePosition.createFromTypeIndex(text, 0);
    if (!rpos) {
      throw new Error('RelativePosition is null');
    }
    const abs = Rjs.RelativePosition.createAbsolutePositionFromRelativePosition(text, rpos);
    if (!abs) {
      throw new Error('Absolute position is null');
    }
  });
}

// ============================================================
// LARGE DATA STRESS TESTS (1000 tests)
// ============================================================

// 100 tests: Insert 1000 random chars one at a time into text
for (let i = 0; i < 100; i++) {
  test(`insert 1000 random chars - ${i}`, () => {
    const rjs = new Rjs({ clientId: 20000 + i });
    const text = rjs.getText('stress');
    const chars = [];
    for (let j = 0; j < 1000; j++) {
      const ch = randomString(1);
      chars.push(ch);
      text.insert(text.length, ch);
    }
    if (text.toString() !== chars.join('')) {
      throw new Error('Text mismatch after 1000 inserts');
    }
  });
}

// 100 tests: Insert 100 random key-value pairs into map
for (let i = 0; i < 100; i++) {
  test(`insert 100 random map entries - ${i}`, () => {
    const rjs = new Rjs({ clientId: 21000 + i });
    const map = rjs.getMap('stress');
    const entries = new Map();
    for (let j = 0; j < 100; j++) {
      const key = `key_${j}_${randomString(3)}`;
      const val = randomString(10);
      entries.set(key, val);
      map.set(key, val);
    }
    for (const [key, val] of entries) {
      if (map.get(key) !== val) {
        throw new Error(`Map key "${key}" mismatch`);
      }
    }
  });
}

// 100 tests: Push 100 random values into array
for (let i = 0; i < 100; i++) {
  test(`push 100 random array values - ${i}`, () => {
    const rjs = new Rjs({ clientId: 22000 + i });
    const arr = rjs.getArray('stress');
    const expected = [];
    for (let j = 0; j < 100; j++) {
      const val = randomString(5);
      expected.push(val);
      arr.push(val);
    }
    const actual = arr.toArray();
    if (actual.length !== expected.length) {
      throw new Error(`Array length mismatch: ${actual.length} vs ${expected.length}`);
    }
    for (let j = 0; j < expected.length; j++) {
      if (actual[j] !== expected[j]) {
        throw new Error(`Array index ${j} mismatch`);
      }
    }
  });
}

// 100 tests: Encode/decode document with 500+ text ops
for (let i = 0; i < 100; i++) {
  test(`encode/decode 500+ text ops - ${i}`, () => {
    const rjs = new Rjs({ clientId: 23000 + i });
    const text = rjs.getText('stress');
    for (let j = 0; j < 500; j++) {
      text.insert(text.length, randomString(2));
    }
    const originalStr = text.toString();
    const encoded = rjs.serializer.encodeDocument(rjs.crdt);
    const rjs2 = new Rjs({ clientId: 23000 + i + 50000 });
    rjs2.serializer.decodeDocument(encoded, rjs2.crdt);
    const decoded = rjs2.getText('stress');
    if (decoded.toString() !== originalStr) {
      throw new Error('Text mismatch after encode/decode');
    }
  });
}

// 100 tests: Encode/decode document with 500+ map ops
for (let i = 0; i < 100; i++) {
  test(`encode/decode 500+ map ops - ${i}`, () => {
    const rjs = new Rjs({ clientId: 24000 + i });
    const map = rjs.getMap('stress');
    const entries = new Map();
    for (let j = 0; j < 500; j++) {
      const key = `k${j}`;
      const val = randomInt(0, 99999);
      entries.set(key, val);
      map.set(key, val);
    }
    const encoded = rjs.serializer.encodeDocument(rjs.crdt);
    const rjs2 = new Rjs({ clientId: 24000 + i + 50000 });
    rjs2.serializer.decodeDocument(encoded, rjs2.crdt);
    const decoded = rjs2.getMap('stress');
    for (const [key, val] of entries) {
      if (decoded.get(key) !== val) {
        throw new Error(`Map key "${key}" mismatch after decode`);
      }
    }
  });
}

// 100 tests: Encode/decode document with 500+ array ops
for (let i = 0; i < 100; i++) {
  test(`encode/decode 500+ array ops - ${i}`, () => {
    const rjs = new Rjs({ clientId: 25000 + i });
    const arr = rjs.getArray('stress');
    const expected = [];
    for (let j = 0; j < 500; j++) {
      const val = randomInt(0, 99999);
      expected.push(val);
      arr.push(val);
    }
    const encoded = rjs.serializer.encodeDocument(rjs.crdt);
    const rjs2 = new Rjs({ clientId: 25000 + i + 50000 });
    rjs2.serializer.decodeDocument(encoded, rjs2.crdt);
    const decoded = rjs2.getArray('stress');
    const actual = decoded.toArray();
    if (actual.length !== expected.length) {
      throw new Error(`Array length mismatch after decode: ${actual.length} vs ${expected.length}`);
    }
    for (let j = 0; j < expected.length; j++) {
      if (actual[j] !== expected[j]) {
        throw new Error(`Array index ${j} mismatch after decode`);
      }
    }
  });
}

// 100 tests: Create snapshot after 200 ops, restore from snapshot
for (let i = 0; i < 100; i++) {
  test(`snapshot after 200 ops - ${i}`, () => {
    const rjs = new Rjs({ clientId: 26000 + i });
    const text = rjs.getText('snap');
    const map = rjs.getMap('snap');
    const counter = rjs.getCounter('snap');
    let content = '';
    for (let j = 0; j < 200; j++) {
      if (rand() < 0.5) {
        const s = randomString(1);
        const pos = randomInt(0, content.length);
        content = content.slice(0, pos) + s + content.slice(pos);
        text.insert(pos, s);
      } else {
        map.set(`k${j}`, j);
        counter.add(1);
      }
    }
    const snap = Rjs.Snapshot.createFromDocument(rjs.crdt);
    const snapEncoded = Rjs.Snapshot.encode(snap);
    const snapDecoded = Rjs.Snapshot.decode(snapEncoded);
    const newDoc = Rjs.Snapshot.createDocFromSnapshot(snapDecoded, 999999);
    if (!newDoc) {
      throw new Error('Doc from snapshot is null');
    }
  });
}

// 100 tests: Sync two docs that have 500+ ops each
for (let i = 0; i < 100; i++) {
  test(`sync two docs with 500+ ops each - ${i}`, () => {
    const rjsA = new Rjs({ clientId: 27000 + i });
    const rjsB = new Rjs({ clientId: 27000 + i + 50000 });
    const textA = rjsA.getText('sync');
    const textB = rjsB.getText('sync');
    const aChars = [];
    const bChars = [];
    for (let j = 0; j < 500; j++) {
      const s = randomString(1);
      aChars.push(s);
      textA.insert(textA.length, s);
    }
    for (let j = 0; j < 500; j++) {
      const s = randomString(1);
      bChars.push(s);
      textB.insert(textB.length, s);
    }
    const updateA = rjsA.encodeStateAsUpdate('sync');
    const updateB = rjsB.encodeStateAsUpdate('sync');
    rjsB.applyUpdate(updateA);
    rjsA.applyUpdate(updateB);
    if (textA.length !== textB.length) {
      throw new Error(`Length mismatch: ${textA.length} vs ${textB.length}`);
    }
    if (textA.length !== aChars.length + bChars.length) {
      throw new Error(`Expected total ${aChars.length + bChars.length} got ${textA.length}`);
    }
  });
}

// 100 tests: Apply 50 remote operations one at a time
for (let i = 0; i < 100; i++) {
  test(`apply 50 remote ops one at a time - ${i}`, () => {
    const rjs = new Rjs({ clientId: 28000 + i });
    for (let j = 0; j < 50; j++) {
      rjs.crdt.applyRemoteOps([
        { type: 'text-insert', name: 'remote', pos: j, content: randomString(1) }
      ]);
    }
    const text = rjs.getText('remote');
    if (text.length !== 50) {
      throw new Error(`Expected length 50 got ${text.length}`);
    }
  });
}

// 100 tests: Create CRDT with 10 different types (text, map, array, counter, xml) in one doc
for (let i = 0; i < 100; i++) {
  test(`10 different types in one doc - ${i}`, () => {
    const rjs = new Rjs({ clientId: 29000 + i });
    rjs.getText('text1').insert(0, randomString(10));
    rjs.getText('text2').insert(0, randomString(10));
    rjs.getMap('map1').set('a', 1);
    rjs.getMap('map2').set('b', 2);
    rjs.getArray('arr1').push('x');
    rjs.getArray('arr2').push('y');
    rjs.getCounter('cnt1').add(10);
    rjs.getCounter('cnt2').add(20);
    const frag = rjs.getXmlFragment('xml1');
    frag.insert(0, new Rjs.YXmlElement(rjs.crdt, 'div'));
    const xmlText = new Rjs.YXmlText(rjs.crdt, randomString(5));
    rjs.getXmlFragment('xml2').insert(0, xmlText);

    const encoded = rjs.serializer.encodeDocument(rjs.crdt);
    const rjs2 = new Rjs({ clientId: 29000 + i + 50000 });
    rjs2.serializer.decodeDocument(encoded, rjs2.crdt);
    if (rjs2.getText('text1').toString() !== rjs.getText('text1').toString()) {
      throw new Error('text1 mismatch after decode');
    }
    if (rjs2.getMap('map1').get('a') !== 1) {
      throw new Error('map1 mismatch after decode');
    }
    if (rjs2.getArray('arr1').toArray()[0] !== 'x') {
      throw new Error('arr1 mismatch after decode');
    }
    if (rjs2.getCounter('cnt1').get() !== 10) {
      throw new Error('cnt1 mismatch after decode');
    }
  });
}

// ============================================================
// TOMBSTONE / GC STRESS TESTS (500 tests)
// ============================================================

// 100 tests: Insert then delete 100 items. Verify text is empty. Run GC. Verify doc still serializable.
for (let i = 0; i < 100; i++) {
  test(`insert-delete 100 GC text - ${i}`, () => {
    const rjs = new Rjs({ clientId: 30000 + i, tombstoneThreshold: 1, ageThreshold: 0 });
    const text = rjs.getText('gc');
    for (let j = 0; j < 100; j++) {
      text.insert(j, randomString(1));
    }
    while (text.length > 0) {
      text.delete(0, 1);
    }
    if (text.toString() !== '') {
      throw new Error('Text not empty after deleting all');
    }
    rjs.runGC();
    const encoded = rjs.serializer.encodeDocument(rjs.crdt);
    if (!encoded || encoded.length === 0) {
      throw new Error('Doc not serializable after GC');
    }
  });
}

// 100 tests: Map set 100 keys, delete all. Verify empty. Run GC. Verify serializable.
for (let i = 0; i < 100; i++) {
  test(`map set-delete 100 GC - ${i}`, () => {
    const rjs = new Rjs({ clientId: 31000 + i, tombstoneThreshold: 1, ageThreshold: 0 });
    const map = rjs.getMap('gc');
    for (let j = 0; j < 100; j++) {
      map.set(`k${j}`, j);
    }
    for (let j = 0; j < 100; j++) {
      map.delete(`k${j}`);
    }
    if (map.size !== 0) {
      throw new Error(`Map not empty: size=${map.size}`);
    }
    rjs.runGC();
    const encoded = rjs.serializer.encodeDocument(rjs.crdt);
    if (!encoded || encoded.length === 0) {
      throw new Error('Doc not serializable after GC');
    }
  });
}

// 100 tests: Array push 100, delete all. Verify empty. Run GC. Verify serializable.
for (let i = 0; i < 100; i++) {
  test(`array push-delete 100 GC - ${i}`, () => {
    const rjs = new Rjs({ clientId: 32000 + i, tombstoneThreshold: 1, ageThreshold: 0 });
    const arr = rjs.getArray('gc');
    for (let j = 0; j < 100; j++) {
      arr.push(j);
    }
    while (arr.length > 0) {
      arr.pop();
    }
    if (arr.length !== 0) {
      throw new Error(`Array not empty: length=${arr.length}`);
    }
    rjs.runGC();
    const encoded = rjs.serializer.encodeDocument(rjs.crdt);
    if (!encoded || encoded.length === 0) {
      throw new Error('Doc not serializable after GC');
    }
  });
}

// 100 tests: After GC, create snapshot. Verify snapshot works.
for (let i = 0; i < 100; i++) {
  test(`snapshot after GC - ${i}`, () => {
    const rjs = new Rjs({ clientId: 33000 + i, tombstoneThreshold: 1, ageThreshold: 0 });
    const text = rjs.getText('gc');
    for (let j = 0; j < 10; j++) {
      text.insert(text.length, randomString(2));
    }
    rjs.runGC();
    const snap = Rjs.Snapshot.createFromDocument(rjs.crdt);
    const encoded = Rjs.Snapshot.encode(snap);
    const decoded = Rjs.Snapshot.decode(encoded);
    if (!decoded) {
      throw new Error('Snapshot decode returned null after GC');
    }
  });
}

// 100 tests: After GC, merge with another doc. Verify convergence.
for (let i = 0; i < 100; i++) {
  test(`merge after GC - ${i}`, () => {
    const rjsA = new Rjs({ clientId: 34000 + i, tombstoneThreshold: 1, ageThreshold: 0 });
    const rjsB = new Rjs({ clientId: 34000 + i + 50000, tombstoneThreshold: 1, ageThreshold: 0 });
    const textA = rjsA.getText('merge');
    const textB = rjsB.getText('merge');
    for (let j = 0; j < 10; j++) {
      textA.insert(textA.length, randomString(1));
    }
    rjsA.runGC();
    const updateA = rjsA.encodeStateAsUpdate('merge');
    rjsB.applyUpdate(updateA);
    for (let j = 0; j < 10; j++) {
      textB.insert(textB.length, randomString(1));
    }
    const updateB = rjsB.encodeStateAsUpdate('merge');
    rjsA.applyUpdate(updateB);
    if (textA.toString() !== textB.toString()) {
      throw new Error('Docs did not converge after merge post-GC');
    }
  });
}

// ============================================================
// XML STRESS TESTS (500 tests)
// ============================================================

// 100 tests: Create XmlFragment, insert 50 XmlElements with random attributes. Verify toString().
for (let i = 0; i < 100; i++) {
  test(`XmlFragment 50 elements toString - ${i}`, () => {
    const rjs = new Rjs({ clientId: 40000 + i });
    const frag = rjs.getXmlFragment('xml');
    for (let j = 0; j < 50; j++) {
      const attrs = {};
      for (let k = 0; k < 3; k++) {
        attrs[`attr${k}`] = randomString(5);
      }
      const elem = new Rjs.YXmlElement(rjs.crdt, 'item', attrs);
      frag.insert(frag.length, elem);
    }
    const str = frag.toString();
    if (str.length === 0) {
      throw new Error('toString returned empty string');
    }
    if (frag.length !== 50) {
      throw new Error(`Expected 50 children got ${frag.length}`);
    }
  });
}

// 100 tests: Create nested XmlElements (parent>child>grandchild). Verify toDOM() structure.
for (let i = 0; i < 100; i++) {
  test(`nested XmlElements toDOM - ${i}`, () => {
    const rjs = new Rjs({ clientId: 41000 + i });
    const frag = rjs.getXmlFragment('nested');
    const parent = new Rjs.YXmlElement(rjs.crdt, 'div', { id: 'root' });
    const child = new Rjs.YXmlElement(rjs.crdt, 'span', { class: 'inner' });
    const grandchild = new Rjs.YXmlElement(rjs.crdt, 'b');
    grandchild.insert(0, new Rjs.YXmlText(rjs.crdt, 'bold text'));
    child.insert(0, grandchild);
    parent.insert(0, child);
    frag.insert(0, parent);

    const dom = frag.toDOM();
    if (!dom.children || dom.children.length !== 1) {
      throw new Error('Fragment toDOM should have 1 child');
    }
    const parentDom = dom.children[0];
    if (parentDom.tagName !== 'div') {
      throw new Error(`Expected div got ${parentDom.tagName}`);
    }
    if (!parentDom.children || parentDom.children.length !== 1) {
      throw new Error('Parent should have 1 child');
    }
    const childDom = parentDom.children[0];
    if (childDom.tagName !== 'span') {
      throw new Error(`Expected span got ${childDom.tagName}`);
    }
    if (!childDom.children || childDom.children.length !== 1) {
      throw new Error('Child should have 1 grandchild');
    }
  });
}

// 100 tests: XmlText insert/delete random content. Verify toString().
for (let i = 0; i < 100; i++) {
  test(`XmlText insert/delete random content - ${i}`, () => {
    const rjs = new Rjs({ clientId: 42000 + i });
    const frag = rjs.getXmlFragment('xmltext');
    const xmlText = new Rjs.YXmlText(rjs.crdt, '');
    frag.insert(0, xmlText);
    let content = '';
    for (let j = 0; j < 20; j++) {
      if (rand() < 0.7) {
        const s = randomString(3);
        const pos = randomInt(0, content.length);
        content = content.slice(0, pos) + s + content.slice(pos);
        xmlText.insert(pos, s);
      } else if (content.length > 0) {
        const pos = randomInt(0, content.length - 1);
        const len = randomInt(1, Math.min(3, content.length - pos));
        content = content.slice(0, pos) + content.slice(pos + len);
        xmlText.delete(pos, len);
      }
    }
    if (xmlText.toString() !== content) {
      throw new Error(`XmlText mismatch: expected "${content}" got "${xmlText.toString()}"`);
    }
  });
}

// 100 tests: XmlFragment slice with random start/end. Verify correct subset.
for (let i = 0; i < 100; i++) {
  test(`XmlFragment slice random range - ${i}`, () => {
    const rjs = new Rjs({ clientId: 43000 + i });
    const frag = rjs.getXmlFragment('sliced');
    const count = randomInt(5, 20);
    for (let j = 0; j < count; j++) {
      frag.insert(frag.length, new Rjs.YXmlElement(rjs.crdt, `tag${j}`));
    }
    const start = randomInt(0, count - 1);
    const end = randomInt(start + 1, count);
    const sliced = frag.slice(start, end);
    if (sliced.length !== end - start) {
      throw new Error(`Slice length mismatch: expected ${end - start} got ${sliced.length}`);
    }
  });
}

// 100 tests: CreateTreeWalker on XmlFragment with 20+ nodes. Verify all visited.
for (let i = 0; i < 100; i++) {
  test(`CreateTreeWalker 20+ nodes - ${i}`, () => {
    const rjs = new Rjs({ clientId: 44000 + i });
    const frag = rjs.getXmlFragment('walker');
    const totalNodes = randomInt(20, 40);
    for (let j = 0; j < totalNodes; j++) {
      const elem = new Rjs.YXmlElement(rjs.crdt, `node${j}`);
      if (j > 0 && rand() < 0.3) {
        const parentIdx = randomInt(0, Math.floor(j / 2));
        const parent = frag.get(parentIdx);
        if (parent && parent instanceof Rjs.YXmlElement) {
          parent.insert(parent.length, elem);
          continue;
        }
      }
      frag.insert(frag.length, elem);
    }
    let visited = 0;
    for (const node of frag.createTreeWalker(() => true)) {
      visited++;
    }
    if (visited < 20) {
      throw new Error(`Expected at least 20 visited, got ${visited}`);
    }
  });
}

// ============================================================
// COMPRESSION STRESS TESTS (250 tests)
// ============================================================

// 50 tests: Compress/decompress random strings. Verify content preserved.
for (let i = 0; i < 50; i++) {
  test(`compress/decompress random string - ${i}`, () => {
    const rjs = new Rjs({ clientId: 50000 + i });
    const compressor = rjs.compressor;
    const original = randomString(randomInt(10, 200));
    const compressed = compressor.compress(original);
    const decompressed = compressor.decompress(compressed);
    if (decompressed !== original) {
      throw new Error('String roundtrip mismatch');
    }
  });
}

// 50 tests: Compress/decompress random Uint8Arrays. Verify content preserved.
for (let i = 0; i < 50; i++) {
  test(`compress/decompress random Uint8Array - ${i}`, () => {
    const rjs = new Rjs({ clientId: 51000 + i });
    const compressor = rjs.compressor;
    const len = randomInt(10, 500);
    const original = new Uint8Array(len);
    for (let j = 0; j < len; j++) original[j] = Math.floor(rand() * 256);
    const compressed = compressor.compress(original);
    const decompressed = compressor.decompress(compressed);
    const originalStr = new TextDecoder().decode(original);
    if (typeof decompressed !== 'string') {
      throw new Error(`Expected string from decompress, got ${typeof decompressed}`);
    }
    if (decompressed !== originalStr) {
      throw new Error('Uint8Array roundtrip content mismatch');
    }
  });
}

// 50 tests: Delta encode/decode random strings. Verify roundtrip.
for (let i = 0; i < 50; i++) {
  test(`delta encode/decode random - ${i}`, () => {
    const rjs = new Rjs({ clientId: 52000 + i });
    const compressor = rjs.compressor;
    const original = randomString(randomInt(5, 50));
    const modified = randomString(randomInt(5, 50));
    const delta = compressor.deltaEncode(original, modified);
    const applied = compressor.deltaDecode(original, delta);
    if (applied !== modified) {
      throw new Error(`Delta roundtrip mismatch: expected "${modified}" got "${applied}"`);
    }
  });
}

// 50 tests: Compress empty string - should return input.
for (let i = 0; i < 50; i++) {
  test(`compress empty string - ${i}`, () => {
    const rjs = new Rjs({ clientId: 53000 + i });
    const compressor = rjs.compressor;
    const result = compressor.compress('');
    if (result !== '') {
      throw new Error(`Expected empty string, got "${result}"`);
    }
  });
}

// 50 tests: Compress very long string (10000+ chars). Verify roundtrip.
for (let i = 0; i < 50; i++) {
  test(`compress very long string - ${i}`, () => {
    const rjs = new Rjs({ clientId: 54000 + i });
    const compressor = rjs.compressor;
    const original = randomString(10000 + randomInt(0, 5000));
    const compressed = compressor.compress(original);
    const decompressed = compressor.decompress(compressed);
    if (decompressed !== original) {
      throw new Error('Long string roundtrip mismatch');
    }
  });
}

// ============================================================
// PERFORMANCE SANITY TESTS (250 tests)
// ============================================================

// 50 tests: 1000 sequential inserts in under 500ms.
for (let i = 0; i < 50; i++) {
  test(`1000 sequential inserts perf - ${i}`, () => {
    const rjs = new Rjs({ clientId: 60000 + i });
    const text = rjs.getText('perf');
    const start = Date.now();
    for (let j = 0; j < 1000; j++) {
      text.insert(text.length, randomString(1));
    }
    const elapsed = Date.now() - start;
    if (elapsed > 500) throw new Error(`Too slow: ${elapsed}ms`);
  });
}

// 50 tests: 1000 random map sets in under 500ms.
for (let i = 0; i < 50; i++) {
  test(`1000 random map sets perf - ${i}`, () => {
    const rjs = new Rjs({ clientId: 61000 + i });
    const map = rjs.getMap('perf');
    const start = Date.now();
    for (let j = 0; j < 1000; j++) {
      map.set(`k${j}`, randomString(5));
    }
    const elapsed = Date.now() - start;
    if (elapsed > 500) throw new Error(`Too slow: ${elapsed}ms`);
  });
}

// 50 tests: 1000 random array ops in under 500ms.
for (let i = 0; i < 50; i++) {
  test(`1000 random array ops perf - ${i}`, () => {
    const rjs = new Rjs({ clientId: 62000 + i });
    const arr = rjs.getArray('perf');
    const start = Date.now();
    for (let j = 0; j < 1000; j++) {
      if (rand() < 0.6 || arr.length === 0) {
        arr.push(randomInt(0, 9999));
      } else {
        const pos = randomInt(0, arr.length - 1);
        arr.delete(pos, 1);
      }
    }
    const elapsed = Date.now() - start;
    if (elapsed > 500) throw new Error(`Too slow: ${elapsed}ms`);
  });
}

// 50 tests: 500 encode/decode roundtrips in under 1000ms.
for (let i = 0; i < 50; i++) {
  test(`500 encode/decode roundtrips perf - ${i}`, () => {
    const rjs = new Rjs({ clientId: 63000 + i });
    const text = rjs.getText('perf');
    text.insert(0, randomString(50));
    const start = Date.now();
    for (let j = 0; j < 500; j++) {
      const encoded = rjs.serializer.encodeDocument(rjs.crdt);
      const rjs2 = new Rjs({ clientId: 70000 + j });
      rjs2.serializer.decodeDocument(encoded, rjs2.crdt);
    }
    const elapsed = Date.now() - start;
    if (elapsed > 1000) throw new Error(`Too slow: ${elapsed}ms`);
  });
}

// 50 tests: 100 sync operations in under 500ms.
for (let i = 0; i < 50; i++) {
  test(`100 sync operations perf - ${i}`, () => {
    const rjsA = new Rjs({ clientId: 64000 + i });
    const rjsB = new Rjs({ clientId: 64000 + i + 50000 });
    rjsA.getText('sync').insert(0, 'init');
    rjsB.getText('sync').insert(0, 'init');
    const start = Date.now();
    for (let j = 0; j < 100; j++) {
      rjsA.getText('sync').insert(rjsA.getText('sync').length, randomString(1));
      const update = rjsA.encodeStateAsUpdate('sync');
      rjsB.applyUpdate(update);
    }
    const elapsed = Date.now() - start;
    if (elapsed > 500) throw new Error(`Too slow: ${elapsed}ms`);
  });
}

// ============================================================
// SUMMARY
// ============================================================

console.log(`\n=== Stress Test Part 3: Edge Cases & Stress ===`);
console.log(`Total: ${passed + failed}`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (errors.length > 0) {
  console.log(`\nFirst 10 errors:`);
  errors.slice(0, 10).forEach(e => console.log(`  FAIL: ${e.name} - ${e.error}`));
}

process.exit(failed > 0 ? 1 : 0);
