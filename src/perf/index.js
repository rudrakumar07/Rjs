const { OperationBatcher, Debouncer, Throttler } = require('./batcher');
const { PredictiveCache, DocumentRegionCache } = require('./cache');

class PerformanceOptimizer {
  constructor(crdt, options = {}) {
    this.crdt = crdt;
    this.options = options;
    this.batcher = new OperationBatcher({
      maxBatchSize: options.maxBatchSize || 100,
      flushInterval: options.flushInterval || 50
    });
    this.cache = new PredictiveCache({
      maxSize: options.cacheSize || 1000,
      ttl: options.cacheTTL || 30000
    });
    this.regionCache = options.documentSize > 100000
      ? new DocumentRegionCache(crdt, { regionSize: options.regionSize || 4096 })
      : null;
    this.engagementThrottler = new Throttler(options.engagementThrottle || 500);
    this.debouncer = new Debouncer(options.debounceDelay || 100);
    this.enabled = true;
  }

  enable() {
    this.enabled = true;
  }

  disable() {
    this.enabled = false;
  }

  async batchOperation(fn) {
    if (!this.enabled) return fn();
    return new Promise((resolve) => {
      this.batcher.onFlush((batch) => {
        const result = fn(batch);
        resolve(result);
      });
    });
  }

  cacheResult(key, fn) {
    if (!this.enabled) return fn();
    const cached = this.cache.get(key);
    if (cached !== null) return cached;
    const result = fn();
    this.cache.set(key, result);
    return result;
  }

  getStats() {
    return {
      batcherSize: this.batcher.size,
      cacheStats: this.cache.getStats(),
      regionCacheSize: this.regionCache ? this.regionCache.getSize() : 0
    };
  }

  destroy() {
    this.batcher.destroy();
    this.debouncer.destroy();
    this.engagementThrottler.destroy();
    this.cache.clear();
    if (this.regionCache) this.regionCache.invalidateAll();
  }
}

module.exports = { PerformanceOptimizer, OperationBatcher, Debouncer, Throttler, PredictiveCache, DocumentRegionCache };
