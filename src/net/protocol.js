const { Encoder, Decoder } = require('../serialization/encoder');
const { Serializer } = require('../serialization/serializer');

const MSG_TYPE = {
  SYNC_STEP1: 0,
  SYNC_STEP2: 1,
  SYNC_UPDATE: 2,
  AWARENESS: 3,
  AUTH: 4,
  PING: 5,
  PONG: 6,
};

class SyncProtocol {
  constructor(serializer) {
    this.serializer = serializer || new Serializer();
  }

  encodeSyncStep1(crdt, stateVector) {
    const enc = new Encoder();
    enc.writeUint8(MSG_TYPE.SYNC_STEP1);
    if (stateVector && stateVector.length > 0) {
      enc.writeVarint(stateVector.length);
      for (const sv of stateVector) {
        enc.writeVarint(sv.client);
        enc.writeVarint(sv.clock);
      }
    } else {
      enc.writeVarint(0);
    }
    const docBuf = this.serializer.encodeDocument(crdt, stateVector);
    enc.writeBuffer(docBuf);
    return enc.toBuffer();
  }

  decodeSyncStep1(buffer) {
    const dec = new Decoder(buffer);
    const type = dec.readUint8();
    if (type !== MSG_TYPE.SYNC_STEP1) throw new Error('Expected SYNC_STEP1');
    const svCount = dec.readVarint();
    const stateVector = [];
    for (let i = 0; i < svCount; i++) {
      stateVector.push({ client: dec.readVarint(), clock: dec.readVarint() });
    }
    const docBuf = dec.readBuffer();
    return { stateVector, docBuffer: docBuf };
  }

  encodeSyncStep2(crdt, missingOps) {
    const enc = new Encoder();
    enc.writeUint8(MSG_TYPE.SYNC_STEP2);
    const opsBuf = this.serializer.encodeOperations(missingOps);
    enc.writeBuffer(opsBuf);
    return enc.toBuffer();
  }

  decodeSyncStep2(buffer) {
    const dec = new Decoder(buffer);
    const type = dec.readUint8();
    if (type !== MSG_TYPE.SYNC_STEP2) throw new Error('Expected SYNC_STEP2');
    const opsBuf = dec.readBuffer();
    return this.serializer.decodeOperations(opsBuf);
  }

  encodeUpdate(ops) {
    const enc = new Encoder();
    enc.writeUint8(MSG_TYPE.SYNC_UPDATE);
    const opsBuf = this.serializer.encodeOperations(ops);
    enc.writeBuffer(opsBuf);
    return enc.toBuffer();
  }

  decodeUpdate(buffer) {
    const dec = new Decoder(buffer);
    const type = dec.readUint8();
    if (type !== MSG_TYPE.SYNC_UPDATE) throw new Error('Expected SYNC_UPDATE');
    const opsBuf = dec.readBuffer();
    return this.serializer.decodeOperations(opsBuf);
  }

  encodeAwareness(awareness) {
    const enc = new Encoder();
    enc.writeUint8(MSG_TYPE.AWARENESS);
    enc.writeVarint(awareness.clientId);
    const state = awareness.getState();
    const stateStr = JSON.stringify(state);
    enc.writeString(stateStr);
    return enc.toBuffer();
  }

  decodeAwareness(buffer) {
    const dec = new Decoder(buffer);
    const type = dec.readUint8();
    if (type !== MSG_TYPE.AWARENESS) throw new Error('Expected AWARENESS');
    const clientId = dec.readVarint();
    const stateStr = dec.readString();
    const state = JSON.parse(stateStr);
    return { clientId, state };
  }

  encodePing() {
    const enc = new Encoder();
    enc.writeUint8(MSG_TYPE.PING);
    return enc.toBuffer();
  }

  encodePong() {
    const enc = new Encoder();
    enc.writeUint8(MSG_TYPE.PONG);
    return enc.toBuffer();
  }

  decodeMessageType(buffer) {
    if (buffer.length === 0) return -1;
    return buffer[0];
  }
}

class Awareness {
  constructor(clientId) {
    this.clientId = clientId;
    this.state = {};
    this.remoteStates = new Map();
    this.listeners = [];
  }

  setState(state) {
    this.state = { ...this.state, ...state };
    this._notify();
  }

  getState() {
    return { ...this.state, clientId: this.clientId };
  }

  setLocalStateField(field, value) {
    this.state[field] = value;
    this._notify();
  }

  applyRemoteState(clientId, state) {
    this.remoteStates.set(clientId, state);
    this._notify();
  }

  getRemoteStates() {
    const result = {};
    for (const [clientId, state] of this.remoteStates) {
      result[clientId] = state;
    }
    return result;
  }

  onUpdate(callback) {
    this.listeners.push(callback);
    return () => {
      const idx = this.listeners.indexOf(callback);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  _notify() {
    const data = { local: this.getState(), remote: this.getRemoteStates() };
    for (const cb of this.listeners) cb(data);
  }
}

module.exports = { SyncProtocol, Awareness, MSG_TYPE };
