const { AbstractType, YXmlElementEvent } = require('./events');

class YXmlFragment extends AbstractType {
  constructor(crdt, name) {
    super();
    this._crdt = crdt;
    this._name = name;
    this._children = [];
  }

  insert(index, content) {
    if (typeof content === 'string') {
      content = [new YXmlText(this._crdt, content)];
    } else if (content instanceof YXmlElement) {
      content = [content];
    } else if (!Array.isArray(content)) {
      content = [content];
    }

    this._children.splice(index, 0, ...content);
    for (const child of content) {
      child._parent = this;
    }

    const delta = [{ retain: index }, { insert: content.map(c => c.toString()) }];
    const event = new YXmlElementEvent(this, { delta, delete: 0 }, null);
    this._emit(event);
    this._emitDeep(event);
    return this;
  }

  delete(index, length = 1) {
    const deleted = this._children.splice(index, length);
    for (const child of deleted) {
      child._parent = null;
    }

    const delta = [{ retain: index }, { delete: length }];
    const event = new YXmlElementEvent(this, { delta }, null);
    this._emit(event);
    this._emitDeep(event);
    return this;
  }

  get(index) { return this._children[index]; }
  get length() { return this._children.length; }

  toArray() { return [...this._children]; }

  toString() {
    return this._children.map(c => c.toString()).join('');
  }

  toJSON() {
    return this._children.map(c => c.toJSON());
  }

  toDOM() {
    const frag = { type: 'fragment', children: [] };
    for (const child of this._children) {
      frag.children.push(child.toDOM ? child.toDOM() : child.toString());
    }
    return frag;
  }

  get firstChild() { return this._children[0] || null; }
  get lastChild() { return this._children[this._children.length - 1] || null; }

  children() { return this._children; }

  slice(start, end) {
    return this._children.slice(start, end);
  }

  clone() {
    const frag = new YXmlFragment(this._crdt, this._name);
    for (const child of this._children) {
      frag.insert(frag.length, child.clone());
    }
    return frag;
  }

  createTreeWalker(filter) {
    const self = this;
    return {
      *[Symbol.iterator]() {
        const stack = [...self._children];
        while (stack.length > 0) {
          const node = stack.shift();
          if (filter(node)) {
            yield node;
          }
          if (node instanceof YXmlElement) {
            for (let i = node._children.length - 1; i >= 0; i--) {
              stack.unshift(node._children[i]);
            }
          }
        }
      }
    };
  }

  forEach(fn) {
    for (let i = 0; i < this._children.length; i++) {
      fn(this._children[i], i, this);
    }
  }
}

class YXmlElement extends AbstractType {
  constructor(crdt, tagName, attrs) {
    super();
    this._crdt = crdt;
    this._name = tagName || '';
    this._tagName = tagName || 'div';
    this._attrs = attrs || {};
    this._children = [];
  }

  get tagName() { return this._tagName; }
  set tagName(v) { this._tagName = v; }

  getAttribute(name) { return this._attrs[name]; }
  setAttribute(name, value) {
    const old = this._attrs[name];
    this._attrs[name] = value;
    if (old !== value) {
      const event = new YXmlElementEvent(this, { attributes: { [name]: { old, new: value } } }, null);
      this._emit(event);
      this._emitDeep(event);
    }
    return this;
  }
  removeAttribute(name) {
    delete this._attrs[name];
    return this;
  }
  hasAttribute(name) { return name in this._attrs; }
  getAttributes() { return { ...this._attrs }; }

  insert(index, content) {
    if (typeof content === 'string') {
      content = [new YXmlText(this._crdt, content)];
    } else if (content instanceof YXmlElement) {
      content = [content];
    } else if (!Array.isArray(content)) {
      content = [content];
    }

    this._children.splice(index, 0, ...content);
    for (const child of content) child._parent = this;

    const event = new YXmlElementEvent(this, {
      delta: [{ retain: index }, { insert: content.map(c => c.toString()) }]
    }, null);
    this._emit(event);
    this._emitDeep(event);
    return this;
  }

  delete(index, length = 1) {
    const deleted = this._children.splice(index, length);
    for (const child of deleted) child._parent = null;

    const event = new YXmlElementEvent(this, {
      delta: [{ retain: index }, { delete: length }]
    }, null);
    this._emit(event);
    this._emitDeep(event);
    return this;
  }

  get(index) { return this._children[index]; }
  get length() { return this._children.length; }
  toArray() { return [...this._children]; }

  toString() {
    const tag = this._tagName;
    const attrs = Object.entries(this._attrs).map(([k, v]) => ` ${k}="${v}"`).join('');
    const children = this._children.map(c => c.toString()).join('');
    return `<${tag}${attrs}>${children}</${tag}>`;
  }

  toJSON() {
    return {
      tag: this._tagName,
      attrs: { ...this._attrs },
      children: this._children.map(c => c.toJSON())
    };
  }

  toDOM() {
    const node = {
      nodeType: 'element',
      tagName: this._tagName,
      attributes: { ...this._attrs },
      children: this._children.map(c => c.toDOM ? c.toDOM() : c.toString())
    };
    return node;
  }

  get firstChild() { return this._children[0] || null; }
  get lastChild() { return this._children[this._children.length - 1] || null; }

  children() { return this._children; }

  slice(start, end) {
    return this._children.slice(start, end);
  }

  clone() {
    const el = new YXmlElement(this._crdt, this._tagName, { ...this._attrs });
    for (const child of this._children) {
      el.insert(el.length, child.clone());
    }
    return el;
  }

  get nextSibling() {
    if (!this._parent || !this._parent._children) return null;
    const siblings = this._parent._children;
    const idx = siblings.indexOf(this);
    return idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;
  }

  get prevSibling() {
    if (!this._parent || !this._parent._children) return null;
    const siblings = this._parent._children;
    const idx = siblings.indexOf(this);
    return idx > 0 ? siblings[idx - 1] : null;
  }

  forEach(fn) {
    for (let i = 0; i < this._children.length; i++) {
      fn(this._children[i], i, this);
    }
  }
}

class YXmlText extends AbstractType {
  constructor(crdt, text) {
    super();
    this._crdt = crdt;
    this._text = text || '';
    this._attributes = {};
  }

  get length() { return this._text.length; }
  toString() { return this._text; }
  toJSON() { return { text: this._text, attrs: { ...this._attributes } }; }

  toDOM() {
    return { nodeType: 'text', text: this._text, attributes: { ...this._attributes } };
  }

  getAttribute(name) { return this._attributes[name]; }
  setAttribute(name, value) {
    const old = this._attributes[name];
    this._attributes[name] = value;
    if (old !== value) {
      const event = new YXmlElementEvent(this, { attributes: { [name]: { old, new: value } } }, null);
      this._emit(event);
      this._emitDeep(event);
    }
    return this;
  }
  removeAttribute(name) {
    delete this._attributes[name];
    return this;
  }
  hasAttribute(name) { return name in this._attributes; }
  getAttributes() { return { ...this._attributes }; }

  insert(pos, text) {
    const oldText = this._text;
    this._text = this._text.slice(0, pos) + text + this._text.slice(pos);
    const delta = [{ retain: pos }, { insert: text }];
    const event = new YXmlElementEvent(this, { delta, oldText }, null);
    this._emit(event);
    this._emitDeep(event);
    return this;
  }

  delete(pos, len) {
    const oldText = this._text;
    const deleted = this._text.slice(pos, pos + len);
    this._text = this._text.slice(0, pos) + this._text.slice(pos + len);
    const delta = [{ retain: pos }, { delete: len }];
    const event = new YXmlElementEvent(this, { delta, deleted, oldText }, null);
    this._emit(event);
    this._emitDeep(event);
    return this;
  }

  format(pos, len, format) {
    return { pos, len, format };
  }

  applyDelta(delta) {
    let pos = 0;
    for (const op of delta) {
      if (op.insert) {
        this.insert(pos, op.insert);
        pos += op.insert.length;
      } else if (op.delete) {
        this.delete(pos, op.delete);
      } else if (op.retain) {
        pos += op.retain;
      }
    }
    return this;
  }

  clone() {
    const text = new YXmlText(this._crdt, this._text);
    text._attributes = { ...this._attributes };
    return text;
  }

  toDelta() {
    return [{ insert: this._text, attributes: { ...this._attributes } }];
  }
}

class YXmlHook extends AbstractType {
  constructor(crdt, hookName) {
    super();
    this._crdt = crdt;
    this._hookName = hookName || '';
    this._content = null;
  }

  get hookName() { return this._hookName; }
  get content() { return this._content; }
  set content(v) { this._content = v; }

  clone() {
    const hook = new YXmlHook(this._crdt, this._hookName);
    hook._content = this._content;
    return hook;
  }

  toJSON() { return { hook: this._hookName, content: this._content }; }
  toString() { return `<hook:${this._hookName}>`; }

  toDOM() {
    return { nodeType: 'hook', hookName: this._hookName, content: this._content };
  }
}

module.exports = { YXmlFragment, YXmlElement, YXmlText, YXmlHook };
