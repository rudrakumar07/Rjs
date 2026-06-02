const _textEncoder = new TextEncoder();
const _textDecoder = new TextDecoder();

class Encoder {
  constructor(initialSize = 4096) {
    this.buf = new Uint8Array(initialSize);
    this.offset = 0;
  }

  _grow(needed) {
    if (this.offset + needed <= this.buf.length) return;
    let newSize = this.buf.length;
    while (newSize < this.offset + needed) newSize *= 2;
    const newBuf = new Uint8Array(newSize);
    newBuf.set(this.buf.subarray(0, this.offset));
    this.buf = newBuf;
  }

  writeUint8(val) {
    if (this.offset >= this.buf.length) this._grow(1);
    this.buf[this.offset++] = val & 0xFF;
  }

  writeVarint(val) {
    val = val >>> 0;
    if (val < 128) {
      if (this.offset >= this.buf.length) this._grow(1);
      this.buf[this.offset++] = val;
    } else {
      if (this.offset + 5 > this.buf.length) this._grow(5);
      while (val > 127) {
        this.buf[this.offset++] = (val & 127) | 128;
        val >>>= 7;
      }
      this.buf[this.offset++] = val;
    }
  }

  writeVarintSigned(val) {
    this.writeVarint(val < 0 ? (-val << 1) | 1 : val << 1);
  }

  writeString(str) {
    const len = str.length;
    if (len === 1) {
      const c = str.charCodeAt(0);
      if (c < 128) {
        if (this.offset >= this.buf.length) this._grow(1);
        this.buf[this.offset++] = 1;
        if (this.offset >= this.buf.length) this._grow(1);
        this.buf[this.offset++] = c;
        return;
      }
    }
    if (len < 64) {
      let isAscii = true;
      for (let i = 0; i < len; i++) {
        if (str.charCodeAt(i) > 127) { isAscii = false; break; }
      }
      if (isAscii) {
        this.writeVarint(len);
        if (this.offset + len > this.buf.length) this._grow(len);
        for (let i = 0; i < len; i++) {
          this.buf[this.offset++] = str.charCodeAt(i);
        }
        return;
      }
    }
    const bytes = _textEncoder.encode(str);
    this.writeVarint(bytes.length);
    if (this.offset + bytes.length > this.buf.length) this._grow(bytes.length);
    this.buf.set(bytes, this.offset);
    this.offset += bytes.length;
  }

  writeFloat64(val) {
    if (this.offset + 8 > this.buf.length) this._grow(8);
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.offset, 8);
    view.setFloat64(0, val, false);
    this.offset += 8;
  }

  writeId(id) {
    if (!id) {
      if (this.offset + 2 > this.buf.length) this._grow(2);
      this.buf[this.offset++] = 0;
      this.buf[this.offset++] = 0;
    } else if (typeof id === 'number') {
      const hi = (id / 0x100000000) >>> 0;
      const lo = id >>> 0;
      this.writeVarint(hi);
      this.writeVarint(lo);
    } else {
      this.writeVarint(id.client);
      this.writeVarint(id.clock);
    }
  }

  writeBuffer(buffer) {
    this.writeVarint(buffer.length);
    if (this.offset + buffer.length > this.buf.length) this._grow(buffer.length);
    this.buf.set(buffer, this.offset);
    this.offset += buffer.length;
  }

  toBuffer() {
    return this.buf.subarray(0, this.offset);
  }
}

class Decoder {
  constructor(buffer) {
    this.buf = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    this.offset = 0;
  }

  readUint8() {
    return this.buf[this.offset++];
  }

  readVarint() {
    let val = 0, shift = 0, byte;
    do {
      byte = this.buf[this.offset++];
      val |= (byte & 127) << shift;
      shift += 7;
    } while (byte & 128);
    return val >>> 0;
  }

  readVarintSigned() {
    const val = this.readVarint();
    return val & 1 ? -(val >>> 1) : val >>> 1;
  }

  readString() {
    const len = this.readVarint();
    const str = _textDecoder.decode(this.buf.subarray(this.offset, this.offset + len));
    this.offset += len;
    return str;
  }

  readFloat64() {
    const val = new DataView(this.buf.buffer, this.buf.byteOffset + this.offset, 8).getFloat64(0, false);
    this.offset += 8;
    return val;
  }

  readId() {
    const client = this.readVarint();
    const clock = this.readVarint();
    return (client * 0x100000000) + clock;
  }

  readBuffer() {
    const len = this.readVarint();
    const buf = this.buf.subarray(this.offset, this.offset + len);
    this.offset += len;
    return buf;
  }
}

module.exports = { Encoder, Decoder };
