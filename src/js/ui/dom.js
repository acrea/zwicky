// Small DOM helpers. User text only ever goes through textContent / attributes,
// never innerHTML (§4.6).

const SVG_NS = 'http://www.w3.org/2000/svg';

function apply(el, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.setAttribute('class', Array.isArray(v) ? v.flat(Infinity).filter(Boolean).join(' ') : v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
    } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** h('div', { class: 'x', onclick }, 'text', child, [more]) */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  apply(el, attrs);
  append(el, children);
  return el;
}

export function s(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  apply(el, attrs);
  append(el, children);
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Grows a textarea to fit its content. */
export function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

export const isTextInput = (el) =>
  !!el &&
  (el.tagName === 'TEXTAREA' ||
    (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'range'].includes(el.type)) ||
    el.isContentEditable);

export const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
