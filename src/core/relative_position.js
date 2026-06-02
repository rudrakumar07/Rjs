const { ID } = require('./id');
const { Encoder, Decoder } = require('../serialization/encoder');

const ASSOC = { LEFT: 0, RIGHT: 1 };

class RelativePosition {
  constructor(type, blockId, offset, assoc) {
    this.type = type;
    this.blockId = blockId || 0;
    this.offset = offset || 0;
    this.assoc = assoc !== undefined ? assoc : ASSOC.LEFT;
  }

  toJSON() {
    return { type: this.type, blockId: ID.unpack(this.blockId), offset: this.offset, assoc: this.assoc };
  }

  static fromJSON(j) {
    const blockId = j.blockId ? ID.pack(j.blockId.client, j.blockId.clock) : 0;
    return new RelativePosition(j.type, blockId, j.offset, j.assoc);
  }

  static createFromTypeIndex(text, index) {
    const len = text.length;
    if (index < 0) index = 0;
    if (index > len) index = len;

    const rga = text.rga;
    if (index === len) {
      return new RelativePosition('end', 0, 0, ASSOC.LEFT);
    }

    const result = rga._findPos(index);
    if (!result) return new RelativePosition('end', 0, 0, ASSOC.LEFT);

    const block = result.block;
    return new RelativePosition('block', block.id, result.offset, ASSOC.LEFT);
  }

  static createAbsolutePositionFromRelativePosition(text, rpos) {
    if (!rpos || !text) return null;
    const rga = text.rga;

    if (rpos.type === 'end') {
      return { index: text.length, valid: true };
    }

    const block = rga.findById(rpos.blockId);
    if (!block) {
      return { index: 0, valid: false };
    }

    let cur = block;
    while (cur) {
      if (!cur.isDeleted) {
        if (cur.id === block.id) {
          const idx = rpos.offset;
          if (idx <= cur.len) {
            let absolute = 0;
            let walk = rga.head;
            while (walk && walk !== cur) {
              if (!walk.isDeleted) absolute += walk.len;
              walk = walk.next;
            }
            return { index: absolute + idx, valid: true };
          }
        }
        let absolute = 0;
        let walk = rga.head;
        while (walk && walk !== cur) {
          if (!walk.isDeleted) absolute += walk.len;
          walk = walk.next;
        }
        return { index: absolute, valid: true };
      } else if (rpos.assoc === ASSOC.RIGHT) {
        cur = cur.next;
      } else {
        cur = cur.prev;
      }
    }

    return { index: text.length, valid: false };
  }

  static encode(rpos) {
    const enc = new Encoder();
    enc.writeUint8(rpos.type === 'block' ? 0 : 1);
    if (rpos.type === 'block') {
      enc.writeId(rpos.blockId);
      enc.writeVarint(rpos.offset);
    }
    enc.writeUint8(rpos.assoc);
    return enc.toBuffer();
  }

  static decode(buffer) {
    const dec = new Decoder(buffer);
    const type = dec.readUint8() === 0 ? 'block' : 'end';
    let blockId = 0, offset = 0;
    if (type === 'block') {
      blockId = dec.readId();
      offset = dec.readVarint();
    }
    const assoc = dec.readUint8();
    return new RelativePosition(type, blockId, offset, assoc);
  }
}

module.exports = { RelativePosition, ASSOC };
