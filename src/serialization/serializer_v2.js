const { Encoder, Decoder } = require('../serialization/encoder');
const { ID } = require('../core/id');
const { RGABlock } = require('../core/block_rga');
const { linkBlockToTail } = require('../core/helpers');

const MAGIC_V2 = { R: 0x52, J: 0x4A, S: 0x53, V: 0x32 };

class SerializerV2 {
  constructor() {
    this.version = 2;
  }

  encodeDocument(crdt, stateVector) {
    const enc = new Encoder();
    enc.writeUint8(MAGIC_V2.R);
    enc.writeUint8(MAGIC_V2.J);
    enc.writeUint8(MAGIC_V2.S);
    enc.writeUint8(MAGIC_V2.V);
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
      const blocks = text.rga.getAllBlocks();
      let filtered = blocks;
      if (svMap) {
        filtered = [];
        for (const block of blocks) {
          const bClient = ID.client(block.id);
          const bClock = ID.clock(block.id);
          if (!svMap.has(bClient) || svMap.get(bClient) < bClock) {
            filtered.push(block);
          }
        }
      }

      enc.writeVarint(filtered.length);
      for (const block of filtered) {
        enc.writeId(block.id);
        enc.writeString(block.content);
        enc.writeId(block.originLeft || 0);
        enc.writeId(block.originRight || 0);
        const flags = (block.isDeleted ? 1 : 0);
        enc.writeUint8(flags);
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
    const magic4 = dec.readUint8();
    if (magic1 !== MAGIC_V2.R || magic2 !== MAGIC_V2.J || magic3 !== MAGIC_V2.S || magic4 !== MAGIC_V2.V) {
      throw new Error('Invalid V2 document header');
    }

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
        const originLeft = dec.readId();
        const originRight = dec.readId();
        const flags = dec.readUint8();
        const isDeleted = (flags & 1) === 1;

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
        enc.writeUint8(1);
        enc.writeString(op.name);
        enc.writeVarint(op.pos);
        enc.writeString(op.content);
        break;
      case 'text-delete':
        enc.writeUint8(2);
        enc.writeString(op.name);
        enc.writeVarint(op.pos);
        enc.writeVarint(op.len);
        break;
      case 'map-set':
        enc.writeUint8(3);
        enc.writeString(op.name);
        enc.writeString(op.key);
        this._encodeValue(enc, op.value);
        break;
      case 'map-delete':
        enc.writeUint8(4);
        enc.writeString(op.name);
        enc.writeString(op.key);
        break;
      case 'array-insert':
        enc.writeUint8(5);
        enc.writeString(op.name);
        enc.writeVarint(op.pos);
        this._encodeValue(enc, op.value);
        break;
      case 'array-delete':
        enc.writeUint8(6);
        enc.writeString(op.name);
        enc.writeVarint(op.pos);
        enc.writeVarint(op.len);
        break;
      case 'counter-add':
        enc.writeUint8(7);
        enc.writeString(op.name);
        enc.writeFloat64(op.value);
        break;
    }
  }

  _decodeOperation(dec) {
    const type = dec.readUint8();
    switch (type) {
      case 1: return { type: 'text-insert', name: dec.readString(), pos: dec.readVarint(), content: dec.readString() };
      case 2: return { type: 'text-delete', name: dec.readString(), pos: dec.readVarint(), len: dec.readVarint() };
      case 3: return { type: 'map-set', name: dec.readString(), key: dec.readString(), value: this._decodeValue(dec) };
      case 4: return { type: 'map-delete', name: dec.readString(), key: dec.readString() };
      case 5: return { type: 'array-insert', name: dec.readString(), pos: dec.readVarint(), value: this._decodeValue(dec) };
      case 6: return { type: 'array-delete', name: dec.readString(), pos: dec.readVarint(), len: dec.readVarint() };
      case 7: return { type: 'counter-add', name: dec.readString(), value: dec.readFloat64() };
      default: throw new Error(`Unknown V2 operation type: ${type}`);
    }
  }

  _encodeValue(enc, value, depth = 0) {
    if (depth > 100) throw new Error('Max encoding depth exceeded');
    if (value === null || value === undefined) {
      enc.writeUint8(0);
    } else if (typeof value === 'string') {
      enc.writeUint8(1);
      enc.writeString(value);
    } else if (typeof value === 'number') {
      if (Number.isInteger(value)) {
        enc.writeUint8(2);
        enc.writeVarintSigned(value);
      } else {
        enc.writeUint8(3);
        enc.writeFloat64(value);
      }
    } else if (typeof value === 'boolean') {
      enc.writeUint8(4);
      enc.writeUint8(value ? 1 : 0);
    } else if (Array.isArray(value)) {
      enc.writeUint8(5);
      enc.writeVarint(value.length);
      for (const item of value) this._encodeValue(enc, item, depth + 1);
    } else if (typeof value === 'object') {
      enc.writeUint8(6);
      const keys = Object.keys(value);
      enc.writeVarint(keys.length);
      for (const key of keys) {
        enc.writeString(key);
        this._encodeValue(enc, value[key], depth + 1);
      }
    }
  }

  _decodeValue(dec, depth = 0) {
    if (depth > 100) throw new Error('Max decoding depth exceeded');
    const type = dec.readUint8();
    switch (type) {
      case 0: return null;
      case 1: return dec.readString();
      case 2: return dec.readVarintSigned();
      case 3: return dec.readFloat64();
      case 4: return dec.readUint8() === 1;
      case 5: {
        const len = dec.readVarint();
        const arr = [];
        for (let i = 0; i < len; i++) arr.push(this._decodeValue(dec, depth + 1));
        return arr;
      }
      case 6: {
        const count = dec.readVarint();
        const obj = {};
        for (let i = 0; i < count; i++) {
          const key = dec.readString();
          obj[key] = this._decodeValue(dec, depth + 1);
        }
        return obj;
      }
      default: throw new Error('Unknown V2 value type tag: ' + type);
    }
  }
}

module.exports = { SerializerV2, MAGIC_V2 };
