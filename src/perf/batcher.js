class OperationBatcher {
  constructor(options = {}) {
    this.maxBatchSize = options.maxBatchSize || 100;
    this.flushInterval = options.flushInterval || 50;
    this.queue = [];
    this.timer = null;
    this.flushCallback = null;
    this.pendingFlush = false;
  }

  onFlush(callback) {
    this.flushCallback = callback;
  }

  add(op) {
    this.queue.push(op);
    if (this.queue.length >= this.maxBatchSize) {
      this.flush();
    } else if (!this.pendingFlush) {
      this.pendingFlush = true;
      this.timer = setTimeout(() => this.flush(), this.flushInterval);
    }
  }

  flush() {
    if (this.pendingFlush && this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pendingFlush = false;
    if (this.queue.length === 0) return;
    const batch = this.queue;
    this.queue = [];
    if (this.flushCallback) this.flushCallback(batch);
  }

  get size() {
    return this.queue.length;
  }

  clear() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pendingFlush = false;
    this.queue = [];
  }

  destroy() {
    this.clear();
    this.flushCallback = null;
  }
}

class Debouncer {
  constructor(delay = 100) {
    this.delay = delay;
    this.timer = null;
    this.callback = null;
  }

  onCall(callback) {
    this.callback = callback;
  }

  trigger() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.callback) this.callback();
    }, this.delay);
  }

  cancel() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  destroy() {
    this.cancel();
    this.callback = null;
  }
}

class Throttler {
  constructor(limit = 1000) {
    this.limit = limit;
    this.lastCall = 0;
    this.pending = false;
    this.callback = null;
    this.timer = null;
  }

  onCall(callback) {
    this.callback = callback;
  }

  trigger() {
    const now = Date.now();
    const elapsed = now - this.lastCall;
    if (elapsed >= this.limit) {
      this.lastCall = now;
      if (this.callback) this.callback();
    } else if (!this.pending) {
      this.pending = true;
      this.timer = setTimeout(() => {
        this.pending = false;
        this.lastCall = Date.now();
        if (this.callback) this.callback();
      }, this.limit - elapsed);
    }
  }

  cancel() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = false;
  }

  destroy() {
    this.cancel();
    this.callback = null;
  }
}

module.exports = { OperationBatcher, Debouncer, Throttler };
