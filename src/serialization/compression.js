class Compressor {

  compress(data) {
    if (!data || data.length === 0) return data;
    if (typeof data === 'string') {
      return this._compressString(data);
    }
    if (data instanceof Uint8Array) {
      return this._compressRaw(data);
    }
    return data;
  }

  decompress(data) {
    if (!data) return data;
    if (typeof data === 'string') return data;
    if (data instanceof Uint8Array && data.length > 0 && data[0] === 0x8C) {
      return this._decompressData(data);
    }
    if (data instanceof Uint8Array) {
      return new TextDecoder().decode(data);
    }
    return data;
  }

  _compressString(str) {
    const input = new TextEncoder().encode(str);
    return this._compressRaw(input);
  }

  _compressRaw(input) {
    const result = [0x8C];
    const dict = new Map();
    let dictSize = 256;

    for (let i = 0; i < input.length; i++) {
      let seq = '';
      let lastCode = -1;
      for (let j = i; j < input.length; j++) {
        const extended = seq + String.fromCharCode(input[j]);
        if (dict.has(extended) || extended.length === 1) {
          seq = extended;
          lastCode = dict.has(extended) ? dict.get(extended) : input[j];
        } else {
          break;
        }
      }
      i += Math.max(0, seq.length - 1);
      if (lastCode < 128) {
        result.push(lastCode);
      } else if (lastCode < 16384) {
        result.push((lastCode >> 8) | 0x80);
        result.push(lastCode & 0xFF);
      } else {
        result.push(0xC0 | (lastCode >> 16));
        result.push((lastCode >> 8) & 0xFF);
        result.push(lastCode & 0xFF);
      }
      if (dictSize < 65535 && seq.length > 0) {
        for (let k = 0; k < seq.length; k++) {
          const sub = seq.slice(0, k + 1);
          if (!dict.has(sub) && sub.length > 1) {
            dict.set(sub, dictSize++);
          }
        }
      }
    }
    result.push(0x00);
    result.push(0x00);
    return new Uint8Array(result);
  }

  _decompressData(data) {
    const dict = [];
    let dictSize = 256;
    const result = [];
    let i = 1;
    let prev = '';

    while (i < data.length) {
      if (data[i] === 0x00 && i + 1 < data.length && data[i + 1] === 0x00) break;

      let code;
      if (data[i] & 0x80) {
        if ((data[i] & 0xC0) === 0xC0) {
          code = ((data[i] & 0x1F) << 16) | (data[i + 1] << 8) | data[i + 2];
          i += 3;
        } else {
          code = ((data[i] & 0x3F) << 8) | data[i + 1];
          i += 2;
        }
      } else {
        code = data[i++];
      }

      let entry;
      if (code < 256) {
        entry = String.fromCharCode(code);
      } else {
        entry = dict[code - 256];
        if (!entry) {
          entry = prev + prev[0];
        }
      }

      for (let j = 0; j < entry.length; j++) {
        result.push(entry.charCodeAt(j));
      }

      if (prev.length > 0 && dictSize < 65535) {
        dict[dictSize++ - 256] = prev + entry[0];
      }
      prev = entry;
    }

    return new TextDecoder().decode(new Uint8Array(result));
  }

  deltaEncode(base, current) {
    if (!base || base.length === 0) return { start: 0, remove: 0, insert: current };
    const baseStr = typeof base === 'string' ? base : new TextDecoder().decode(base);
    const currentStr = typeof current === 'string' ? current : new TextDecoder().decode(current);

    let start = 0;
    const minLen = Math.min(baseStr.length, currentStr.length);
    while (start < minLen && baseStr[start] === currentStr[start]) start++;

    let baseEnd = baseStr.length;
    let currentEnd = currentStr.length;
    while (baseEnd > start && currentEnd > start &&
           baseStr[baseEnd - 1] === currentStr[currentEnd - 1]) {
      baseEnd--;
      currentEnd--;
    }

    return {
      start,
      remove: Math.max(0, baseEnd - start),
      insert: currentStr.slice(start, currentEnd)
    };
  }

  deltaDecode(base, delta) {
    if (!delta) return base;
    const baseStr = typeof base === 'string' ? base : new TextDecoder().decode(base);
    return baseStr.slice(0, delta.start) + delta.insert + baseStr.slice(delta.start + delta.remove);
  }
}

module.exports = Compressor;
