const TWO_32 = 0x100000000;

class ID {
  constructor(client, clock) {
    this.client = client;
    this.clock = clock;
  }

  equals(other) {
    return this.client === other.client && this.clock === other.clock;
  }

  compare(other) {
    if (this.clock !== other.clock) return this.clock - other.clock;
    return this.client < other.client ? -1 : this.client > other.client ? 1 : 0;
  }

  hash() {
    return `${this.client}:${this.clock}`;
  }

  toJSON() {
    return { client: this.client, clock: this.clock };
  }

  static fromJSON(j) {
    return new ID(j.client, j.clock);
  }

  static pack(client, clock) {
    return (client * TWO_32) + clock;
  }

  static unpack(packed) {
    return { client: Math.floor(packed / TWO_32), clock: packed % TWO_32 };
  }

  static client(packed) {
    return Math.floor(packed / TWO_32);
  }

  static clock(packed) {
    return packed % TWO_32;
  }
}

class IDGenerator {
  constructor(clientId) {
    this.clientId = clientId;
    this.counter = 0;
  }

  next() {
    return ID.pack(this.clientId, this.counter++);
  }

  peek() {
    return ID.pack(this.clientId, this.counter);
  }
}

module.exports = { ID, IDGenerator };
