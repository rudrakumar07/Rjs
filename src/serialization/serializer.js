const { Encoder, Decoder } = require('./encoder');
const { ID } = require('../core/id');
const { RGABlock } = require('../core/block_rga');
const { linkBlockToTail } = require('../core/helpers');

const MAGIC = { R: 0x52, J: 0x4A, S: 0x53 };
const OP_TYPES = {
  TEXT_INSERT: 1,
  TEXT_DELETE: 2,
  MAP_SET: 3,
  MAP_DELETE: 4,
  ARRAY_INSERT: 5,
  ARRAY_DELETE: 6,
  COUNTER_ADD: 7,
};
const VALUE_TAG = { NULL: 0, STRING: 1, INT: 2, FLOAT: 3, BOOL: 4, ARRAY: 5, OBJECT: 6 };
const MAX_ENCODE_DEPTH = 100;

class Serializer {
  constructor() {
    this.version = 1;
  }

  encodeDocument(crdt, stateVector) {
    const enc = new Encoder();
    enc.writeUint8(MAGIC.R);
    enc.writeUint8(MAGIC.J);
    enc.writeUint8(MAGIC.S);
    enc.writeUint8(this.version);
    enc.writeVarint(crdt.clientId);

    const svMap = stateVector ? new Map(stateVector.map(s => [s.client, s.clock])) : null;

    this._encodeTexts(enc, crdt.texts, svMap);
    this._encodeMaps(enc, crdt.maps);
    this._encodeArrays(enc, crdt.arrays);
    this._encodeCounters(enc, crdt.counters);

    return enc.toBuffer();
  }

  _encodeTexts(enc, texts, svMap) {
    enc.writeVarint(texts.size);
    for (const [name, text] of texts) {
      enc.writeString(name);
      const rga = text.rga;
      let count = 0;
      let cur = rga.head;
      if (svMap) {
        while (cur) {
          const bClient = ID.client(cur.id);
          const known = svMap.get(bClient);
          if (known === undefined || known < ID.clock(cur.id)) count++;
          cur = cur.next;
        }
      } else {
        while (cur) { count++; cur = cur.next; }
      }
      enc.writeVarint(count);
      cur = rga.head;
      while (cur) {
        if (svMap) {
          const bClient = ID.client(cur.id);
          const known = svMap.get(bClient);
          if (known !== undefined && known >= ID.clock(cur.id)) {
            cur = cur.next;
            continue;
          }
        }
        enc.writeId(cur.id);
        enc.writeString(cur.content);
        const ol = cur.originLeft;
        enc.writeUint8(ol ? 1 : 0);
        if (ol) enc.writeId(ol);
        const or_ = cur.originRight;
        enc.writeUint8(or_ ? 1 : 0);
        if (or_) enc.writeId(or_);
        enc.writeUint8(cur.isDeleted ? 1 : 0);
        cur = cur.next;
      }
    }
  }

  _encodeMaps(enc, maps) {
    enc.writeVarint(maps.size);
    for (const [name, map] of maps) {
      enc.writeString(name);
      enc.writeVarint(map._vals.size);
      for (const [key, value] of map._vals) {
        enc.writeString(key);
        this._encodeValue(enc, value);
        enc.writeVarint(map._versions.get(key) || 0);
      }
    }
  }

  _encodeArrays(enc, arrays) {
    enc.writeVarint(arrays.size);
    for (const [name, arr] of arrays) {
      enc.writeString(name);
      enc.writeVarint(arr.items.length);
      for (const item of arr.items) {
        this._encodeValue(enc, item);
      }
    }
  }

  _encodeCounters(enc, counters) {
    enc.writeVarint(counters.size);
    for (const [name, counter] of counters) {
      enc.writeString(name);
      enc.writeFloat64(counter.value);
    }
  }

  decodeDocument(buffer, crdt) {
    const dec = new Decoder(buffer);
    const magic1 = dec.readUint8();
    const magic2 = dec.readUint8();
    const magic3 = dec.readUint8();
    if (magic1 !== MAGIC.R || magic2 !== MAGIC.J || magic3 !== MAGIC.S) {
      throw new Error('Invalid document header');
    }
    const version = dec.readUint8();

    crdt.clientId = dec.readVarint();

    this._decodeTexts(dec, crdt);
    this._decodeMaps(dec, crdt);
    this._decodeArrays(dec, crdt);
    this._decodeCounters(dec, crdt);

    return crdt;
  }

  _decodeTexts(dec, crdt) {
    const count = dec.readVarint();
    for (let i = 0; i < count; i++) {
      const name = dec.readString();
      const text = crdt.getText(name);
      const blockCount = dec.readVarint();
      for (let j = 0; j < blockCount; j++) {
        const id = dec.readId();
        const content = dec.readString();
        const hasOL = dec.readUint8() === 1;
        const originLeft = hasOL ? dec.readId() : 0;
        const hasOR = dec.readUint8() === 1;
        const originRight = hasOR ? dec.readId() : 0;
        const isDeleted = dec.readUint8() === 1;
        const block = new RGABlock(id, content, originLeft, originRight);
        block.isDeleted = isDeleted;
        text.rga.byId.set(block.id, block);
        linkBlockToTail(text.rga, block);
      }
      text.rga.invalidateCache();
    }
  }

  _decodeMaps(dec, crdt) {
    const count = dec.readVarint();
    for (let i = 0; i < count; i++) {
      const name = dec.readString();
      const map = crdt.getMap(name);
      const entryCount = dec.readVarint();
      for (let j = 0; j < entryCount; j++) {
        const key = dec.readString();
        const value = this._decodeValue(dec);
        const version = dec.readVarint();
        map._vals.set(key, value);
        map._versions.set(key, version);
      }
    }
  }

  _decodeArrays(dec, crdt) {
    const count = dec.readVarint();
    for (let i = 0; i < count; i++) {
      const name = dec.readString();
      const arr = crdt.getArray(name);
      const itemCount = dec.readVarint();
      for (let j = 0; j < itemCount; j++) {
        arr.items.push(this._decodeValue(dec));
      }
    }
  }

  _decodeCounters(dec, crdt) {
    const count = dec.readVarint();
    for (let i = 0; i < count; i++) {
      const name = dec.readString();
      const counter = crdt.getCounter(name);
      counter.value = dec.readFloat64();
    }
  }

  encodeOperations(ops) {
    const enc = new Encoder();
    enc.writeVarint(ops.length);
    for (const op of ops) {
      this._encodeOperation(enc, op);
    }
    return enc.toBuffer();
  }

  decodeOperations(buffer) {
    const dec = new Decoder(buffer);
    const count = dec.readVarint();
    const ops = [];
    for (let i = 0; i < count; i++) {
      ops.push(this._decodeOperation(dec));
    }
    return ops;
  }

  _encodeOperation(enc, op) {
    switch (op.type) {
      case 'text-insert':
        enc.writeUint8(OP_TYPES.TEXT_INSERT);
        enc.writeString(op.name);
        enc.writeVarint(op.pos);
        enc.writeString(op.content);
        break;
      case 'text-delete':
        enc.writeUint8(OP_TYPES.TEXT_DELETE);
        enc.writeString(op.name);
        enc.writeVarint(op.pos);
        enc.writeVarint(op.len);
        break;
      case 'map-set':
        enc.writeUint8(OP_TYPES.MAP_SET);
        enc.writeString(op.name);
        enc.writeString(op.key);
        this._encodeValue(enc, op.value);
        break;
      case 'map-delete':
        enc.writeUint8(OP_TYPES.MAP_DELETE);
        enc.writeString(op.name);
        enc.writeString(op.key);
        break;
      case 'array-insert':
        enc.writeUint8(OP_TYPES.ARRAY_INSERT);
        enc.writeString(op.name);
        enc.writeVarint(op.pos);
        this._encodeValue(enc, op.value);
        break;
      case 'array-delete':
        enc.writeUint8(OP_TYPES.ARRAY_DELETE);
        enc.writeString(op.name);
        enc.writeVarint(op.pos);
        enc.writeVarint(op.len);
        break;
      case 'counter-add':
        enc.writeUint8(OP_TYPES.COUNTER_ADD);
        enc.writeString(op.name);
        enc.writeFloat64(op.value);
        break;
    }
  }

  _decodeOperation(dec) {
    const type = dec.readUint8();
    switch (type) {
      case OP_TYPES.TEXT_INSERT:
        return { type: 'text-insert', name: dec.readString(), pos: dec.readVarint(), content: dec.readString() };
      case OP_TYPES.TEXT_DELETE:
        return { type: 'text-delete', name: dec.readString(), pos: dec.readVarint(), len: dec.readVarint() };
      case OP_TYPES.MAP_SET:
        return { type: 'map-set', name: dec.readString(), key: dec.readString(), value: this._decodeValue(dec) };
      case OP_TYPES.MAP_DELETE:
        return { type: 'map-delete', name: dec.readString(), key: dec.readString() };
      case OP_TYPES.ARRAY_INSERT:
        return { type: 'array-insert', name: dec.readString(), pos: dec.readVarint(), value: this._decodeValue(dec) };
      case OP_TYPES.ARRAY_DELETE:
        return { type: 'array-delete', name: dec.readString(), pos: dec.readVarint(), len: dec.readVarint() };
      case OP_TYPES.COUNTER_ADD:
        return { type: 'counter-add', name: dec.readString(), value: dec.readFloat64() };
      default:
        throw new Error(`Unknown operation type: ${type}`);
    }
  }

  _encodeValue(enc, value, depth = 0) {
    if (depth > MAX_ENCODE_DEPTH) throw new Error('Max encoding depth exceeded');
    if (value === null || value === undefined) {
      enc.writeUint8(VALUE_TAG.NULL);
      return;
    }
    switch (typeof value) {
      case 'string':
        enc.writeUint8(VALUE_TAG.STRING);
        enc.writeString(value);
        break;
      case 'number':
        if (Number.isInteger(value)) {
          enc.writeUint8(VALUE_TAG.INT);
          enc.writeVarintSigned(value);
        } else {
          enc.writeUint8(VALUE_TAG.FLOAT);
          enc.writeFloat64(value);
        }
        break;
      case 'boolean':
        enc.writeUint8(VALUE_TAG.BOOL);
        enc.writeUint8(value ? 1 : 0);
        break;
      default:
        if (Array.isArray(value)) {
          enc.writeUint8(VALUE_TAG.ARRAY);
          enc.writeVarint(value.length);
          for (const item of value) this._encodeValue(enc, item, depth + 1);
        } else if (typeof value === 'object') {
          enc.writeUint8(VALUE_TAG.OBJECT);
          const keys = Object.keys(value);
          enc.writeVarint(keys.length);
          for (const key of keys) {
            enc.writeString(key);
            this._encodeValue(enc, value[key], depth + 1);
          }
        }
        break;
    }
  }

  _decodeValue(dec, depth = 0) {
    if (depth > MAX_ENCODE_DEPTH) throw new Error('Max decoding depth exceeded');
    const type = dec.readUint8();
    switch (type) {
      case VALUE_TAG.NULL: return null;
      case VALUE_TAG.STRING: return dec.readString();
      case VALUE_TAG.INT: return dec.readVarintSigned();
      case VALUE_TAG.FLOAT: return dec.readFloat64();
      case VALUE_TAG.BOOL: return dec.readUint8() === 1;
      case VALUE_TAG.ARRAY: {
        const len = dec.readVarint();
        const arr = [];
        for (let i = 0; i < len; i++) arr.push(this._decodeValue(dec, depth + 1));
        return arr;
      }
      case VALUE_TAG.OBJECT: {
        const count = dec.readVarint();
        const obj = {};
        for (let i = 0; i < count; i++) {
          const key = dec.readString();
          obj[key] = this._decodeValue(dec, depth + 1);
        }
        return obj;
      }
      default: throw new Error('Unknown value type tag: ' + type);
    }
  }
}

module.exports = { Serializer };
