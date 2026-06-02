class PredictiveCache {
  constructor(options = {}) {
    this.maxSize = options.maxSize || 1000;
    this.ttl = options.ttl || 30000;
    this.maxAccessLog = options.maxAccessLog || 100;
    this.cache = new Map();
    this.accessLog = [];
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  get(key) {
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.timestamp < this.ttl) {
      entry.hits++;
      this._logAccess(key);
      this.hits++;
      return entry.value;
    }
    if (entry) this.cache.delete(key);
    this.misses++;
    return null;
  }

  _logAccess(key) {
    this.accessLog.push({ key, time: Date.now() });
    if (this.accessLog.length > this.maxAccessLog) {
      this.accessLog.splice(0, this.accessLog.length - this.maxAccessLog);
    }
  }

  set(key, value) {
    if (this.cache.size >= this.maxSize) {
      this._evict();
    }
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      hits: 0
    });
  }

  _evict() {
    let oldest = Date.now();
    let oldestKey = null;
    for (const [key, entry] of this.cache) {
      if (entry.timestamp < oldest) {
        oldest = entry.timestamp;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.evictions++;
    }
  }

  invalidate(key) {
    this.cache.delete(key);
  }

  invalidatePattern(pattern) {
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) this.cache.delete(key);
    }
  }

  clear() {
    this.cache.clear();
  }

  getStats() {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? (this.hits / total * 100).toFixed(1) + '%' : '0%',
      evictions: this.evictions
    };
  }

  async prefetch(keys, fetcher) {
    const toFetch = keys.filter(k => !this.get(k));
    if (toFetch.length === 0) return;
    try {
      const results = await fetcher(toFetch);
      for (const [key, value] of Object.entries(results)) {
        this.set(key, value);
      }
    } catch (e) {
      // Prefetch failed silently; entries will be fetched on demand
    }
  }
}

class DocumentRegionCache {
  constructor(doc, options = {}) {
    this.doc = doc;
    this.regionSize = options.regionSize || 4096;
    this.maxRegions = options.maxRegions || 100;
    this.cache = new Map();
  }

  getRegion(index) {
    const regionIndex = Math.floor(index / this.regionSize);
    return this.cache.get(regionIndex);
  }

  setRegion(index, data) {
    const regionIndex = Math.floor(index / this.regionSize);
    if (this.cache.size >= this.maxRegions) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(regionIndex, data);
  }

  invalidateRegion(index) {
    const regionIndex = Math.floor(index / this.regionSize);
    this.cache.delete(regionIndex);
  }

  invalidateAll() {
    this.cache.clear();
  }

  getSize() {
    return this.cache.size;
  }
}

module.exports = { PredictiveCache, DocumentRegionCache };
