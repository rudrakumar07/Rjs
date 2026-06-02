const Rjs = require('./lib/rjs');

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}`);
    failed++;
  }
}

function assertEqual(actual, expected, name) {
  if (actual === expected) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name} (expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)})`);
    failed++;
  }
}

function assertDeepEqual(actual, expected, name) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name} (expected: ${e}, got: ${a})`);
    failed++;
  }
}

console.log('=== Rjs Comprehensive Test Suite ===\n');

// 1. Core CRDT: Text operations
console.log('[1] Text CRDT Operations');
const rjs1 = new Rjs({ clientId: 1 });
const text1 = rjs1.getText('doc1');
text1.insert(0, 'Hello');
text1.insert(5, ' World');
text1.insert(11, '!');
assertEqual(text1.toString(), 'Hello World!', 'Basic text insert');
assertEqual(text1.length, 12, 'Text length after insert');

text1.delete(5, 6);
assertEqual(text1.toString(), 'Hello!', 'Text delete in middle');
assertEqual(text1.length, 6, 'Text length after delete');

text1.insert(0, 'Say ');
assertEqual(text1.toString(), 'Say Hello!', 'Text insert at beginning');
text1.insert(9, ' Everyone');
assertEqual(text1.toString(), 'Say Hello Everyone!', 'Text insert at position 9');
console.log();

// 2. CRDT Transaction API
console.log('[2] Transaction API');
const rjs2 = new Rjs({ clientId: 2 });
rjs2.transact((txn) => {
  txn.textInsert('doc2', 0, 'Transaction');
  txn.textInsert('doc2', 11, ' Test');
});
const text2 = rjs2.getText('doc2');
assertEqual(text2.toString(), 'Transaction Test', 'Transaction batch insert');

rjs2.transact((txn) => {
  txn.textDelete('doc2', 0, 11);
});
assertEqual(text2.toString(), ' Test', 'Transaction delete (remaining text)');
console.log();

// 3. Map CRDT
console.log('[3] Map CRDT');
const rjs3 = new Rjs({ clientId: 3 });
const map3 = rjs3.getMap('config');
map3.set('theme', 'dark');
map3.set('fontSize', 14);
map3.set('spellcheck', false);
assertEqual(map3.get('theme'), 'dark', 'Map set/get string');
assertEqual(map3.get('fontSize'), 14, 'Map set/get number');
assertEqual(map3.get('spellcheck'), false, 'Map set/get boolean');
assertEqual(map3.has('theme'), true, 'Map has key');
assertEqual(map3.has('missing'), false, 'Map missing key');

const keys = map3.keys();
assert(keys.includes('theme') && keys.includes('fontSize') && keys.includes('spellcheck'), 'Map keys');
assertEqual(keys.length, 3, 'Map key count');

map3.delete('fontSize');
assertEqual(map3.has('fontSize'), false, 'Map delete key');
assertEqual(map3.keys().length, 2, 'Map key count after delete');

const json3 = map3.toJSON();
assertEqual(json3.theme, 'dark', 'Map toJSON');
assertEqual(json3.spellcheck, false, 'Map toJSON boolean');
console.log();

// 4. Array CRDT
console.log('[4] Array CRDT');
const rjs4 = new Rjs({ clientId: 4 });
const arr4 = rjs4.getArray('items');
arr4.push('a');
arr4.push('b');
arr4.push('c');
assertEqual(arr4.length, 3, 'Array push');
assertEqual(arr4.get(0), 'a', 'Array get');
assertEqual(arr4.get(2), 'c', 'Array get last');

arr4.insert(1, 'x');
assertEqual(arr4.length, 4, 'Array insert');
assertEqual(arr4.get(1), 'x', 'Array insert position');
assertEqual(arr4.get(2), 'b', 'Array shift after insert');

arr4.delete(2, 1);
assertEqual(arr4.length, 3, 'Array delete');
assertEqual(arr4.get(2), 'c', 'Array after delete');

arr4.pop();
assertEqual(arr4.length, 2, 'Array pop');

const arr4Copy = arr4.toArray();
assertEqual(arr4Copy.length, 2, 'Array toArray');
assertEqual(arr4Copy[0], 'a', 'Array toArray content');
console.log();

// 5. Counter CRDT
console.log('[5] Counter CRDT');
const rjs5 = new Rjs({ clientId: 5 });
const counter5 = rjs5.getCounter('visitors');
assertEqual(counter5.get(), 0, 'Counter initial value');
counter5.increment();
assertEqual(counter5.get(), 1, 'Counter increment');
counter5.add(5);
assertEqual(counter5.get(), 6, 'Counter add');
counter5.decrement();
assertEqual(counter5.get(), 5, 'Counter decrement');
console.log();

// 6. Serialization
console.log('[6] Serialization');
const rjs6a = new Rjs({ clientId: 6 });
rjs6a.transact((txn) => {
  txn.textInsert('doc', 0, 'Serialization Test');
});
rjs6a.getMap('meta').set('author', 'Rjs');
rjs6a.getCounter('count').add(42);

const encoded = rjs6a.serializer.encodeDocument(rjs6a.crdt);
assert(encoded instanceof Uint8Array, 'Encode returns Uint8Array');
assert(encoded.length > 0, 'Encoded data has content');

const rjs6b = new Rjs({ clientId: 7 });
rjs6b.serializer.decodeDocument(encoded, rjs6b.crdt);
const decodedText = rjs6b.getText('doc');
assertEqual(decodedText.toString(), 'Serialization Test', 'Decode text');
assertEqual(rjs6b.getMap('meta').get('author'), 'Rjs', 'Decode map');
assertEqual(rjs6b.getCounter('count').get(), 42, 'Decode counter');
console.log();

// 7. EncodeStateAsUpdate / ApplyUpdate
console.log('[7] Update Encoding');
const rjs7a = new Rjs({ clientId: 8 });
rjs7a.getText('doc').insert(0, 'Update Test');
const update = rjs7a.encodeStateAsUpdate('doc');
assert(update !== null, 'Encode state as update');

const rjs7b = new Rjs({ clientId: 9 });
rjs7b.applyUpdate(update);
assertEqual(rjs7b.getText('doc').toString(), 'Update Test', 'Apply update');
console.log();

// 8. Garbage Collection
console.log('[8] Garbage Collection');
const rjs8 = new Rjs({ clientId: 10, tombstoneThreshold: 1, ageThreshold: 0 });
const text8 = rjs8.getText('gc-test');
text8.insert(0, 'ABCDEFGHIJ');
text8.delete(0, 5);
const gcStats = rjs8.gc.getStats();
assert(gcStats.currentTombstones >= 0, 'GC tracks tombstones');
const collected = rjs8.runGC();
assert(typeof collected === 'number', 'GC runs successfully');
console.log();

// 9. Compression
console.log('[9] Compression');
const rjs9 = new Rjs({ clientId: 11 });
const compressor = rjs9.compressor;
const original = 'Hello World! This is a test of Rjs compression. '.repeat(10);
const compressed = compressor.compress(original);
const decompressed = compressor.decompress(compressed);
assertEqual(typeof decompressed, 'string', 'Compression returns string');
assertEqual(decompressed.length, original.length, 'Compression preserves length');
assert(decompressed.startsWith('Hello World!'), 'Compression preserves content start');
assert(decompressed.endsWith('compression. '), 'Compression preserves content end');

const delta = compressor.deltaEncode('Hello World', 'Hello Rjs World');
assertEqual(delta.start, 6, 'Delta encoding start');
assertEqual(delta.remove, 0, 'Delta remove zero (World common suffix)');
assertEqual(delta.insert, 'Rjs ', 'Delta encoding insert (includes trailing space)');

const applied = compressor.deltaDecode('Hello World', delta);
assertEqual(applied, 'Hello Rjs World', 'Delta decode');
console.log();

// 10. Arena Memory
console.log('[10] Arena / Memory');
const rjs10 = new Rjs({ clientId: 12 });
const arenaStr = rjs10.arena.intern('repeated-string');
const arenaStr2 = rjs10.arena.intern('repeated-string');
const arenaStr3 = rjs10.arena.intern('unique-string');
assert(typeof arenaStr === 'number', 'Arena intern returns number');
assertEqual(arenaStr, arenaStr2, 'Arena deduplication');
assert(rjs10.arena.getString(arenaStr) === 'repeated-string', 'Arena get string');
console.log();

// 11. Performance Optimizer
console.log('[11] Performance Optimizer');
const rjs11 = new Rjs({ clientId: 13 });
const perf = rjs11.enablePerformanceOptimizer({});
assert(perf !== null, 'Performance optimizer created');
const cachedResult = perf.cacheResult('test-key', () => 42);
assertEqual(cachedResult, 42, 'Cache result');
const cacheStats = perf.getStats();
assert(cacheStats.cacheStats.hits >= 0, 'Cache stats available');
console.log();

// 12. File Persistence
console.log('[12] File Persistence');
const rjs12 = new Rjs({ clientId: 14 });
rjs12.getText('persist-doc').insert(0, 'Persistence Test');

try {
  const fs = require('fs');
  const path = require('path');
  const tmpFile = path.join(require('os').tmpdir(), `rjs-test-${Date.now()}.bin`);
  rjs12.saveToFile(tmpFile);
  assert(fs.existsSync(tmpFile), 'Save to file');

  const rjs12b = new Rjs({ clientId: 15 });
  rjs12b.loadFromFile(tmpFile);
  assertEqual(rjs12b.getText('persist-doc').toString(), 'Persistence Test', 'Load from file');
  fs.unlinkSync(tmpFile);
} catch (e) {
  assert(false, `File persistence: ${e.message}`);
}
console.log();

// 13. Multiple Data Types
console.log('[13] Multiple Data Types Combined');
const rjs13 = new Rjs({ clientId: 16 });
rjs13.transact((txn) => {
  txn.textInsert('content', 0, 'Combined types work');
  txn.mapSet('state', 'completed', true);
  txn.counterAdd('score', 100);
  txn.arrayInsert('tags', 0, 'important');
  txn.arrayInsert('tags', 1, 'tested');
});
assertEqual(rjs13.getText('content').toString(), 'Combined types work', 'Combined text');
assertEqual(rjs13.getMap('state').get('completed'), true, 'Combined map');
assertEqual(rjs13.getCounter('score').get(), 100, 'Combined counter');
assertEqual(rjs13.getArray('tags').length, 2, 'Combined array');
console.log();

// 14. Transaction Operations List
console.log('[14] Transaction Operations');
const rjs14 = new Rjs({ clientId: 17 });
const ops = rjs14.transact((txn) => {
  txn.textInsert('log', 0, 'Operation');
  txn.textInsert('log', 9, ' List');
});
assert(Array.isArray(ops), 'Transact returns operations array');
assertEqual(ops.length, 2, 'Two operations returned');
assertEqual(ops[0].type, 'text-insert', 'Operation type correct');
console.log();

// 15. Observe / Events
console.log('[15] Observe Events');
const rjs15 = new Rjs({ clientId: 18 });
let observed = false;
const unsub = rjs15.observe('update', () => { observed = true; });
rjs15.getText('events').insert(0, 'Trigger');
assert(observed, 'Observe callback fires');
unsub();
let secondObserved = false;
rjs15.observe('update', () => { secondObserved = true; });
rjs15.getText('events').insert(6, ' Again');
assert(secondObserved, 'Second observer');
console.log();

// 16. Remote Operations
console.log('[16] Remote Operations');
const rjs16 = new Rjs({ clientId: 19 });
rjs16.crdt.applyRemoteOps([
  { type: 'text-insert', name: 'remote-doc', pos: 0, content: 'Remote content' }
]);
assertEqual(rjs16.getText('remote-doc').toString(), 'Remote content', 'Remote ops applied');

rjs16.crdt.applyRemoteOps([
  { type: 'map-set', name: 'remote-map', key: 'source', value: 'network' }
]);
assertEqual(rjs16.getMap('remote-map').get('source'), 'network', 'Remote map op');
console.log();

// 17. Undo/Redo Manager
console.log('[17] Undo/Redo Manager');
const rjs17 = new Rjs({ clientId: 20 });
const um = rjs17.enableUndoManager({ maxStackSize: 50 });
assert(um !== null, 'UndoManager created');

const text17 = rjs17.getText('undo-doc');
text17.insert(0, 'Hello World');
assertEqual(text17.toString(), 'Hello World', 'Initial text');

um.undo();
assertEqual(text17.toString(), '', 'Undo text insert');

um.redo();
assertEqual(text17.toString(), 'Hello World', 'Redo text insert');

um.undo();
assertEqual(text17.toString(), '', 'Undo after redo');

text17.insert(0, 'Hello');
um.stopCapturing();
text17.insert(5, ' World');
assertEqual(text17.toString(), 'Hello World', 'Text after stopCapturing');

um.capturing = true;
um.undo();
assertEqual(text17.toString(), ' World', 'Undo reverts captured insert only (Hello), stopCapturing insert remains');

um.capturing = true;
text17.insert(0, 'Hello');
assertEqual(text17.toString(), 'Hello World', 'After prepend');

um.undo();
assertEqual(text17.toString(), ' World', 'Undo prepend');

um.redo();
assertEqual(text17.toString(), 'Hello World', 'Redo prepend');

um.undo();
assertEqual(text17.toString(), ' World', 'Undo prepend again');

um.undo(); // undo ' World' appended with capturing=off (should not exist)
assertEqual(text17.toString(), ' World', 'Nothing left to undo');

assert(typeof um.on === 'function', 'UndoManager has event listener');

// Undo with map operations
const map17 = rjs17.getMap('undo-map');
map17.set('key1', 'value1');
assertEqual(map17.get('key1'), 'value1', 'Map set for undo');
um.undo();
assertEqual(map17.has('key1'), false, 'Undo map set');

map17.set('key2', 'value2');
um.undo();
assertEqual(map17.has('key2'), false, 'Undo second map set');

// Undo with array operations
const arr17 = rjs17.getArray('undo-arr');
arr17.push('a');
arr17.push('b');
assertEqual(arr17.length, 2, 'Array push for undo');
um.undo();
assertEqual(arr17.length, 1, 'Undo array push');
um.undo();
assertEqual(arr17.length, 0, 'Undo array push twice');

// Undo with counter
const cnt17 = rjs17.getCounter('undo-cnt');
cnt17.add(10);
assertEqual(cnt17.get(), 10, 'Counter add for undo');
um.undo();
assertEqual(cnt17.get(), 0, 'Undo counter add');

// Redo counter
um.redo();
assertEqual(cnt17.get(), 10, 'Redo counter add');

// Clear
um.clear();
assertEqual(um.undoStack.length, 0, 'Undo stack cleared');
assertEqual(um.redoStack.length, 0, 'Redo stack cleared');
console.log();

// 18. Relative Positions
console.log('[18] Relative Positions');
const rjs18 = new Rjs({ clientId: 21 });
const text18 = rjs18.getText('rpos-doc');
text18.insert(0, 'Hello World');

const rpos = Rjs.RelativePosition.createFromTypeIndex(text18, 6);
assert(rpos instanceof Rjs.RelativePosition, 'RelativePosition created');
assertEqual(rpos.type, 'block', 'RelativePosition type is block');
assert(typeof rpos.blockId === 'number', 'RelativePosition blockId is number');

const abs = Rjs.RelativePosition.createAbsolutePositionFromRelativePosition(text18, rpos);
assert(abs !== null, 'Absolute position resolved');
assertEqual(abs.index, 6, 'Absolute position matches');

const rposEnd = Rjs.RelativePosition.createFromTypeIndex(text18, text18.length);
assertEqual(rposEnd.type, 'end', 'End position created');

// Editing after creating relative position
text18.insert(6, 'Beautiful ');
const absAfter = Rjs.RelativePosition.createAbsolutePositionFromRelativePosition(text18, rpos);
assert(absAfter !== null, 'Absolute position after insert');
assertEqual(absAfter.index, 16, 'Position moved after insert');

// Encode/decode roundtrip
const encoded_rp = Rjs.RelativePosition.encode(rpos);
const decoded_rp = Rjs.RelativePosition.decode(encoded_rp);
assertEqual(decoded_rp.type, rpos.type, 'RelativePosition encode/decode type');
assertEqual(decoded_rp.blockId, rpos.blockId, 'RelativePosition encode/decode blockId');

// toJSON/fromJSON roundtrip
const j = rpos.toJSON();
const rp2 = Rjs.RelativePosition.fromJSON(j);
assertEqual(rp2.type, rpos.type, 'RelativePosition JSON roundtrip');
assertEqual(rp2.blockId, rpos.blockId, 'RelativePosition JSON blockId');
console.log();

// 19. Subdocuments
console.log('[19] Subdocuments');
const rjs19 = new Rjs({ clientId: 22 });
const subdoc = rjs19.getSubdoc('child1');
assert(subdoc !== null, 'Subdoc created');

const subText = subdoc.getText('content');
subText.insert(0, 'Subdoc content');
assertEqual(subText.toString(), 'Subdoc content', 'Subdoc text content');

const subMap = subdoc.getMap('meta');
subMap.set('version', 1);
assertEqual(subMap.get('version'), 1, 'Subdoc map');

const subArr = subdoc.getArray('items');
subArr.push('first');
assertEqual(subArr.length, 1, 'Subdoc array');

const subCnt = subdoc.getCounter('count');
subCnt.add(5);
assertEqual(subCnt.get(), 5, 'Subdoc counter');

const subNames = rjs19.crdt.subdocManager.getSubdocNames();
assertEqual(subNames.length, 1, 'Subdoc manager tracks subdocs');
assertEqual(subNames[0], 'child1', 'Subdoc name correct');

const hasBefore = rjs19.crdt.subdocManager.hasSubdoc('child1');
assert(hasBefore, 'Subdoc has child1');

rjs19.removeSubdoc('child1');
const hasAfter = rjs19.crdt.subdocManager.hasSubdoc('child1');
assert(!hasAfter, 'Subdoc removed');
console.log();

// 20. Snapshot
console.log('[20] Snapshot');
const rjs20 = new Rjs({ clientId: 23 });
rjs20.getText('snap-doc').insert(0, 'Snapshot content');
rjs20.getMap('snap-map').set('key', 'value');
rjs20.getCounter('snap-counter').add(42);

const snap = Rjs.Snapshot.createFromDocument(rjs20.crdt);
assert(snap !== null, 'Snapshot created');
const snapSV = snap.stateVector;
assert(snapSV.size > 0, 'Snapshot has state vector');

const snapEmpty = Rjs.Snapshot.empty();
assert(snapEmpty !== null, 'Empty snapshot');

const clonedSnap = snap.clone();
assertDeepEqual(
  Object.fromEntries(clonedSnap.stateVector),
  Object.fromEntries(snap.stateVector),
  'Snapshot clone matches'
);

const encodedSnap = Rjs.Snapshot.encode(snap);
assert(encodedSnap instanceof Uint8Array, 'Snapshot encode returns Uint8Array');
const decodedSnap = Rjs.Snapshot.decode(encodedSnap);
assertDeepEqual(
  Object.fromEntries(decodedSnap.stateVector),
  Object.fromEntries(snap.stateVector),
  'Snapshot encode/decode roundtrip'
);

const jsonSnap = snap.toJSON();
assert(typeof jsonSnap.stateVector === 'object', 'Snapshot toJSON');
const snapFromJSON = Rjs.Snapshot.fromJSON(jsonSnap);
assertDeepEqual(
  Object.fromEntries(snapFromJSON.stateVector),
  Object.fromEntries(snap.stateVector),
  'Snapshot JSON roundtrip'
);

const newDoc = Rjs.Snapshot.createDocFromSnapshot(snap, 42);
assert(newDoc !== null, 'Doc from snapshot created');
assertEqual(newDoc.clientId, 42, 'Doc from snapshot clientId');

const eqCheck = Rjs.Snapshot.equal(snap, clonedSnap);
assert(eqCheck, 'Snapshot equal check');
console.log();

// 21. State Vector v1 encoding
console.log('[21] State Vector Encode/Decode');
const rjs21 = new Rjs({ clientId: 24 });
rjs21.getText('sv-doc').insert(0, 'State vector test');
const sv = rjs21.crdt.getStateVector();
assert(sv.length > 0, 'State vector has entries');
const encodedSV = Rjs.Snapshot.encodeStateVector(sv);
assert(encodedSV instanceof Uint8Array, 'State vector encode returns Uint8Array');
const decodedSV = Rjs.Snapshot.decodeStateVector(encodedSV);
assert(Array.isArray(decodedSV), 'Decoded state vector is array');
assertEqual(decodedSV.length, sv.length, 'State vector roundtrip length');
console.log();

// 22. Merge Updates
console.log('[22] Merge Updates');
const rjs22a = new Rjs({ clientId: 25 });
rjs22a.getText('merge-doc').insert(0, 'Hello ');
const updateA = rjs22a.serializer.encodeDocument(rjs22a.crdt);

const rjs22b = new Rjs({ clientId: 26 });
rjs22b.getText('merge-doc').insert(0, 'World');
const updateB = rjs22b.serializer.encodeDocument(rjs22b.crdt);

const merged = Rjs.mergeUpdates([updateA, updateB]);
assert(merged instanceof Uint8Array, 'Merge updates returns Uint8Array');

const rjs22c = new Rjs({ clientId: 27 });
rjs22c.applyUpdate(merged);
const mergedText = rjs22c.getText('merge-doc').toString();
assert(typeof mergedText === 'string', 'Merged text is string');
assert(mergedText.length > 0, 'Merged text has content');
console.log();

// 23. Diff Update
console.log('[23] Diff Update');
const rjs23 = new Rjs({ clientId: 28 });
rjs23.getText('diff-doc').insert(0, 'Full content for diff test');
const fullUpdate = rjs23.serializer.encodeDocument(rjs23.crdt);

const partialSV = [{ client: 99, clock: 0 }];
const diffed = Rjs.diffUpdate(fullUpdate, partialSV);
assert(diffed instanceof Uint8Array, 'Diff update returns Uint8Array');
const tempDoc = new Rjs.CRDT(29);
const { YjsEncoder } = require('./src/serialization/serializer_yjs');
const ser = new YjsEncoder();
ser.decodeDocument(diffed, tempDoc);
assert(tempDoc.texts.size > 0, 'Diff update contains data');
console.log();

// 24. Before-update events
console.log('[24] Before-Update Events');
const rjs24 = new Rjs({ clientId: 29 });
let beforeData = null;
rjs24.observe('before-update', (data) => { beforeData = data; });
rjs24.getText('before-doc').insert(0, 'Testing');
assert(beforeData !== null, 'Before-update event fires');
assertEqual(beforeData[0].type, 'text-insert', 'Before-update event type correct');

let beforeMapData = null;
rjs24.observe('before-update', (data) => { beforeMapData = data; });
rjs24.getMap('before-map').set('x', 1);
assert(beforeMapData !== null, 'Before-update for map set');
console.log();

// 25. XML Types
console.log('[25] XML Types');
const rjs25 = new Rjs({ clientId: 30 });

// XmlFragment
const frag = rjs25.getXmlFragment('content');
assert(frag !== null, 'XmlFragment created');
const xmlText = new Rjs.YXmlText(rjs25.crdt, 'Hello XML');
frag.insert(0, xmlText);
assertEqual(frag.length, 1, 'XmlFragment has one child');
assertEqual(frag.toString(), 'Hello XML', 'XmlFragment toString');
assertEqual(frag.toJSON().length, 1, 'XmlFragment toJSON');

// XmlElement
const elem = new Rjs.YXmlElement(rjs25.crdt, 'div', { class: 'container' });
frag.insert(0, elem);
assertEqual(frag.length, 2, 'XmlFragment after insert elem');
assertEqual(frag.get(0).tagName, 'div', 'XmlElement tagName');
assertEqual(frag.get(0).getAttribute('class'), 'container', 'XmlElement getAttribute');
elem.setAttribute('id', 'main');
assertEqual(elem.getAttribute('id'), 'main', 'XmlElement setAttribute');
assert(elem.hasAttribute('class'), 'XmlElement hasAttribute');
assertDeepEqual(elem.getAttributes(), { class: 'container', id: 'main' }, 'XmlElement getAttributes');

// XmlElement children
const childText = new Rjs.YXmlText(rjs25.crdt, 'Child text');
elem.insert(0, childText);
assertEqual(elem.length, 1, 'XmlElement child count');
assertEqual(elem.toString(), '<div class="container" id="main">Child text</div>', 'XmlElement toString');
const domNode = elem.toDOM();
assertEqual(domNode.tagName, 'div', 'XmlElement toDOM tagName');
assertEqual(domNode.attributes.class, 'container', 'XmlElement toDOM attributes');

// XmlText
const xmlText2 = new Rjs.YXmlText(rjs25.crdt, 'Formatted text');
xmlText2.insert(9, ' bold');
assertEqual(xmlText2.toString(), 'Formatted bold text', 'XmlText insert');
assertEqual(xmlText2.length, 19, 'XmlText length');
xmlText2.delete(9, 5);
assertEqual(xmlText2.toString(), 'Formatted text', 'XmlText delete');
xmlText2.setAttribute('bold', true);
assertEqual(xmlText2.getAttribute('bold'), true, 'XmlText setAttribute');
assert(xmlText2.hasAttribute('bold'), 'XmlText hasAttribute');

// XmlHook
const hook = new Rjs.YXmlHook(rjs25.crdt, 'custom-hook');
hook.content = { data: 42 };
assertEqual(hook.hookName, 'custom-hook', 'XmlHook hookName');
assertEqual(hook.content.data, 42, 'XmlHook content');
assertEqual(hook.toString(), '<hook:custom-hook>', 'XmlHook toString');

// XmlFragment forEach
const frag2 = rjs25.getXmlFragment('list');
frag2.insert(0, new Rjs.YXmlText(rjs25.crdt, 'Item 1'));
frag2.insert(1, new Rjs.YXmlText(rjs25.crdt, 'Item 2'));
let items = [];
frag2.forEach((child, i) => items.push(i));
assertEqual(items.length, 2, 'XmlFragment forEach');
console.log();

// 26. V2 Encoding
console.log('[26] V2 Encoding');
const rjs26a = new Rjs({ clientId: 31 });
rjs26a.transact((txn) => {
  txn.textInsert('doc', 0, 'V2 Test');
});
rjs26a.getMap('meta').set('version', 2);

const v2Encoded = rjs26a.encodeStateAsUpdateV2('doc');
assert(v2Encoded instanceof Uint8Array, 'V2 encode returns Uint8Array');
assert(v2Encoded.length > 0, 'V2 encoded has content');

const rjs26b = new Rjs({ clientId: 32 });
rjs26b.applyUpdateV2(v2Encoded);
assertEqual(rjs26b.getText('doc').toString(), 'V2 Test', 'V2 apply update text');

// V1 to V2 conversion
const v1Encoded = rjs26a.serializer.encodeDocument(rjs26a.crdt);
const convertedToV2 = Rjs.convertUpdateV1ToV2(v1Encoded);
assert(convertedToV2 instanceof Uint8Array, 'Convert V1 to V2');

// V2 to V1 conversion
const convertedToV1 = Rjs.convertUpdateV2ToV1(convertedToV2);
assert(convertedToV1 instanceof Uint8Array, 'Convert V2 to V1');

// Static decodeUpdate
const decodedCrdt = Rjs.decodeUpdate(v1Encoded);
assert(decodedCrdt !== null, 'Static decodeUpdate');

const decodedCrdtV2 = Rjs.decodeUpdateV2(v2Encoded);
assert(decodedCrdtV2 !== null, 'Static decodeUpdateV2');
console.log();

// 27. Typed Events
console.log('[27] Typed Events');
const rjs27 = new Rjs({ clientId: 33 });
const text27 = rjs27.getText('events');
let textEvent = null;
text27.observe((event) => { textEvent = event; });
text27.insert(0, 'Hello');
assert(textEvent !== null, 'Text typed event fires');
assert(textEvent.delta !== undefined, 'Text event has delta');
assert(Array.isArray(textEvent.delta), 'Text event delta is array');
const insertOp = textEvent.delta.find(d => d.insert !== undefined);
assert(insertOp !== undefined, 'Text event delta has insert op');
assertEqual(insertOp.insert, 'Hello', 'Text event delta insert');

let mapEvent = null;
const map27 = rjs27.getMap('events');
map27.observe((event) => { mapEvent = event; });
map27.set('key', 'value');
assert(mapEvent !== null, 'Map typed event fires');
assert(mapEvent.changes !== undefined, 'Map event has changes');
assert(mapEvent.changes.keysChanged.has('key'), 'Map event has correct key');

let arrayEvent = null;
const arr27 = rjs27.getArray('events');
arr27.observe((event) => { arrayEvent = event; });
arr27.push('item');
assert(arrayEvent !== null, 'Array typed event fires');
assert(arrayEvent.delta !== undefined, 'Array event has delta');
assert(Array.isArray(arrayEvent.delta), 'Array event delta is array');
console.log();

// 28. API Completeness
console.log('[28] API Completeness');
const rjs28 = new Rjs({ clientId: 34 });
rjs28.getText('api-doc').insert(0, 'API Test');
rjs28.getMap('api-map').set('key', 'value');
rjs28.getArray('api-arr').push('item');
rjs28.getCounter('api-cnt').add(10);

// decodeUpdate
const encoded28 = rjs28.serializer.encodeDocument(rjs28.crdt);
const decoded28 = rjs28.decodeUpdate(encoded28);
assert(decoded28 !== null, 'decodeUpdate returns CRDT');
assertEqual(decoded28.texts.size, 1, 'decodeUpdate has texts');
assertEqual(decoded28.maps.size, 1, 'decodeUpdate has maps');

// snapshotQuery
const textQ = rjs28.snapshotQuery('text', 'api-doc');
assertEqual(textQ, 'API Test', 'snapshotQuery text');
const mapQ = rjs28.snapshotQuery('map', 'api-map');
assertEqual(mapQ.key, 'value', 'snapshotQuery map');
const arrQ = rjs28.snapshotQuery('array', 'api-arr');
assertEqual(arrQ.length, 1, 'snapshotQuery array');
const cntQ = rjs28.snapshotQuery('counter', 'api-cnt');
assertEqual(cntQ, 10, 'snapshotQuery counter');

// typeListToArray / typeMapGetAll
const listArr = rjs28.typeListToArray('api-arr');
assertEqual(listArr.length, 1, 'typeListToArray');
const mapAll = rjs28.typeMapGetAll('api-map');
assertEqual(mapAll.key, 'value', 'typeMapGetAll');

// typeMapGetSnapshot
const snapVal = rjs28.typeMapGetSnapshot('api-map', 'key');
assertEqual(snapVal, 'value', 'typeMapGetSnapshot');

// mergeUpdatesV2
const rjs28a = new Rjs({ clientId: 35 });
rjs28a.getText('merge').insert(0, 'A');
const v2UpdateA = rjs28a.encodeStateAsUpdateV2('merge');

const rjs28b = new Rjs({ clientId: 36 });
rjs28b.getText('merge').insert(0, 'B');
const v2UpdateB = rjs28b.encodeStateAsUpdateV2('merge');

const mergedV2 = Rjs.mergeUpdatesV2([v2UpdateA, v2UpdateB]);
assert(mergedV2 instanceof Uint8Array, 'mergeUpdatesV2');

// diffUpdateV2
const diffV2 = Rjs.diffUpdateV2(v2UpdateA, [{ client: 99, clock: 0 }]);
assert(diffV2 instanceof Uint8Array, 'diffUpdateV2');
console.log();

// 29. observeDeep / unobserve
console.log('[29] observeDeep / unobserve');
const rjs29 = new Rjs({ clientId: 40 });
const text29 = rjs29.getText('deep');
let deepFired = false;
const unsubDeep = text29.observeDeep(() => { deepFired = true; });
text29.insert(0, 'test');
assert(deepFired, 'observeDeep fires on insert');
deepFired = false;
unsubDeep();
text29.insert(4, '!');
assert(!deepFired, 'unobserveDeep stops firing');

let shallowFired = false;
const unsubShallow = text29.observe(() => { shallowFired = true; });
text29.insert(5, '?');
assert(shallowFired, 'observe fires');
shallowFired = false;
unsubShallow();
text29.insert(6, '!');
assert(!shallowFired, 'unobserve stops firing');
console.log();

// 30. parent property
console.log('[30] Parent property');
const rjs30 = new Rjs({ clientId: 41 });
const map30 = rjs30.getMap('parent-test');
assertEqual(map30.parent, null, 'Map parent is null initially');
console.log();

// 31. clone()
console.log('[31] Clone');
const rjs31 = new Rjs({ clientId: 42 });
rjs31.getText('clone-text').insert(0, 'Clone me');
rjs31.getMap('clone-map').set('key', 'val');
rjs31.getArray('clone-arr').push('item');
const clonedText = rjs31.getText('clone-text').clone();
assertEqual(clonedText.toString(), 'Clone me', 'Text clone');
const clonedMap = rjs31.getMap('clone-map').clone();
assertEqual(clonedMap.get('key'), 'val', 'Map clone');
const clonedArr = rjs31.getArray('clone-arr').clone();
assertEqual(clonedArr.toArray().length, 1, 'Array clone');
console.log();

// 32. Map.clear()
console.log('[32] Map clear');
const rjs32 = new Rjs({ clientId: 43 });
const map32 = rjs32.getMap('clear-test');
map32.set('a', 1);
map32.set('b', 2);
assertEqual(map32.size, 2, 'Map before clear');
map32.clear();
assertEqual(map32.size, 0, 'Map after clear');
assertEqual(map32.has('a'), false, 'Map clear removed keys');
console.log();

// 33. Array.slice()
console.log('[33] Array slice');
const rjs33 = new Rjs({ clientId: 44 });
const arr33 = rjs33.getArray('slice-test');
arr33.push('a');
arr33.push('b');
arr33.push('c');
arr33.push('d');
const sliced = arr33.slice(1, 3);
assertEqual(sliced.length, 2, 'Array slice length');
assertEqual(sliced[0], 'b', 'Array slice first');
assertEqual(sliced[1], 'c', 'Array slice second');
console.log();

// 34. XmlFragment.slice() and createTreeWalker
console.log('[34] XmlFragment slice & createTreeWalker');
const rjs34 = new Rjs({ clientId: 45 });
const frag34 = rjs34.getXmlFragment('walk');
const elem34a = new Rjs.YXmlElement(rjs34.crdt, 'p');
const elem34b = new Rjs.YXmlElement(rjs34.crdt, 'div');
const inner34 = new Rjs.YXmlElement(rjs34.crdt, 'span');
inner34.insert(0, [new Rjs.YXmlText(rjs34.crdt, 'inner')]);
elem34b.insert(0, [inner34]);
frag34.insert(0, [elem34a, elem34b]);

const sliced34 = frag34.slice(0, 1);
assertEqual(sliced34.length, 1, 'XmlFragment slice');

let walkedNodes = [];
for (const node of frag34.createTreeWalker(n => true)) {
  walkedNodes.push(node.toString ? node.toString() : node);
}
assert(walkedNodes.length >= 2, 'createTreeWalker visits nodes');
console.log();

// 35. XmlElement nextSibling / prevSibling
console.log('[35] XmlElement nextSibling/prevSibling');
const rjs35 = new Rjs({ clientId: 46 });
const frag35 = rjs35.getXmlFragment('sib');
const e1 = new Rjs.YXmlElement(rjs35.crdt, 'p');
const e2 = new Rjs.YXmlElement(rjs35.crdt, 'div');
const e3 = new Rjs.YXmlElement(rjs35.crdt, 'span');
frag35.insert(0, [e1, e2, e3]);
assertEqual(e1.nextSibling, e2, 'nextSibling');
assertEqual(e2.prevSibling, e1, 'prevSibling');
assertEqual(e3.prevSibling, e2, 'prevSibling of last');
assertEqual(e1.prevSibling, null, 'prevSibling of first');
console.log();

// 36. Text format / toDelta
console.log('[36] Text format & toDelta');
const rjs36 = new Rjs({ clientId: 47 });
const text36 = rjs36.getText('format');
text36.insert(0, 'Hello World');
text36.format(0, 5, { bold: true });
const delta36 = text36.toDelta();
assert(Array.isArray(delta36), 'toDelta returns array');
assert(delta36.length > 0, 'toDelta has entries');
console.log();

// 37. Text.insert with attrs
console.log('[37] Text insert with attrs');
const rjs37 = new Rjs({ clientId: 48 });
const text37 = rjs37.getText('attrs');
text37.insert(0, 'bold text', { bold: true });
assertEqual(text37.toString(), 'bold text', 'Text insert with attrs content');
console.log();

// 38. Doc toJSON / gc / get(type,name)
console.log('[38] Doc toJSON / gc / get(type,name)');
const rjs38 = new Rjs({ clientId: 49 });
rjs38.getText('doc-text').insert(0, 'hello');
rjs38.getMap('doc-map').set('k', 'v');
const docJson = rjs38.toJSON();
assert(typeof docJson === 'object', 'toJSON returns object');

rjs38.gc = false;
assertEqual(rjs38.gc, false, 'gc setter');
rjs38.gc = true;
assertEqual(rjs38.gc, true, 'gc getter');

const viaGet = rjs38.get(Rjs.TextCRDT, 'doc-text');
assert(viaGet !== null && viaGet !== undefined, 'get(type, name)');
console.log();

// 39. UndoManager: captureTimeout, meta, stack-item-added
console.log('[39] UndoManager enhancements');
const rjs39 = new Rjs({ clientId: 50 });
const um39 = rjs39.enableUndoManager({ captureTimeout: 50 });
let stackItemAdded = false;
um39.on('stack-item-added', () => { stackItemAdded = true; });

rjs39.transact((txn) => {
  txn.textInsert('undo39', 0, 'Test');
});

// Force flush the current group to the stack
um39._flushCurrentGroup();
assert(stackItemAdded, 'stack-item-added event fires');

// Test meta on stack item
assert(um39.undoStack.length > 0, 'Undo stack has items');
const lastItem = um39.undoStack[um39.undoStack.length - 1];
assert(lastItem.meta instanceof Map, 'Stack item has meta');

// Test ignoreRemoteAttributeChanges
const rjs39b = new Rjs({ clientId: 51 });
const um39b = rjs39b.enableUndoManager({ ignoreRemoteAttributeChanges: true });
console.log();

// 40. encodeStateVectorFromUpdate
console.log('[40] encodeStateVectorFromUpdate');
const rjs40 = new Rjs({ clientId: 52 });
rjs40.getText('sv-doc').insert(0, 'SV test');
const enc40 = rjs40.serializer.encodeDocument(rjs40.crdt);
const svFromUpdate = Rjs.encodeStateVectorFromUpdate(enc40);
assert(svFromUpdate instanceof Uint8Array, 'encodeStateVectorFromUpdate');
console.log();

// Summary
console.log('=== Test Summary ===');
console.log(`  Total: ${passed + failed}`);
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Status: ${failed === 0 ? 'ALL TESTS PASSED ✓' : 'SOME TESTS FAILED ✗'}`);

process.exit(failed > 0 ? 1 : 0);
