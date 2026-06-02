const TOMBSTONE_RATIO = 0.3;
const MIN_BLOCKS_FOR_PROACTIVE_GC = 100;

class GarbageCollector {
  constructor(options = {}) {
    this.tombstoneThreshold = options.tombstoneThreshold || 200;
    this.gcInterval = options.gcInterval || 5000;
    this.ageThreshold = options.ageThreshold || 5000;
    this.lastGC = Date.now();
    this.tombstoneCount = 0;
    this.gcRuns = 0;
    this.totalCollected = 0;
  }

  trackDeletion(block) {
    block.deleteTime = Date.now();
    this.tombstoneCount++;
  }

  shouldCollect() {
    const now = Date.now();
    return this.tombstoneCount >= this.tombstoneThreshold ||
      (now - this.lastGC) >= this.gcInterval;
  }

  collect(crdt) {
    if (!this.shouldCollect()) {
      if (!this._shouldProactiveGC(crdt)) return 0;
      this.lastGC = 0;
    }
    return this._sweepOldTombstones(crdt);
  }

  _shouldProactiveGC(crdt) {
    let totalBlocks = 0, totalTombstones = 0;
    for (const [, text] of crdt.texts) {
      let cur = text.rga.head;
      while (cur) {
        totalBlocks++;
        if (cur.isDeleted) totalTombstones++;
        cur = cur.next;
      }
    }
    return totalBlocks > MIN_BLOCKS_FOR_PROACTIVE_GC &&
      totalTombstones > totalBlocks * TOMBSTONE_RATIO;
  }

  _sweepOldTombstones(crdt) {
    const now = Date.now();
    let collected = 0;
    const allDeleted = [];
    for (const [, text] of crdt.texts) {
      let cur = text.rga.head;
      while (cur) {
        if (cur.isDeleted) allDeleted.push({ text, block: cur });
        cur = cur.next;
      }
    }
    for (const { text, block } of allDeleted) {
      if (block.deleteTime && (now - block.deleteTime) > this.ageThreshold) {
        text.rga.byId.delete(block.id);
        if (block.prev) block.prev.next = block.next;
        if (block.next) block.next.prev = block.prev;
        if (text.rga.head === block) text.rga.head = block.next;
        if (text.rga.tail === block) text.rga.tail = block.prev;
        collected++;
      }
    }
    this.tombstoneCount = this._countTombstones(crdt);
    this.lastGC = now;
    this.gcRuns++;
    this.totalCollected += collected;
    return collected;
  }

  _countTombstones(crdt) {
    let count = 0;
    for (const [, text] of crdt.texts) {
      let cur = text.rga.head;
      while (cur) {
        if (cur.isDeleted) count++;
        cur = cur.next;
      }
    }
    return count;
  }

  getStats() {
    return {
      gcRuns: this.gcRuns,
      totalCollected: this.totalCollected,
      currentTombstones: this.tombstoneCount,
      lastGC: new Date(this.lastGC).toISOString()
    };
  }
}

module.exports = { GarbageCollector };
