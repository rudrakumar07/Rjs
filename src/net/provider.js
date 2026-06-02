const EventEmitter = require('events');

class Provider extends EventEmitter {
  constructor(crdt, options = {}) {
    super();
    this.crdt = crdt;
    this.options = options;
    this.connected = false;
    this.connecting = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 10;
    this.reconnectDelay = options.reconnectDelay || 1000;
    this.reconnectTimer = null;
    this.batchTimer = null;
    this.pendingOps = [];
    this.batchDelay = options.batchDelay || 50;
    this._bound = this._onLocalUpdate.bind(this);
    this.crdt.observe('update', this._bound);
  }

  connect() {
    throw new Error('Provider.connect() must be implemented by subclass');
  }

  disconnect() {
    throw new Error('Provider.disconnect() must be implemented by subclass');
  }

  send(data) {
    throw new Error('Provider.send() must be implemented by subclass');
  }

  _onLocalUpdate(ops) {
    this.pendingOps.push(...ops);
    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => this._flushBatch(), this.batchDelay);
    }
  }

  _flushBatch() {
    this.batchTimer = null;
    if (this.pendingOps.length === 0) return;
    const ops = this.pendingOps;
    this.pendingOps = [];
    this.emit('batch', ops);
  }

  _onMessage(data) {
    this.emit('message', data);
  }

  _onConnect() {
    this.connected = true;
    this.connecting = false;
    this.reconnectAttempts = 0;
    this.emit('connect');
  }

  _onDisconnect() {
    this.connected = false;
    this.emit('disconnect');
    this._scheduleReconnect();
  }

  _scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit('reconnect-failed');
      return;
    }
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      if (!this.connected && !this.connecting) {
        this.connecting = true;
        this.connect();
      }
    }, delay);
  }

  _clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  destroy() {
    this._clearReconnect();
    if (this.batchTimer) clearTimeout(this.batchTimer);
    this.disconnect();
    this.removeAllListeners();
  }
}

class WebSocketProvider extends Provider {
  constructor(crdt, url, options = {}) {
    super(crdt, options);
    this.url = url;
    this.ws = null;
    this.protocol = options.protocol || 'rjs-protocol';
  }

  connect() {
    try {
      this.ws = new WebSocket(this.url, this.protocol);
      this.ws.binaryType = 'arraybuffer';
      this.ws.onopen = () => this._onConnect();
      this.ws.onclose = () => this._onDisconnect();
      this.ws.onerror = (err) => this.emit('error', err);
      this.ws.onmessage = (event) => {
        const data = new Uint8Array(event.data);
        this._onMessage(data);
      };
    } catch (err) {
      this.emit('error', err);
      this._scheduleReconnect();
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
    this._onDisconnect();
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
      return true;
    }
    return false;
  }
}

class WebSocketServerProvider extends Provider {
  constructor(crdt, options = {}) {
    super(crdt, options);
    this.port = options.port || 3001;
    this.server = null;
    this.clients = new Set();
    this._wsModule = null;
  }

  async connect() {
    try {
      const WebSocket = require('ws');
      this._wsModule = WebSocket;
    } catch (e) {
      this.emit('error', new Error('ws module not available. Install with: npm install ws'));
      return;
    }
    try {
      const WebSocketServer = this._wsModule.Server || this._wsModule.WebSocketServer;
      if (WebSocketServer) {
        this.server = new WebSocketServer({ port: this.port });
      } else {
        this.server = new this._wsModule.Server({ port: this.port });
      }
      this.server.on('connection', (ws) => {
        this.clients.add(ws);
        ws.on('message', (data) => {
          const buf = data instanceof Buffer ? new Uint8Array(data) : new Uint8Array(data);
          this._onMessage(buf);
        });
        ws.on('close', () => {
          this.clients.delete(ws);
        });
        ws.on('error', (err) => this.emit('error', err));
      });
      this.server.on('error', (err) => this.emit('error', err));
      this._onConnect();
    } catch (err) {
      this.emit('error', err);
    }
  }

  disconnect() {
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this._onDisconnect();
  }

  send(data) {
    let sent = 0;
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer || data);
    for (const client of this.clients) {
      try {
        client.send(buf);
        sent++;
      } catch (e) {
        this.emit('error', e);
      }
    }
    return sent;
  }
}

module.exports = { Provider, WebSocketProvider, WebSocketServerProvider };
