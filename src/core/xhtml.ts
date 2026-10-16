import { parseFragment } from 'parse5';

/**
 * Converts rendered page HTML into well-formed XHTML for EPUB: void elements are closed,
 * boolean attributes get values, SVG and MathML get their namespaces, scripts are removed and
 * audio/video/iframes become visible text fallbacks (an e-book cannot play local media).
 */
interface Node {
  nodeName: string;
  tagName?: string;
  value?: string;
  data?: string;
  namespaceURI?: string;
  attrs?: Array<{ name: string; value: string; prefix?: string }>;
  childNodes?: Node[];
  content?: Node;
}
const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);
const SVG = 'http://www.w3.org/2000/svg',
  MATHML = 'http://www.w3.org/1998/Math/MathML';
const text = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (s: string) => text(s).replace(/"/g, '&quot;');
// XML 1.0 forbids most control characters.
const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');

export interface XhtmlResult {
  xhtml: string;
  svg: boolean;
  mathml: boolean;
  /** Resource URLs referenced by img/src (after rewriting). */
  resources: string[];
  fallbacks: number;
}

export function toXhtml(
  html: string,
  rewrite: (url: string, attribute: 'href' | 'src') => string = (u) => u,
): XhtmlResult {
  const result: XhtmlResult = { xhtml: '', svg: false, mathml: false, resources: [], fallbacks: 0 };
  const out: string[] = [];
  const walk = (node: Node, parentNs?: string) => {
    if (node.nodeName === '#text') return void out.push(text(clean(node.value || '')));
    if (node.nodeName === '#comment') return;
    const name = node.tagName;
    if (!name) {
      node.childNodes?.forEach((c) => walk(c, parentNs));
      return;
    }
    const ns = node.namespaceURI;
    if (name === 'script' || name === 'noscript' || name === 'template') return;
    if (['video', 'audio', 'iframe', 'object', 'embed'].includes(name)) {
      const src =
        node.attrs?.find((a) => a.name === 'src')?.value ||
        node.childNodes?.find((c) => c.tagName === 'source')?.attrs?.find((a) => a.name === 'src')
          ?.value ||
        '';
      result.fallbacks++;
      out.push(
        `<p class="epub-fallback">${text(`${name === 'audio' ? 'Audio' : name === 'video' ? 'Video' : 'Embedded content'}${src ? `: ${safeDecode(src.split('/').pop() || src)}` : ''} — not included in the e-book; see the online documentation.`)}</p>`,
      );
      return;
    }
    const attrs: string[] = [];
    if (ns === SVG && parentNs !== SVG) {
      attrs.push(`xmlns="${SVG}"`);
      const usesXlink = (n: Node): boolean =>
        !!n.attrs?.some((a) => a.prefix === 'xlink') || !!n.childNodes?.some(usesXlink);
      if (usesXlink(node)) attrs.push('xmlns:xlink="http://www.w3.org/1999/xlink"');
      result.svg = true;
    }
    if (ns === MATHML && parentNs !== MATHML) {
      attrs.push(`xmlns="${MATHML}"`);
      result.mathml = true;
    }
    for (const a of node.attrs || []) {
      const key = a.prefix ? `${a.prefix}:${a.name}` : a.name;
      if (
        /^on/i.test(a.name) ||
        a.name === 'contenteditable' ||
        a.name === 'xmlns' ||
        a.prefix === 'xmlns'
      )
        continue;
      let value = a.value;
      if ((a.name === 'href' || a.name === 'src') && ns !== SVG) value = rewrite(value, a.name);
      if (a.name === 'src' && name === 'img') result.resources.push(value);
      attrs.push(
        `${key}="${attr(clean(value === '' && !['alt', 'title', 'value'].includes(a.name) ? a.name : value))}"`,
      );
    }
    const open = `<${name}${attrs.length ? ` ${attrs.join(' ')}` : ''}`;
    const children = node.content?.childNodes || node.childNodes || [];
    if (ns === undefined || ns === 'http://www.w3.org/1999/xhtml') {
      if (VOID.has(name)) return void out.push(`${open}/>`);
    } else if (!children.length) return void out.push(`${open}/>`);
    out.push(`${open}>`);
    children.forEach((c) => walk(c, ns));
    out.push(`</${name}>`);
  };
  walk(parseFragment(html) as unknown as Node);
  result.xhtml = out.join('');
  return result;
}
