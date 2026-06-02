class StringArena {
  constructor() {
    this.strings = [];
    this.dedup = new Map();
    this.refCounts = [];
    this.freeSlots = [];
  }

  intern(str) {
    const existing = this.dedup.get(str);
    if (existing !== undefined) {
      this.refCounts[existing] = (this.refCounts[existing] || 1) + 1;
      return existing;
    }
    let id;
    if (this.freeSlots.length > 0) {
      id = this.freeSlots.pop();
      this.strings[id] = str;
    } else {
      id = this.strings.length;
      this.strings.push(str);
    }
    this.dedup.set(str, id);
    this.refCounts[id] = 1;
    return id;
  }

  get(id) {
    if (id < 0 || id >= this.strings.length) return null;
    return this.strings[id];
  }

  release(id) {
    if (id < 0 || id >= this.refCounts.length) return false;
    const count = this.refCounts[id];
    if (count <= 1) {
      const str = this.strings[id];
      if (str !== null && str !== undefined) {
        this.dedup.delete(str);
      }
      this.strings[id] = null;
      this.refCounts[id] = 0;
      this.freeSlots.push(id);
      return true;
    }
    this.refCounts[id] = count - 1;
    return false;
  }

  retain(id) {
    if (id >= 0 && id < this.refCounts.length) {
      this.refCounts[id] = (this.refCounts[id] || 0) + 1;
    }
  }

  getRefCount(id) {
    return id >= 0 && id < this.refCounts.length ? this.refCounts[id] : 0;
  }

  compact() {
    let freed = 0;
    for (let i = 0; i < this.strings.length; i++) {
      if (this.strings[i] !== null && this.strings[i] !== undefined) {
        if (!this.refCounts[i] || this.refCounts[i] <= 0) {
          const str = this.strings[i];
          this.dedup.delete(str);
          this.strings[i] = null;
          this.refCounts[i] = 0;
          this.freeSlots.push(i);
          freed++;
        }
      }
    }
    return { freed, remaining: this.strings.length - this.freeSlots.length };
  }

  get size() {
    return this.strings.length - this.freeSlots.length;
  }

  get totalSlots() {
    return this.strings.length;
  }
}

class MemoryPool {
  constructor(initialSize = 4096) {
    this.buffer = new ArrayBuffer(initialSize);
    this.view = new Uint8Array(this.buffer);
    this.offset = 0;
    this.blocks = new Map();
    this.freeList = [];
    this.growthFactor = 1.5;
  }

  alloc(size) {
    if (size <= 0) return null;
    for (let i = 0; i < this.freeList.length; i++) {
      if (this.freeList[i].size >= size) {
        const block = this.freeList.splice(i, 1)[0];
        return block;
      }
    }
    if (this.offset + size > this.view.length) {
      const newSize = Math.max(
        Math.ceil(this.view.length * this.growthFactor),
        this.offset + size
      );
      const newBuffer = new ArrayBuffer(newSize);
      new Uint8Array(newBuffer).set(this.view);
      this.buffer = newBuffer;
      this.view = new Uint8Array(this.buffer);
    }
    const start = this.offset;
    this.offset += size;
    const block = { buffer: this.buffer, start, size, id: start, refCount: 0 };
    this.blocks.set(start, block);
    return block;
  }

  free(block) {
    if (!block) return;
    this.freeList.push(block);
    this.blocks.delete(block.id);
  }

  getUsage() {
    return this.offset > 0 ? this.offset / this.view.length : 0;
  }

  get totalSize() {
    return this.view.length;
  }

  get usedSize() {
    return this.offset;
  }

  compact() {
    if (this.freeList.length === 0 && this.blocks.size === 0) return;
    const liveBlocks = Array.from(this.blocks.values()).sort((a, b) => a.start - b.start);
    if (liveBlocks.length === 0) {
      this.offset = 0;
      return;
    }
    let writeOffset = 0;
    for (const block of liveBlocks) {
      if (block.start !== writeOffset) {
        this.view.copyWithin(writeOffset, block.start, block.start + block.size);
        block.start = writeOffset;
      }
      writeOffset += block.size;
    }
    this.offset = writeOffset;
    this.freeList = [];
  }

  release() {
    this.buffer = null;
    this.view = null;
    this.blocks.clear();
    this.freeList = [];
    this.offset = 0;
  }
}

class SharedArena {
  constructor() {
    this.stringArena = new StringArena();
    this.memoryPool = new MemoryPool();
    this.blocks = new Map();
    this.tombstones = new Set();
  }

  intern(str) {
    return this.stringArena.intern(str);
  }

  getString(id) {
    return this.stringArena.get(id);
  }

  releaseString(id) {
    return this.stringArena.release(id);
  }

  allocBlock(size) {
    return this.memoryPool.alloc(size);
  }

  freeBlock(block) {
    this.memoryPool.free(block);
  }

  trackBlock(id, block) {
    this.blocks.set(id, block);
  }

  markTombstone(id) {
    this.tombstones.add(id);
  }

  sweepTombstones() {
    let count = 0;
    for (const id of this.tombstones) {
      const block = this.blocks.get(id);
      if (block && (!block.refCount || block.refCount <= 0)) {
        this.blocks.delete(id);
        this.memoryPool.free(block);
        count++;
      }
    }
    this.tombstones.clear();
    return count;
  }

  getStats() {
    return {
      strings: this.stringArena.size,
      poolUsage: this.memoryPool.getUsage(),
      poolSize: this.memoryPool.totalSize,
      blocks: this.blocks.size,
      tombstones: this.tombstones.size
    };
  }
}

module.exports = { SharedArena, StringArena, MemoryPool };
