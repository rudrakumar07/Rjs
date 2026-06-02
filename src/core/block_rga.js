const { ID } = require('./id');

const CHECKPOINT_INTERVAL = 32;

class RGABlock {
  constructor(id, content, originLeft, originRight) {
    this.id = id;
    this.content = content;
    this.len = content ? content.length : 0;
    this.originLeft = originLeft || 0;
    this.originRight = originRight || 0;
    this.isDeleted = false;
    this.next = null;
    this.prev = null;
  }
}

const _blockPool = [];

function allocBlock(id, content, originLeft, originRight) {
  const block = _blockPool.length > 0
    ? _blockPool.pop()
    : new RGABlock(0, '', 0, 0);
  block.id = id;
  block.content = content;
  block.len = content.length;
  block.originLeft = originLeft || 0;
  block.originRight = originRight || 0;
  block.isDeleted = false;
  block.next = null;
  block.prev = null;
  return block;
}

function freeBlock(block) {
  block.next = null;
  block.prev = null;
  _blockPool.push(block);
}

class BlockRGA {
  constructor(clientId) {
    this.idGen = null;
    this.clientId = clientId;
    this.head = null;
    this.tail = null;
    this.byId = new Map();
    this.originLeft = 0;
    this.originRight = 0;
    this._visibleLen = 0;
    this._strDirty = true;
    this._cachedStr = '';
    this._checkpoints = [];
    this._checkpointDirty = true;
  }

  invalidateCache() {
    this._strDirty = true;
    this._checkpointDirty = true;
  }

  _markDirty() {
    this._strDirty = true;
    this._checkpointDirty = true;
  }

  _rebuildCheckpoints() {
    const checkpoints = [];
    let visCount = 0;
    let cumPos = 0;
    let cur = this.head;
    while (cur) {
      if (!cur.isDeleted) {
        if ((visCount & (CHECKPOINT_INTERVAL - 1)) === 0) {
          checkpoints.push({ block: cur, cumPos });
        }
        cumPos += cur.len;
        visCount++;
      }
      cur = cur.next;
    }
    this._checkpoints = checkpoints;
    this._checkpointDirty = false;
  }

  _findPos(pos) {
    if (this._visibleLen === 0) return null;
    if (this._checkpointDirty) this._rebuildCheckpoints();

    const { cur, count } = this._findStartBlock(pos);
    return this._walkToPos(cur, count, pos);
  }

  _findStartBlock(pos) {
    const cps = this._checkpoints;
    if (cps.length === 0) return { cur: this.head, count: 0 };

    let lo = 0, hi = cps.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cps[mid].cumPos <= pos) lo = mid;
      else hi = mid - 1;
    }
    return { cur: cps[lo].block, count: cps[lo].cumPos };
  }

  _walkToPos(cur, count, pos) {
    while (cur) {
      if (!cur.isDeleted) {
        if (count + cur.len > pos) return { block: cur, offset: pos - count };
        count += cur.len;
      }
      cur = cur.next;
    }
    return null;
  }

  insertAt(pos, content) {
    if (pos < 0) pos = 0;
    if (typeof content !== 'string') throw new Error('content must be a string');
    if (pos > this._visibleLen) pos = this._visibleLen;

    const id = ID.pack(this.clientId, this.idGen ? this.idGen.counter++ : 0);
    const block = allocBlock(id, content, 0, 0);

    if (pos === 0) this._insertAtStart(block);
    else if (pos >= this._visibleLen) this._insertAtEnd(block);
    else this._insertAtMiddle(block, pos);

    this.byId.set(id, block);
    this._visibleLen += content.length;
    this._markDirty();
    return block;
  }

  _insertAtStart(block) {
    block.originLeft = this.originLeft;
    if (this.head) {
      block.originRight = this.head.isDeleted ? 0 : this.head.id;
      this._insertBefore(block, this.head);
    } else {
      this.head = block;
      this.tail = block;
    }
  }

  _insertAtEnd(block) {
    const tail = this.tail;
    if (tail) {
      block.originLeft = tail.isDeleted ? this.originLeft : tail.id;
      block.originRight = this.originRight;
      block.prev = tail;
      tail.next = block;
      this.tail = block;
    } else {
      block.originLeft = this.originLeft;
      block.originRight = this.originRight;
      this.head = block;
      this.tail = block;
    }
  }

  _insertAtMiddle(block, pos) {
    const result = this._findPos(pos);
    if (result) {
      const target = result.block;
      block.originLeft = target.prev && !target.prev.isDeleted ? target.prev.id : this.originLeft;
      block.originRight = target.id;
      this._insertBefore(block, target);
    } else {
      block.originLeft = this.tail && !this.tail.isDeleted ? this.tail.id : this.originLeft;
      this._insertAfter(block, this.tail);
    }
  }

  deleteAt(pos, len) {
    if (len <= 0 || pos < 0) return 0;
    let remaining = len;
    while (remaining > 0) {
      const result = this._findPos(pos);
      if (!result) break;
      const { block, offset } = result;
      const toDelete = Math.min(remaining, block.len - offset);

      this._visibleLen -= toDelete;
      this._markDirty();

      if (offset === 0) this._deletePrefix(block, toDelete);
      else this._deleteMiddle(block, offset, toDelete);

      remaining -= toDelete;
    }
    return len - remaining;
  }

  _deletePrefix(block, toDelete) {
    if (toDelete >= block.len) {
      block.isDeleted = true;
      return;
    }
    const bClient = ID.client(block.id);
    const bClock = ID.clock(block.id);
    const keptContent = block.content.slice(toDelete);
    const keptId = ID.pack(bClient, bClock + toDelete);
    block.content = block.content.slice(0, toDelete);
    block.len = toDelete;
    block.isDeleted = true;
    const keptBlock = allocBlock(keptId, keptContent, block.originLeft, block.originRight);
    this._insertAfter(keptBlock, block);
    this.byId.set(keptId, keptBlock);
  }

  _deleteMiddle(block, offset, toDelete) {
    const bClient = ID.client(block.id);
    const bClock = ID.clock(block.id);
    const beforeContent = block.content.slice(0, offset);
    const delContent = block.content.slice(offset, offset + toDelete);
    const afterContent = block.content.slice(offset + toDelete);

    if (beforeContent.length > 0) {
      block.content = beforeContent;
      block.len = beforeContent.length;
    } else {
      block.isDeleted = true;
    }

    if (afterContent.length > 0) {
      const afterId = ID.pack(bClient, bClock + offset + toDelete);
      const afterBlock = allocBlock(afterId, afterContent, block.originLeft, block.originRight);
      this._insertAfter(afterBlock, block);
      this.byId.set(afterId, afterBlock);
    }

    if (delContent.length > 0 && beforeContent.length > 0) {
      const delId = ID.pack(bClient, bClock + offset);
      const delBlock = allocBlock(delId, delContent, block.originLeft, block.originRight);
      delBlock.isDeleted = true;
      this._insertAfter(delBlock, block);
      this.byId.set(delId, delBlock);
    }
  }

  _insertAfter(newBlock, after) {
    newBlock.prev = after;
    newBlock.next = after.next;
    if (after.next) after.next.prev = newBlock;
    else this.tail = newBlock;
    after.next = newBlock;
  }

  _insertBefore(newBlock, before) {
    newBlock.next = before;
    newBlock.prev = before.prev;
    if (before.prev) before.prev.next = newBlock;
    else this.head = newBlock;
    before.prev = newBlock;
  }

  getVisibleLength() { return this._visibleLen; }

  toString() {
    if (!this._strDirty) return this._cachedStr;
    const parts = [];
    let cur = this.head;
    while (cur) {
      if (!cur.isDeleted) parts.push(cur.content);
      cur = cur.next;
    }
    this._cachedStr = parts.join('');
    this._strDirty = false;
    return this._cachedStr;
  }

  toArray() {
    const result = [];
    let cur = this.head;
    while (cur) {
      if (!cur.isDeleted) result.push(cur.content);
      cur = cur.next;
    }
    return result;
  }

  findById(id) {
    return this.byId.get(typeof id === 'number' ? id : ID.pack(id.client, id.clock));
  }

  getAllBlocks() {
    const result = [];
    let cur = this.head;
    while (cur) {
      result.push(cur);
      cur = cur.next;
    }
    return result;
  }

  getStats() {
    let total = 0, deleted = 0, visible = 0, visibleChars = 0;
    let cur = this.head;
    while (cur) {
      total++;
      if (cur.isDeleted) deleted++;
      else { visible++; visibleChars += cur.len; }
      cur = cur.next;
    }
    return { totalBlocks: total, deletedBlocks: deleted, visibleBlocks: visible, visibleChars };
  }
}

module.exports = { BlockRGA, RGABlock, freeBlock };
