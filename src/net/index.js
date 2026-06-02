const { SyncProtocol, Awareness, MSG_TYPE } = require('./protocol');
const { Provider, WebSocketProvider, WebSocketServerProvider } = require('./provider');

class NetworkManager {
  constructor(crdt, options = {}) {
    this.crdt = crdt;
    this.options = options;
    this.protocol = new SyncProtocol();
    this.awareness = new Awareness(crdt.clientId);
    this.provider = null;
    this.synced = false;
    this.pendingBuffer = [];
  }

  connectWebSocket(url, options = {}) {
    const provider = new WebSocketProvider(this.crdt, url, options);
    return this._setupProvider(provider);
  }

  createServer(port = 3001, options = {}) {
    const provider = new WebSocketServerProvider(this.crdt, { ...options, port });
    return this._setupProvider(provider);
  }

  _setupProvider(provider) {
    this.provider = provider;

    provider.on('connect', () => {
      this._sendSyncStep1();
    });

    provider.on('message', (data) => {
      this._handleMessage(data);
    });

    provider.on('batch', (ops) => {
      if (this.provider && this.provider.connected) {
        const buf = this.protocol.encodeUpdate(ops);
        this.provider.send(buf);
      }
    });

    return provider;
  }

  _sendSyncStep1() {
    const sv = this.crdt.getStateVector();
    const buf = this.protocol.encodeSyncStep1(this.crdt, sv);
    if (this.provider) this.provider.send(buf);
  }

  _handleMessage(data) {
    const msgType = this.protocol.decodeMessageType(data);
    switch (msgType) {
      case MSG_TYPE.SYNC_STEP1: {
        const msg = this.protocol.decodeSyncStep1(data);
        this.crdt.applyRemoteOps([]);
        const sv = this.crdt.getStateVector();
        const replyBuf = this.protocol.encodeSyncStep2(this.crdt, []);
        if (this.provider) this.provider.send(replyBuf);
        this.synced = true;
        break;
      }
      case MSG_TYPE.SYNC_STEP2: {
        const ops = this.protocol.decodeSyncStep2(data);
        if (ops.length > 0) {
          this.crdt.applyRemoteOps(ops);
        }
        this.synced = true;
        break;
      }
      case MSG_TYPE.SYNC_UPDATE: {
        const ops = this.protocol.decodeUpdate(data);
        this.crdt.applyRemoteOps(ops);
        break;
      }
      case MSG_TYPE.AWARENESS: {
        const msg = this.protocol.decodeAwareness(data);
        this.awareness.applyRemoteState(msg.clientId, msg.state);
        break;
      }
      case MSG_TYPE.PING: {
        if (this.provider) this.provider.send(this.protocol.encodePong());
        break;
      }
      case MSG_TYPE.PONG: {
        break;
      }
    }
  }

  broadcastAwareness() {
    if (this.provider && this.provider.connected) {
      const buf = this.protocol.encodeAwareness(this.awareness);
      this.provider.send(buf);
    }
  }

  disconnect() {
    if (this.provider) {
      this.provider.destroy();
      this.provider = null;
    }
    this.synced = false;
  }

  isConnected() {
    return this.provider ? this.provider.connected : false;
  }

  getRemoteClients() {
    return Array.from(this.awareness.remoteStates.keys());
  }
}

module.exports = { NetworkManager, SyncProtocol, Awareness, Provider, WebSocketProvider, WebSocketServerProvider };
