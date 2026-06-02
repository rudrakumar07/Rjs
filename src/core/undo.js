class UndoManager {
  constructor(crdt, options = {}) {
    this.crdt = crdt;
    this.undoStack = [];
    this.redoStack = [];
    this.maxStackSize = options.maxStackSize || 100;
    this.capturing = true;
    this._currentGroup = null;
    this._origin = null;
    this._lastOrigin = null;
    this._trackedOrigins = options.trackedOrigins || null;
    this._deleteFilter = options.deleteFilter || null;
    this._mergedInterval = options.mergedInterval || 0;
    this.captureTimeout = options.captureTimeout || 0;
    this.ignoreRemoteAttributeChanges = options.ignoreRemoteAttributeChanges || false;
    this._listeners = new Map();
    this._pendingCapture = null;
    this._captureTimer = null;
    this._applying = false;
    this._unsubBeforeUpdate = crdt.observe('before-update', (ops) => this._onBeforeUpdate(ops));
    this._unsubUpdate = crdt.observe('update', (ops) => this._onUpdate(ops));
  }

  on(event, handler) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(handler);
    return () => {
      const handlers = this._listeners.get(event);
      if (handlers) {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      }
    };
  }

  _emit(event, data) {
    const handlers = this._listeners.get(event);
    if (handlers) {
      for (const h of handlers) h(data);
    }
  }

  setOrigin(origin) {
    this._origin = origin;
  }

  stopCapturing() {
    this.capturing = false;
  }

  clear() {
    const undoCleared = this.undoStack.length > 0;
    const redoCleared = this.redoStack.length > 0;
    this.undoStack = [];
    this.redoStack = [];
    this._currentGroup = null;
    if (this._captureTimer) {
      clearTimeout(this._captureTimer);
      this._captureTimer = null;
    }
    this._emit('stack-cleared', { undoStackCleared: undoCleared, redoStackCleared: redoCleared });
  }

  _shouldIgnoreRemote(op) {
    if (this.ignoreRemoteAttributeChanges) {
      if (op.type === 'map-set' || op.type === 'map-delete') return true;
    }
    return false;
  }

  _shouldTrack(op) {
    if (this._applying) return false;
    if (this._trackedOrigins && this._origin !== null) {
      return this._trackedOrigins.has(this._origin);
    }
    if (this._deleteFilter && op.type === 'text-delete') {
      return this._deleteFilter(op);
    }
    if (this._shouldIgnoreRemote(op)) return false;
    return true;
  }

  _onBeforeUpdate(ops) {
    if (!this.capturing) return;
    const filtered = ops.filter(op => this._shouldTrack(op));
    if (filtered.length === 0) return;

    this._pendingCapture = [];
    for (const op of filtered) {
      const before = {};
      if (op.type === 'text-delete') {
        const text = this.crdt.texts.get(op.name);
        if (text) before.deletedContent = text.toString().slice(op.pos, op.pos + op.len);
      } else if (op.type === 'map-set') {
        const map = this.crdt.maps.get(op.name);
        if (map) before.oldValue = map._vals.has(op.key) ? map._vals.get(op.key) : undefined;
      } else if (op.type === 'map-delete') {
        const map = this.crdt.maps.get(op.name);
        if (map) before.oldValue = map._vals.has(op.key) ? map._vals.get(op.key) : undefined;
      } else if (op.type === 'array-delete') {
        const arr = this.crdt.arrays.get(op.name);
        if (arr) before.deletedItems = arr.items.slice(op.pos, op.pos + op.len);
      } else if (op.type === 'counter-add') {
        const counter = this.crdt.counters.get(op.name);
        if (counter) before.oldValue = counter.value;
      }
      this._pendingCapture.push({ op, before });
    }
  }

  _onUpdate(ops) {
    if (!this.capturing) return;
    if (ops.length === 0) return;

    const filtered = ops.filter(op => this._shouldTrack(op));
    if (filtered.length === 0) return;

    const inverseOps = this._buildInverseOps(filtered);
    if (inverseOps.length === 0) return;

    const origin = this._origin;
    const now = Date.now();

    if (this._origin !== null && this._lastOrigin !== null &&
        this._origin === this._lastOrigin &&
        this._mergedInterval > 0 &&
        this._currentGroup &&
        (now - this._currentGroup._timestamp) < this._mergedInterval) {
      this._currentGroup.ops.push(...inverseOps);
      this._currentGroup._origin = origin;
      this._emit('stack-item-updated', { stackItem: this._currentGroup, type: 'undo' });
    } else if (this._currentGroup && this._currentGroup.ops.length > 0 &&
               this._currentGroup._origin !== origin) {
      this._pushStack(this._currentGroup);
      this._currentGroup = { ops: [...inverseOps], _origin: origin, _timestamp: now, meta: new Map() };
    } else {
      if (this._currentGroup && this._currentGroup.ops.length > 0) {
        this._pushStack(this._currentGroup);
      }
      this._currentGroup = { ops: [...inverseOps], _origin: origin, _timestamp: now, meta: new Map() };
    }

    if (this.captureTimeout > 0 && !this._captureTimer) {
      this._captureTimer = setTimeout(() => {
        this._captureTimer = null;
        this._flushCurrentGroup();
      }, this.captureTimeout);
    }

    this._lastOrigin = origin;
    this._pendingCapture = null;
  }

  _buildInverseOps(ops) {
    const inverse = [];
    const capture = this._pendingCapture || [];
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      const before = capture[i] ? capture[i].before : {};

      switch (op.type) {
        case 'text-insert':
          inverse.push({ type: 'text-delete', name: op.name, pos: op.pos, len: op.content.length });
          break;
        case 'text-delete': {
          const deleted = before.deletedContent || '';
          if (deleted) {
            inverse.push({ type: 'text-insert', name: op.name, pos: op.pos, content: deleted });
          }
          break;
        }
        case 'map-set': {
          const oldVal = before.oldValue;
          if (oldVal !== undefined) {
            inverse.push({ type: 'map-set', name: op.name, key: op.key, value: oldVal });
          } else {
            inverse.push({ type: 'map-delete', name: op.name, key: op.key });
          }
          break;
        }
        case 'map-delete': {
          if (before.oldValue !== undefined) {
            inverse.push({ type: 'map-set', name: op.name, key: op.key, value: before.oldValue });
          }
          break;
        }
        case 'array-insert': {
          const len = Array.isArray(op.value) ? op.value.length : 1;
          inverse.push({ type: 'array-delete', name: op.name, pos: op.pos, len });
          break;
        }
        case 'array-delete': {
          const items = before.deletedItems || [];
          for (let j = items.length - 1; j >= 0; j--) {
            inverse.push({ type: 'array-insert', name: op.name, pos: op.pos, value: items[j] });
          }
          break;
        }
        case 'counter-add': {
          const diff = -(op.value);
          inverse.push({ type: 'counter-add', name: op.name, value: diff });
          break;
        }
      }
    }
    return inverse;
  }

  _flushCurrentGroup() {
    if (this._captureTimer) {
      clearTimeout(this._captureTimer);
      this._captureTimer = null;
    }
    if (this._currentGroup && this._currentGroup.ops.length > 0) {
      this._pushStack(this._currentGroup);
      this._currentGroup = null;
    }
  }

  _pushStack(group) {
    this.undoStack.push(group);
    if (this.undoStack.length > this.maxStackSize) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this._emit('stack-item-added', { stackItem: group, type: 'undo' });
  }

  undo() {
    this._flushCurrentGroup();
    if (this.undoStack.length === 0) return null;
    const group = this.undoStack.pop();
    const redoGroup = { ops: [], _origin: group._origin, _timestamp: Date.now(), meta: new Map() };
    const applied = [];

    this._applying = true;
    for (const op of group.ops) {
      const inverse = this._applySingleOp(op);
      if (inverse) {
        redoGroup.ops.push(inverse);
        applied.push(op);
      }
    }
    this._applying = false;

    if (redoGroup.ops.length > 0) {
      this.redoStack.push(redoGroup);
      this._emit('stack-item-added', { stackItem: redoGroup, type: 'redo' });
    }

    this._emit('stack-item-popped', { stack: 'undo', group });
    return applied;
  }

  redo() {
    if (this.redoStack.length === 0) return null;
    const group = this.redoStack.pop();
    const undoGroup = { ops: [], _origin: group._origin, _timestamp: Date.now(), meta: new Map() };
    const applied = [];

    this._applying = true;
    for (const op of group.ops) {
      const inverse = this._applySingleOp(op);
      if (inverse) {
        undoGroup.ops.push(inverse);
        applied.push(op);
      }
    }
    this._applying = false;

    if (undoGroup.ops.length > 0) {
      this.undoStack.push(undoGroup);
      this._emit('stack-item-added', { stackItem: undoGroup, type: 'undo' });
    }

    this._emit('stack-item-popped', { stack: 'redo', group });
    return applied;
  }

  _applySingleOp(op) {
    switch (op.type) {
      case 'text-insert': {
        const text = this.crdt.texts.get(op.name);
        if (!text) return null;
        text.insert(op.pos, op.content);
        return { type: 'text-delete', name: op.name, pos: op.pos, len: op.content.length };
      }
      case 'text-delete': {
        const text = this.crdt.texts.get(op.name);
        if (!text || op.pos >= text.length) return null;
        const deleted = text.toString().slice(op.pos, op.pos + op.len);
        if (!deleted) return null;
        text.delete(op.pos, op.len);
        return { type: 'text-insert', name: op.name, pos: op.pos, content: deleted };
      }
      case 'map-set': {
        const map = this.crdt.maps.get(op.name);
        if (!map) return null;
        const oldVal = map.get(op.key);
        map.set(op.key, op.value);
        return oldVal !== undefined
          ? { type: 'map-set', name: op.name, key: op.key, value: oldVal }
          : { type: 'map-delete', name: op.name, key: op.key };
      }
      case 'map-delete': {
        const map = this.crdt.maps.get(op.name);
        if (!map || !map.has(op.key)) return null;
        const oldVal = map.get(op.key);
        map.delete(op.key);
        return { type: 'map-set', name: op.name, key: op.key, value: oldVal };
      }
      case 'array-insert': {
        const arr = this.crdt.arrays.get(op.name);
        if (!arr) return null;
        const len = Array.isArray(op.value) ? op.value.length : 1;
        arr.insert(op.pos, op.value);
        return { type: 'array-delete', name: op.name, pos: op.pos, len };
      }
      case 'array-delete': {
        const arr = this.crdt.arrays.get(op.name);
        if (!arr || op.pos >= arr.length) return null;
        const deleted = arr.items.slice(op.pos, op.pos + op.len);
        arr.delete(op.pos, op.len);
        return { type: 'array-insert', name: op.name, pos: op.pos, value: deleted.length === 1 ? deleted[0] : deleted };
      }
      case 'counter-add': {
        const counter = this.crdt.counters.get(op.name);
        if (!counter) return null;
        counter.add(op.value);
        return { type: 'counter-add', name: op.name, value: -op.value };
      }
    }
    return null;
  }

  destroy() {
    if (this._captureTimer) clearTimeout(this._captureTimer);
    if (this._unsubBeforeUpdate) this._unsubBeforeUpdate();
    if (this._unsubUpdate) this._unsubUpdate();
    this.undoStack = [];
    this.redoStack = [];
    this._currentGroup = null;
    this._listeners.clear();
  }
}

module.exports = { UndoManager };
