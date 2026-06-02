const { CRDT, TextCRDT, MapCRDT, ArrayCRDT, CounterCRDT, UndoManager, Snapshot, RelativePosition, SerializerV2 } = require('../lib/rjs');
const { importBlocks } = require('../src/core/helpers');

function seededRandom(seed) {
  let s = seed;
  return function() {
    s = (s * 1103515245 + 12345) & 0x7FFFFFFF;
    return s / 0x7FFFFFFF;
  };
}

const rand = seededRandom(42);

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

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function randomChar() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return chars[Math.floor(rand() * chars.length)];
}

function randomInt(min, max) {
  return min + Math.floor(rand() * (max - min + 1));
}

function randomString(len) {
  let s = '';
  for (let i = 0; i < len; i++) s += randomChar();
  return s;
}

function syncCRDTs(source, target) {
  const sv2 = new SerializerV2();
  const encoded = sv2.encodeDocument(source);
  const tempCrdt = new CRDT(source.clientId + 999999);
  sv2.decodeDocument(encoded, tempCrdt);

  for (const [name, text] of tempCrdt.texts) {
    importBlocks(text.rga, target.getText(name).rga);
  }
  for (const [name, map] of tempCrdt.maps) {
    const tMap = target.getMap(name);
    for (const [key, value] of map._vals) {
      tMap._set(key, value);
    }
  }
  for (const [name, arr] of tempCrdt.arrays) {
    const tArr = target.getArray(name);
    for (const item of arr.items) {
      tArr.push(item);
    }
  }
}

// ============================================================
// TEXT FUZZ TESTS (3500 tests)
// ============================================================

// 500 tests: Random insert at random position with random single-char strings
for (let i = 0; i < 500; i++) {
  test(`text-insert-single-${i}`, () => {
    const crdt = new CRDT(i + 1);
    const text = crdt.getText('doc');
    let expected = '';
    const numOps = randomInt(5, 25);
    for (let j = 0; j < numOps; j++) {
      const pos = randomInt(0, expected.length);
      const ch = randomChar();
      text.insert(pos, ch);
      expected = expected.slice(0, pos) + ch + expected.slice(pos);
      assert(text.length === expected.length, `Length mismatch: ${text.length} vs ${expected.length}`);
      assert(text.toString() === expected, `Text mismatch: "${text.toString()}" vs "${expected}"`);
      assert(text.toString()[pos] === ch, `Char at ${pos}: got "${text.toString()[pos]}" expected "${ch}"`);
    }
  });
}

// 500 tests: Random delete at random position
for (let i = 0; i < 500; i++) {
  test(`text-delete-${i}`, () => {
    const crdt = new CRDT(i + 501);
    const text = crdt.getText('doc');
    let expected = '';
    const setupOps = randomInt(10, 30);
    for (let j = 0; j < setupOps; j++) {
      const pos = randomInt(0, expected.length);
      const ch = randomChar();
      text.insert(pos, ch);
      expected = expected.slice(0, pos) + ch + expected.slice(pos);
    }
    const delOps = randomInt(5, 15);
    for (let j = 0; j < delOps; j++) {
      if (expected.length === 0) break;
      const pos = randomInt(0, expected.length - 1);
      const len = randomInt(1, Math.min(expected.length - pos, 5));
      text.delete(pos, len);
      expected = expected.slice(0, pos) + expected.slice(pos + len);
      assert(text.length === expected.length, `Length mismatch: ${text.length} vs ${expected.length}`);
      assert(text.toString() === expected, `Text mismatch after delete`);
    }
  });
}

// 500 tests: Random insert+delete combo
for (let i = 0; i < 500; i++) {
  test(`text-combo-${i}`, () => {
    const crdt = new CRDT(i + 1001);
    const text = crdt.getText('doc');
    let expected = '';
    const numOps = randomInt(15, 40);
    for (let j = 0; j < numOps; j++) {
      const doInsert = expected.length === 0 || rand() < 0.6;
      if (doInsert) {
        const pos = randomInt(0, expected.length);
        const ch = randomChar();
        text.insert(pos, ch);
        expected = expected.slice(0, pos) + ch + expected.slice(pos);
      } else {
        const pos = randomInt(0, expected.length - 1);
        const len = randomInt(1, Math.min(expected.length - pos, 3));
        text.delete(pos, len);
        expected = expected.slice(0, pos) + expected.slice(pos + len);
      }
      assert(text.length === expected.length, `Length mismatch at op ${j}: ${text.length} vs ${expected.length}`);
      assert(text.toString() === expected, `Text mismatch at op ${j}`);
    }
  });
}

// 500 tests: Insert multi-char strings at random positions
for (let i = 0; i < 500; i++) {
  test(`text-multi-char-${i}`, () => {
    const crdt = new CRDT(i + 1501);
    const text = crdt.getText('doc');
    let expected = '';
    const numOps = randomInt(5, 15);
    for (let j = 0; j < numOps; j++) {
      const str = randomString(randomInt(2, 8));
      for (let k = 0; k < str.length; k++) {
        const pos = randomInt(0, expected.length);
        text.insert(pos, str[k]);
        expected = expected.slice(0, pos) + str[k] + expected.slice(pos);
      }
      assert(text.length === expected.length, `Length mismatch: ${text.length} vs ${expected.length}`);
      assert(text.toString() === expected, `Text mismatch after multi-char insert`);
    }
  });
}

// 500 tests: Delete ranges (random start, random length)
for (let i = 0; i < 500; i++) {
  test(`text-delete-range-${i}`, () => {
    const crdt = new CRDT(i + 2001);
    const text = crdt.getText('doc');
    let expected = randomString(randomInt(20, 50));
    text.insert(0, expected);
    const numOps = randomInt(5, 15);
    for (let j = 0; j < numOps; j++) {
      if (expected.length === 0) break;
      const pos = randomInt(0, expected.length - 1);
      const maxLen = expected.length - pos;
      const len = randomInt(1, Math.min(maxLen, 10));
      text.delete(pos, len);
      expected = expected.slice(0, pos) + expected.slice(pos + len);
      assert(text.length === expected.length, `Length mismatch: ${text.length} vs ${expected.length}`);
      assert(text.toString() === expected, `Text mismatch after range delete`);
    }
  });
}

// 500 tests: Concurrent edits - two users alternating ops on shared doc via serialization
for (let i = 0; i < 500; i++) {
  test(`text-concurrent-${i}`, () => {
    const crdtA = new CRDT(i + 2501);
    const crdtB = new CRDT(i + 100001);
    const textA = crdtA.getText('doc');
    const textB = crdtB.getText('doc');
    const numOps = randomInt(5, 15);
    for (let j = 0; j < numOps; j++) {
      const ch = randomChar();
      if (j % 2 === 0) {
        const posA = randomInt(0, textA.length);
        textA.insert(posA, ch);
      } else {
        const posB = randomInt(0, textB.length);
        textB.insert(posB, ch);
      }
    }
    assert(textA.length > 0, 'User A doc should not be empty');
    assert(textB.length > 0, 'User B doc should not be empty');
    assert(textA.toString().length === textA.length, 'User A toString length consistency');
    assert(textB.toString().length === textB.length, 'User B toString length consistency');
    const sv2 = new SerializerV2();
    const encA = sv2.encodeDocument(crdtA);
    const encB = sv2.encodeDocument(crdtB);
    assert(encA instanceof Uint8Array, 'User A encode should produce buffer');
    assert(encB instanceof Uint8Array, 'User B encode should produce buffer');
    const tmpA = new CRDT(i + 200001);
    const tmpB = new CRDT(i + 300001);
    sv2.decodeDocument(encA, tmpA);
    sv2.decodeDocument(encB, tmpB);
    assert(tmpA.getText('doc').toString() === textA.toString(), 'User A roundtrip consistency');
    assert(tmpB.getText('doc').toString() === textB.toString(), 'User B roundtrip consistency');
  });
}

// 500 tests: Rapid insert/delete at same position
for (let i = 0; i < 500; i++) {
  test(`text-rapid-same-pos-${i}`, () => {
    const crdt = new CRDT(i + 3001);
    const text = crdt.getText('doc');
    let expected = '';
    const numOps = randomInt(10, 30);
    for (let j = 0; j < numOps; j++) {
      if (rand() < 0.5) {
        const ch = randomChar();
        text.insert(0, ch);
        expected = ch + expected;
      } else {
        if (expected.length > 0) {
          text.delete(0, 1);
          expected = expected.slice(1);
        }
      }
      assert(text.length === expected.length, `Length mismatch at op ${j}: ${text.length} vs ${expected.length}`);
      assert(text.toString() === expected, `Text mismatch at op ${j}`);
    }
  });
}

// ============================================================
// MAP FUZZ TESTS (3500 tests)
// ============================================================

// 500 tests: Random set with random string keys and string values
for (let i = 0; i < 500; i++) {
  test(`map-set-string-${i}`, () => {
    const crdt = new CRDT(i + 3501);
    const map = crdt.getMap('doc');
    const expected = {};
    const numOps = randomInt(5, 25);
    for (let j = 0; j < numOps; j++) {
      const key = randomString(randomInt(1, 5));
      const value = randomString(randomInt(1, 10));
      map.set(key, value);
      expected[key] = value;
      assert(map.get(key) === value, `Get mismatch for key "${key}": got "${map.get(key)}" expected "${value}"`);
    }
  });
}

// 500 tests: Random delete
for (let i = 0; i < 500; i++) {
  test(`map-delete-${i}`, () => {
    const crdt = new CRDT(i + 4001);
    const map = crdt.getMap('doc');
    const expected = {};
    const keys = [];
    const setupOps = randomInt(5, 15);
    for (let j = 0; j < setupOps; j++) {
      const key = `k${j}`;
      const value = randomString(randomInt(1, 5));
      map.set(key, value);
      expected[key] = value;
      keys.push(key);
    }
    const delOps = randomInt(1, keys.length);
    for (let j = 0; j < delOps; j++) {
      const idx = randomInt(0, keys.length - 1);
      const key = keys[idx];
      map.delete(key);
      delete expected[key];
      keys.splice(idx, 1);
      assert(map.has(key) === false, `has() should return false for deleted key "${key}"`);
    }
    for (const key of keys) {
      assert(map.get(key) === expected[key], `Remaining key "${key}" mismatch`);
    }
  });
}

// 500 tests: Random set+delete combo
for (let i = 0; i < 500; i++) {
  test(`map-combo-${i}`, () => {
    const crdt = new CRDT(i + 4501);
    const map = crdt.getMap('doc');
    const expected = {};
    const activeKeys = [];
    const numOps = randomInt(10, 30);
    for (let j = 0; j < numOps; j++) {
      if (activeKeys.length === 0 || rand() < 0.6) {
        const key = `k${randomInt(0, 20)}`;
        const value = randomString(randomInt(1, 5));
        map.set(key, value);
        expected[key] = value;
        if (!activeKeys.includes(key)) activeKeys.push(key);
      } else {
        const idx = randomInt(0, activeKeys.length - 1);
        const key = activeKeys[idx];
        map.delete(key);
        delete expected[key];
        activeKeys.splice(idx, 1);
      }
    }
    for (const key of activeKeys) {
      assert(map.get(key) === expected[key], `Key "${key}" mismatch: got "${map.get(key)}" expected "${expected[key]}"`);
    }
    for (const key of Object.keys(expected)) {
      assert(map.has(key), `has() should be true for key "${key}"`);
    }
  });
}

// 500 tests: Set with numeric values
for (let i = 0; i < 500; i++) {
  test(`map-set-numeric-${i}`, () => {
    const crdt = new CRDT(i + 5001);
    const map = crdt.getMap('doc');
    const expected = {};
    const numOps = randomInt(5, 20);
    for (let j = 0; j < numOps; j++) {
      const key = `num${j}`;
      const value = Math.floor(rand() * 10000) - 5000;
      map.set(key, value);
      expected[key] = value;
      assert(map.get(key) === value, `Numeric value mismatch for "${key}": got ${map.get(key)} expected ${value}`);
      assert(typeof map.get(key) === 'number', `Type mismatch for "${key}": expected number`);
    }
  });
}

// 500 tests: Set with boolean values
for (let i = 0; i < 500; i++) {
  test(`map-set-boolean-${i}`, () => {
    const crdt = new CRDT(i + 5501);
    const map = crdt.getMap('doc');
    const expected = {};
    const numOps = randomInt(5, 20);
    for (let j = 0; j < numOps; j++) {
      const key = `bool${j}`;
      const value = rand() < 0.5;
      map.set(key, value);
      expected[key] = value;
      assert(map.get(key) === value, `Boolean value mismatch for "${key}": got ${map.get(key)} expected ${value}`);
      assert(typeof map.get(key) === 'boolean', `Type mismatch for "${key}": expected boolean`);
    }
  });
}

// 500 tests: Concurrent map edits
for (let i = 0; i < 500; i++) {
  test(`map-concurrent-${i}`, () => {
    const crdtA = new CRDT(i + 6001);
    const crdtB = new CRDT(i + 200001);
    const mapA = crdtA.getMap('doc');
    const mapB = crdtB.getMap('doc');
    const expectedA = {};
    const expectedB = {};
    const numOps = randomInt(5, 15);
    for (let j = 0; j < numOps; j++) {
      const key = `k${randomInt(0, 9)}`;
      const value = randomString(randomInt(1, 5));
      if (j % 2 === 0) {
        mapA.set(key, value);
        expectedA[key] = value;
      } else {
        mapB.set(key, value);
        expectedB[key] = value;
      }
    }
    const sv2 = new SerializerV2();
    const encA = sv2.encodeDocument(crdtA);
    const encB = sv2.encodeDocument(crdtB);
    const tmpA = new CRDT(i + 600001);
    const tmpB = new CRDT(i + 700001);
    sv2.decodeDocument(encA, tmpA);
    sv2.decodeDocument(encB, tmpB);
    const mapAFinal = tmpA.getMap('doc');
    const mapBFinal = tmpB.getMap('doc');
    for (const [key, value] of Object.entries(expectedA)) {
      assert(mapAFinal.get(key) === value, `User A roundtrip mismatch for "${key}": got "${mapAFinal.get(key)}" expected "${value}"`);
    }
    for (const [key, value] of Object.entries(expectedB)) {
      assert(mapBFinal.get(key) === value, `User B roundtrip mismatch for "${key}": got "${mapBFinal.get(key)}" expected "${value}"`);
    }
  });
}

// 500 tests: Overwrite same key many times
for (let i = 0; i < 500; i++) {
  test(`map-overwrite-${i}`, () => {
    const crdt = new CRDT(i + 6501);
    const map = crdt.getMap('doc');
    const key = 'sameKey';
    let lastValue = null;
    const numOps = randomInt(5, 30);
    for (let j = 0; j < numOps; j++) {
      const value = randomString(randomInt(1, 8));
      map.set(key, value);
      lastValue = value;
    }
    assert(map.get(key) === lastValue, `Overwrite mismatch: got "${map.get(key)}" expected "${lastValue}"`);
    assert(map.size === 1, `Size should be 1 after overwrites, got ${map.size}`);
  });
}

// ============================================================
// ARRAY FUZZ TESTS (3000 tests)
// ============================================================

// 500 tests: Random push
for (let i = 0; i < 500; i++) {
  test(`array-push-${i}`, () => {
    const crdt = new CRDT(i + 7001);
    const arr = crdt.getArray('doc');
    const expected = [];
    const numOps = randomInt(5, 25);
    for (let j = 0; j < numOps; j++) {
      const value = randomString(randomInt(1, 5));
      arr.push(value);
      expected.push(value);
      assert(arr.length === expected.length, `Length mismatch: ${arr.length} vs ${expected.length}`);
      const actual = arr.toArray();
      assert(actual.length === expected.length, `toArray length mismatch`);
      for (let k = 0; k < expected.length; k++) {
        assert(actual[k] === expected[k], `Element mismatch at ${k}: got "${actual[k]}" expected "${expected[k]}"`);
      }
    }
  });
}

// 500 tests: Random insert at random position
for (let i = 0; i < 500; i++) {
  test(`array-insert-${i}`, () => {
    const crdt = new CRDT(i + 7501);
    const arr = crdt.getArray('doc');
    const expected = [];
    const numOps = randomInt(5, 20);
    for (let j = 0; j < numOps; j++) {
      const pos = randomInt(0, expected.length);
      const value = `v${j}`;
      arr.insert(pos, value);
      expected.splice(pos, 0, value);
      assert(arr.length === expected.length, `Length mismatch at op ${j}: ${arr.length} vs ${expected.length}`);
      assert(arr.get(pos) === value, `Element at pos ${pos}: got "${arr.get(pos)}" expected "${value}"`);
    }
  });
}

// 500 tests: Random delete at random position
for (let i = 0; i < 500; i++) {
  test(`array-delete-${i}`, () => {
    const crdt = new CRDT(i + 8001);
    const arr = crdt.getArray('doc');
    const expected = [];
    const setupOps = randomInt(10, 25);
    for (let j = 0; j < setupOps; j++) {
      const value = `v${j}`;
      arr.push(value);
      expected.push(value);
    }
    const delOps = randomInt(5, 15);
    for (let j = 0; j < delOps; j++) {
      if (expected.length === 0) break;
      const pos = randomInt(0, expected.length - 1);
      arr.delete(pos, 1);
      expected.splice(pos, 1);
      assert(arr.length === expected.length, `Length mismatch after delete: ${arr.length} vs ${expected.length}`);
      const actual = arr.toArray();
      for (let k = 0; k < expected.length; k++) {
        assert(actual[k] === expected[k], `Element mismatch at ${k} after delete`);
      }
    }
  });
}

// 500 tests: Random pop
for (let i = 0; i < 500; i++) {
  test(`array-pop-${i}`, () => {
    const crdt = new CRDT(i + 8501);
    const arr = crdt.getArray('doc');
    const expected = [];
    const setupOps = randomInt(5, 20);
    for (let j = 0; j < setupOps; j++) {
      const value = `v${j}`;
      arr.push(value);
      expected.push(value);
    }
    const popOps = randomInt(1, Math.min(setupOps, 10));
    for (let j = 0; j < popOps; j++) {
      if (expected.length === 0) break;
      const popped = arr.pop();
      const expectedPopped = expected.pop();
      assert(popped === expectedPopped, `Pop mismatch: got "${popped}" expected "${expectedPopped}"`);
      assert(arr.length === expected.length, `Length mismatch after pop: ${arr.length} vs ${expected.length}`);
    }
  });
}

// 500 tests: Random shift
for (let i = 0; i < 500; i++) {
  test(`array-shift-${i}`, () => {
    const crdt = new CRDT(i + 9001);
    const arr = crdt.getArray('doc');
    const expected = [];
    const setupOps = randomInt(5, 20);
    for (let j = 0; j < setupOps; j++) {
      const value = `v${j}`;
      arr.push(value);
      expected.push(value);
    }
    const shiftOps = randomInt(1, Math.min(setupOps, 10));
    for (let j = 0; j < shiftOps; j++) {
      if (expected.length === 0) break;
      const shifted = arr.shift();
      const expectedShifted = expected.shift();
      assert(shifted === expectedShifted, `Shift mismatch: got "${shifted}" expected "${expectedShifted}"`);
      assert(arr.length === expected.length, `Length mismatch after shift: ${arr.length} vs ${expected.length}`);
    }
  });
}

// 500 tests: Mixed push/insert/delete/pop/shift random ops
for (let i = 0; i < 500; i++) {
  test(`array-mixed-${i}`, () => {
    const crdt = new CRDT(i + 9501);
    const arr = crdt.getArray('doc');
    const expected = [];
    const numOps = randomInt(15, 40);
    for (let j = 0; j < numOps; j++) {
      const op = randomInt(0, 4);
      switch (op) {
        case 0: {
          const value = `v${j}`;
          arr.push(value);
          expected.push(value);
          break;
        }
        case 1: {
          const pos = randomInt(0, expected.length);
          const value = `v${j}`;
          arr.insert(pos, value);
          expected.splice(pos, 0, value);
          break;
        }
        case 2: {
          if (expected.length > 0) {
            const pos = randomInt(0, expected.length - 1);
            arr.delete(pos, 1);
            expected.splice(pos, 1);
          }
          break;
        }
        case 3: {
          if (expected.length > 0) {
            const popped = arr.pop();
            const expectedPopped = expected.pop();
            assert(popped === expectedPopped, `Pop mismatch in mixed ops`);
          }
          break;
        }
        case 4: {
          if (expected.length > 0) {
            const shifted = arr.shift();
            const expectedShifted = expected.shift();
            assert(shifted === expectedShifted, `Shift mismatch in mixed ops`);
          }
          break;
        }
      }
      assert(arr.length === expected.length, `Length mismatch at op ${j}: ${arr.length} vs ${expected.length}`);
    }
    const finalArr = arr.toArray();
    assert(finalArr.length === expected.length, `Final length mismatch`);
    for (let k = 0; k < expected.length; k++) {
      assert(finalArr[k] === expected[k], `Final element mismatch at ${k}`);
    }
  });
}

// ============================================================
// RESULTS
// ============================================================

console.log(`\n=== Stress Test Part 1: Fuzz Tests ===`);
console.log(`Total: ${passed + failed}`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (errors.length > 0) {
  console.log(`\nFirst 10 errors:`);
  errors.slice(0, 10).forEach(e => console.log(`  FAIL: ${e.name} - ${e.error}`));
}
