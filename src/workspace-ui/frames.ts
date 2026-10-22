// Destinations that are full pages of their own (the API Client, Content health, the link graph)
// run in same-origin frames of the panel: their styles, menus and shortcuts stay their own while
// the panel keeps its navigation and history. Frames live outside the re-rendered app and are
// only hidden, so a client's open requests and drafts survive switching destination.
import { post, save, ui } from './core';

export type FrameName = 'api' | 'health' | 'graph';
/** A frame's document, sent by the host. Scripts run inline (frames cannot load webview files). */
export interface FrameDoc {
  title: string;
  css: string;
  body: string;
  scripts: string[];
}

// Read while this script runs: frame scripts need the same nonce.
const nonce = (document.currentScript as HTMLScriptElement | null)?.nonce || '';
interface Frame {
  host: HTMLDivElement;
  frame?: HTMLIFrameElement;
  loaded: boolean;
  queued: unknown[];
  html?: string;
}
const frames = new Map<FrameName, Frame>();
let shown: FrameName | undefined;
let keys: (event: KeyboardEvent) => void = () => undefined;

// A frame finds its bridge by the name on its element (`window.frameElement.dataset.frame`).
(window as unknown as { notespaceBridge: unknown }).notespaceBridge = (name: FrameName) => ({
  postMessage: (message: unknown) => post({ type: 'frame', frame: name, message }),
  getState: () => ui.frames?.[name],
  setState: (state: unknown) => {
    ui.frames = { ...ui.frames, [name]: state };
    save();
  },
});

/** VS Code sets theme variables and classes on this document; frames follow them. */
function syncTheme(frame?: HTMLIFrameElement) {
  for (const f of frame ? [frame] : [...frames.values()].map((x) => x.frame)) {
    const doc = f?.contentDocument;
    if (!doc?.body) continue;
    doc.documentElement.setAttribute('style', document.documentElement.getAttribute('style') || '');
    doc.body.className = document.body.className;
  }
}
new MutationObserver(() => syncTheme()).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['style', 'class'],
});
new MutationObserver(() => syncTheme()).observe(document.body, {
  attributes: true,
  attributeFilter: ['class'],
});

const attr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const escapeText = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function entry(name: FrameName): Frame {
  let f = frames.get(name);
  if (!f) {
    const host = document.createElement('div');
    host.className = 'frame-host';
    host.hidden = true;
    document.body.append(host);
    f = { host, loaded: false, queued: [] };
    frames.set(name, f);
    post({ type: 'frameDoc', frame: name });
  }
  return f;
}

/** The host sent (or updated) a frame's document. */
export function setFrameDoc(name: FrameName, doc: FrameDoc) {
  const f = entry(name);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeText(doc.title)}</title><style>${doc.css.replace(/<\/style/gi, '<\\/style')}</style></head><body>${doc.body}${doc.scripts
    .map(
      (code) =>
        `<script nonce="${attr(nonce)}">${code.replace(/<\/script/gi, '<\\/script')}</script>`,
    )
    .join('')}</body></html>`;
  if (html === f.html) return;
  f.html = html;
  // A new document replaces the frame (its scripts run once per document).
  f.frame?.remove();
  f.loaded = false;
  const frame = document.createElement('iframe');
  frame.title = doc.title;
  frame.dataset.frame = name;
  frame.srcdoc = html;
  frame.addEventListener('load', () => {
    f.loaded = true;
    syncTheme(frame);
    // While a frame has focus, panel shortcuts (Alt: sections, Back and Forward) still work,
    // and keys the frame leaves alone are passed on to VS Code, which only sees keys pressed in
    // this document: F1, Ctrl+P and the other workbench shortcuts keep working.
    for (const type of ['keydown', 'keyup'] as const)
      frame.contentDocument?.addEventListener(type, (event) => {
        if (type === 'keydown' && event.altKey) keys(event);
        if (event.defaultPrevented) return;
        window.dispatchEvent(
          new KeyboardEvent(type, {
            key: event.key,
            code: event.code,
            ctrlKey: event.ctrlKey,
            shiftKey: event.shiftKey,
            altKey: event.altKey,
            metaKey: event.metaKey,
            repeat: event.repeat,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    const pending = f.queued;
    f.queued = [];
    for (const message of pending) frame.contentWindow?.postMessage(message, '*');
  });
  f.frame = frame;
  f.host.append(frame);
}

/** Shows one frame (created the first time) below the panel's header, or none. */
export function showFrame(name: FrameName | undefined, onKey: (event: KeyboardEvent) => void) {
  keys = onKey;
  shown = name;
  if (name) entry(name);
  for (const [n, f] of frames) f.host.hidden = n !== name;
  document.body.classList.toggle('frame-visible', !!name);
  place();
}

/** Frames start below the sticky header (navigation and section tabs). */
function place() {
  if (!shown) return;
  const top = document.querySelector('.top')?.getBoundingClientRect().bottom ?? 41;
  frames.get(shown)!.host.style.top = `${Math.max(0, Math.round(top))}px`;
}
window.addEventListener('resize', place);

/** A message from the host for a frame. */
export function toFrame(name: FrameName, message: unknown) {
  const f = frames.get(name);
  if (!f) return;
  if (f.loaded && f.frame?.contentWindow) f.frame.contentWindow.postMessage(message, '*');
  else f.queued.push(message);
}
