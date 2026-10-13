// Tiny element builder so modes don't need innerHTML for dynamic text.
//   h('button', { class: 'primary', onclick: fn }, 'Log 10')
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

// Add a <link rel=stylesheet> once.
export function useCss(href) {
  if (document.querySelector(`link[data-href="${href}"]`)) return;
  document.head.append(h('link', { rel: 'stylesheet', href, 'data-href': href }));
}

export const fmt = (n) => Number(n).toLocaleString();
