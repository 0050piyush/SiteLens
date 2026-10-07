// A tiny DOM, just enough for the browser view code (public/dom.js h() and
// the content pages) to build pages in Node, which are then serialized to HTML.
// Event handlers are ignored: the prerendered HTML is static until the app loads.

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escText(s).replace(/"/g, '&quot;');
const kebab = (k) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

class Node {
  constructor() { this.parentNode = null; }
  remove() {
    if (!this.parentNode) return;
    const kids = this.parentNode.childNodes;
    kids.splice(kids.indexOf(this), 1);
    this.parentNode = null;
  }
  replaceWith(...nodes) {
    const parent = this.parentNode;
    if (!parent) return;
    const i = parent.childNodes.indexOf(this);
    this.remove();
    parent.childNodes.splice(i, 0, ...nodes.map(toNode));
    for (const n of parent.childNodes) n.parentNode = parent;
  }
  addEventListener() {}
  removeEventListener() {}
}

class Text extends Node {
  constructor(data) { super(); this.data = String(data); }
  get textContent() { return this.data; }
  get outerHTML() { return escText(this.data); }
}

const toNode = (c) => (c instanceof Node ? c : new Text(c));

class ClassList {
  constructor(el) { this.el = el; }
  get list() { return (this.el.getAttribute('class') || '').split(/\s+/).filter(Boolean); }
  add(...c) { this.el.className = [...new Set([...this.list, ...c])].join(' '); }
  remove(...c) { this.el.className = this.list.filter((x) => !c.includes(x)).join(' '); }
  contains(c) { return this.list.includes(c); }
  toggle(c, force) {
    const on = force ?? !this.contains(c);
    if (on) this.add(c); else this.remove(c);
    return on;
  }
}

class Element extends Node {
  constructor(tag) {
    super();
    this.tagName = tag.toUpperCase();
    this.localName = tag;
    this.attrs = new Map();
    this.childNodes = [];
    this.style = {};
    this.classList = new ClassList(this);
  }
  get children() { return this.childNodes.filter((n) => n instanceof Element); }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  hasAttribute(k) { return this.attrs.has(k); }
  removeAttribute(k) { this.attrs.delete(k); }
  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', v); }
  get id() { return this.getAttribute('id') || ''; }
  set id(v) { this.setAttribute('id', v); }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(v) { if (v) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(v) { if (v) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }
  get open() { return this.hasAttribute('open'); }
  set open(v) { if (v) this.setAttribute('open', ''); else this.removeAttribute('open'); }
  get href() { return this.getAttribute('href') || ''; }
  append(...nodes) {
    for (const n of nodes.map(toNode)) {
      n.remove();
      n.parentNode = this;
      this.childNodes.push(n);
    }
  }
  appendChild(n) { this.append(n); return n; }
  prepend(...nodes) {
    const add = nodes.map(toNode);
    for (const n of add) { n.remove(); n.parentNode = this; }
    this.childNodes.unshift(...add);
  }
  replaceChildren(...nodes) {
    for (const n of this.childNodes) n.parentNode = null;
    this.childNodes = [];
    this.append(...nodes);
  }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(''); }
  set textContent(v) { this.replaceChildren(new Text(v ?? '')); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
  focus() {}
  blur() {}
  get outerHTML() {
    const attrs = [...this.attrs];
    const style = Object.entries(this.style).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${kebab(k)}:${v}`).join(';');
    if (style) attrs.push(['style', style]);
    const open = `<${this.localName}${attrs.map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${escAttr(v)}"`)).join('')}>`;
    if (VOID.has(this.localName)) return open;
    return `${open}${this.childNodes.map((n) => n.outerHTML).join('')}</${this.localName}>`;
  }
}

/** Installs the fake DOM globals (idempotent). */
export function installDom() {
  if (globalThis.document?.__ssr) return;
  globalThis.Node = Node;
  globalThis.document = {
    __ssr: true,
    createElement: (tag) => new Element(tag),
    createElementNS: (_ns, tag) => new Element(tag),
    createTextNode: (t) => new Text(t),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

export const toHtml = (nodes) => [].concat(nodes).map((n) => (n instanceof Node ? n.outerHTML : escText(n))).join('');
export { escText, escAttr };
