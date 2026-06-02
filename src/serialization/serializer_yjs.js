const Y = require('yjs');

const META_KEY = '__rjs_types__';

class YjsEncoder {
  constructor() {
    this.version = 1;
  }

  encodeDocument(crdt) {
    const ydoc = new Y.Doc();
    try {
      const meta = ydoc.getMap(META_KEY);

      for (const [name, text] of crdt.texts) {
        const ytext = ydoc.getText(name);
        const str = text.rga.toString();
        if (str.length > 0) ytext.insert(0, str);
        meta.set(name, 'text');
      }
      for (const [name, map] of crdt.maps) {
        const ymap = ydoc.getMap(name);
        ydoc.transact(() => {
          for (const [key, value] of map._vals) {
            ymap.set(key, this._toYjsValue(ydoc, value));
          }
        });
        meta.set(name, 'map');
      }
      for (const [name, arr] of crdt.arrays) {
        const yarr = ydoc.getArray(name);
        ydoc.transact(() => {
          for (const item of arr.items) {
            yarr.push([this._toYjsValue(ydoc, item)]);
          }
        });
        meta.set(name, 'array');
      }
      for (const [name, counter] of crdt.counters) {
        const ymap = ydoc.getMap('__counter__' + name);
        ydoc.transact(() => {
          ymap.set('value', counter.value);
        });
        meta.set('__counter__' + name, 'counter');
      }
      return Y.encodeStateAsUpdate(ydoc);
    } finally {
      ydoc.destroy();
    }
  }

  _toYjsValue(ydoc, value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) {
      const yarr = new Y.Array();
      ydoc.transact(() => {
        yarr.push(value.map(v => this._toYjsValue(ydoc, v)));
      });
      return yarr;
    }
    if (typeof value === 'object') {
      const ymap = new Y.Map();
      ydoc.transact(() => {
        for (const [k, v] of Object.entries(value)) {
          ymap.set(k, this._toYjsValue(ydoc, v));
        }
      });
      return ymap;
    }
    return value;
  }

  decodeDocument(buffer, crdt) {
    const ydoc = new Y.Doc();
    try {
      Y.applyUpdate(ydoc, buffer);

      const meta = ydoc.getMap(META_KEY);
      const typeMap = {};
      for (const [name, type] of meta.entries()) {
        typeMap[name] = type;
      }

      for (const [name, type] of ydoc.share) {
        if (name === META_KEY) continue;
        const kind = typeMap[name];

        if (kind === 'text') {
          const text = crdt.getText(name);
          const str = ydoc.getText(name).toString();
          if (str.length > 0) text.insert(0, str);
        } else if (kind === 'counter') {
          const counterName = name.slice('__counter__'.length);
          const counter = crdt.getCounter(counterName);
          counter.value = ydoc.getMap(name).get('value') || 0;
        } else if (kind === 'map') {
          const map = crdt.getMap(name);
          const ymap = ydoc.getMap(name);
          for (const [key, value] of ymap.entries()) {
            map._set(key, this._fromYjsValue(value));
          }
        } else if (kind === 'array') {
          const arr = crdt.getArray(name);
          const yarr = ydoc.getArray(name);
          for (let i = 0; i < yarr.length; i++) {
            arr.push(this._fromYjsValue(yarr.get(i)));
          }
        }
      }

      return crdt;
    } finally {
      ydoc.destroy();
    }
  }

  _fromYjsValue(value) {
    if (value instanceof Y.Map) {
      const obj = {};
      for (const [k, v] of value.entries()) {
        obj[k] = this._fromYjsValue(v);
      }
      return obj;
    }
    if (value instanceof Y.Array) {
      const arr = [];
      for (let i = 0; i < value.length; i++) {
        arr.push(this._fromYjsValue(value.get(i)));
      }
      return arr;
    }
    return value;
  }
}

module.exports = { YjsEncoder };
