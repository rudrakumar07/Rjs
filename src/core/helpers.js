const { RGABlock } = require('./block_rga');

function linkBlockToTail(rga, block) {
  if (rga.tail) {
    rga.tail.next = block;
    block.prev = rga.tail;
    rga.tail = block;
  } else {
    rga.head = block;
    rga.tail = block;
  }
}

function importBlocks(sourceRga, targetRga) {
  let cur = sourceRga.head;
  while (cur) {
    if (!targetRga.byId.has(cur.id)) {
      linkBlockToTail(targetRga, cur);
      targetRga.byId.set(cur.id, cur);
      if (!cur.isDeleted) targetRga._visibleLen += cur.len;
    }
    cur = cur.next;
  }
  targetRga.invalidateCache();
}

module.exports = { linkBlockToTail, importBlocks };
