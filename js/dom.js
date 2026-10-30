// js/dom.js — tiny DOM + storage helpers.
// h() is the ONLY way views build markup: text goes through textContent and attributes through
// setAttribute, so API-sourced names can never become HTML. No innerHTML anywhere in the UI.

/**
 * h('a', { class: 'row', href: '#/', onclick: fn }, 'text', childEl, [more])
 * Special props: class, text, style (object, applied via CSSOM — allowed by our CSP), dataset (object),
 * on<event> (function). true → empty attribute; null/undefined/false → skipped.
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'text') el.textContent = String(value);
      else if (key === 'style') setStyles(el, value);
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
      else if (key === 'innerHTML' || key === 'outerHTML') throw new Error('h(): raw HTML is not allowed');
      else el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Set styles through CSSOM (el.style), never the style attribute — keeps CSP style-src 'self' happy. */
export function setStyles(el, styles) {
  for (const [prop, value] of Object.entries(styles)) {
    if (prop.startsWith('--')) el.style.setProperty(prop, String(value));
    else el.style[prop] = value;
  }
}

/** Visually hidden text for screen readers. */
export const sr = (text) => h('span', { class: 'sr-only', text });

/** Only Sleeper's CDN may supply images (also enforced by CSP img-src). */
export function safeAvatar(url) {
  return typeof url === 'string' && url.startsWith('https://sleepercdn.com/') ? url : null;
}

/** 40px avatar circle: Sleeper image, or the name's first letter as a fallback. */
export function avatar(url, name, size = 40) {
  const src = safeAvatar(url);
  const initial = (String(name || '?').trim().match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase();
  const box = h('span', { class: 'avatar', 'aria-hidden': 'true', dataset: { size: String(size) } }, initial);
  if (src) {
    const img = h('img', { src, alt: '', width: size, height: size, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => img.remove(), { once: true });
    box.append(img);
  }
  return box;
}

// ── storage: every access can throw (private mode, blocked cookies), so wrap them all ──

function safeStore(getStorage) {
  return {
    get(key) {
      try {
        return getStorage().getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        getStorage().setItem(key, String(value));
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try {
        getStorage().removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}

export const store = safeStore(() => window.localStorage);
export const session = safeStore(() => window.sessionStorage);

// Newer emoji (🫠 🪦, Unicode 13–14) render as an empty box on e.g. Windows 10. Emoji are decoration
// here (the word carries the meaning), so drop any the platform can't draw: compare its pixels with
// a guaranteed-missing code point's. If canvas readback is blocked/randomized we just show it.
const emojiCache = new Map();
function drawGlyph(text) {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.font = '24px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(text, 0, 0);
  return ctx.getImageData(0, 0, 32, 32).data.join();
}
export function emoji(ch) {
  if (!ch) return '';
  if (!emojiCache.has(ch)) {
    let ok = true;
    try {
      ok = drawGlyph(ch) !== drawGlyph('\u{10FFFD}');
    } catch {
      ok = true;
    }
    emojiCache.set(ch, ok);
  }
  return emojiCache.get(ch) ? ch : '';
}

export const prefersReducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};
