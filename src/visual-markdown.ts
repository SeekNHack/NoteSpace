import { AnyExtension, Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { createLowlight } from 'lowlight';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import markdownLanguage from 'highlight.js/lib/languages/markdown';
import { Markdown } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import { Image } from '@tiptap/extension-image';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { calloutKinds, layoutKinds, parseRichBlock, richBlockSource } from './core/rich-blocks';
import { BlockIsland, Highlight, InlineIsland } from './visual-islands';

const callouts = new Set<string>(calloutKinds);
/**
 * Containers need at least one block; an empty `:::kind` body becomes one empty paragraph, the
 * same document the editor holds after inserting it, so syncing back does not replace it.
 */
const withBody = <T>(children: T[]): T[] =>
  children.length ? children : ([{ type: 'paragraph' }] as T[]);
const layouts = new Set<string>(layoutKinds);

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      type: { default: 'note', parseHTML: (element) => element.getAttribute('data-callout') },
      title: { default: '', parseHTML: (element) => element.getAttribute('data-title') || '' },
      collapsed: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-collapsed') === 'true',
      },
      color: { default: null, parseHTML: (element) => element.getAttribute('data-color') || null },
    };
  },
  parseHTML() {
    return [{ tag: 'aside[data-callout]' }];
  },
  renderHTML({ node }) {
    return [
      'aside',
      {
        'data-callout': node.attrs.type,
        'data-title': node.attrs.title,
        'data-collapsed': String(node.attrs.collapsed),
        ...(node.attrs.color ? { 'data-color': node.attrs.color } : {}),
        class: `callout ${node.attrs.type}`,
      },
      0,
    ];
  },
  markdownTokenizer: {
    name: 'callout',
    level: 'block',
    start(src: string) {
      return src.indexOf(':::');
    },
    tokenize(src: string, _tokens, lexer) {
      const block = parseRichBlock(src);
      if (!block || !callouts.has(block.kind)) return;
      return {
        type: 'callout',
        raw: block.raw,
        text: block.body,
        variant: block.kind,
        title: block.title,
        collapsed: block.collapsed,
        color: block.color,
        tokens: lexer.blockTokens(block.body),
      };
    },
  },
  parseMarkdown(token, helpers) {
    return {
      type: 'callout',
      attrs: {
        type: token.variant || 'note',
        title: token.title || '',
        collapsed: Boolean(token.collapsed),
        color: token.color || null,
      },
      content: withBody(helpers.parseChildren(token.tokens || [])),
    };
  },
  renderMarkdown(node, helpers) {
    return richBlockSource(
      node.attrs?.type || 'note',
      helpers.renderChildren(node.content || [], '\n\n'),
      node.attrs?.title || '',
      Boolean(node.attrs?.collapsed),
      node.attrs?.color || undefined,
    );
  },
});

export const RichContainer = Node.create({
  name: 'richContainer',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      kind: { default: 'card', parseHTML: (element) => element.getAttribute('data-rich') },
      title: { default: '', parseHTML: (element) => element.getAttribute('data-title') || '' },
      collapsed: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-collapsed') === 'true',
      },
      color: { default: null, parseHTML: (element) => element.getAttribute('data-color') || null },
    };
  },
  parseHTML() {
    return [{ tag: 'section[data-rich]' }];
  },
  renderHTML({ node }) {
    return [
      'section',
      {
        'data-rich': node.attrs.kind,
        'data-title': node.attrs.title,
        'data-collapsed': String(node.attrs.collapsed),
        ...(node.attrs.color ? { 'data-color': node.attrs.color } : {}),
        class: `rich-block rich-${node.attrs.kind}`,
      },
      0,
    ];
  },
  markdownTokenizer: {
    name: 'richContainer',
    level: 'block',
    start(src: string) {
      return src.indexOf(':::');
    },
    tokenize(src: string, _tokens, lexer) {
      const block = parseRichBlock(src);
      if (!block || !layouts.has(block.kind)) return;
      return {
        type: 'richContainer',
        raw: block.raw,
        text: block.body,
        variant: block.kind,
        title: block.title,
        collapsed: block.collapsed,
        color: block.color,
        tokens: lexer.blockTokens(block.body),
      };
    },
  },
  parseMarkdown(token, helpers) {
    return {
      type: 'richContainer',
      attrs: {
        kind: token.variant || 'card',
        title: token.title || '',
        collapsed: Boolean(token.collapsed),
        color: token.color || null,
      },
      content: withBody(helpers.parseChildren(token.tokens || [])),
    };
  },
  renderMarkdown(node, helpers) {
    return richBlockSource(
      node.attrs?.kind || 'card',
      helpers.renderChildren(node.content || [], '\n\n'),
      node.attrs?.title || '',
      Boolean(node.attrs?.collapsed),
      node.attrs?.color || undefined,
    );
  },
});

/** `[[target]]` and `[[target|label]]` stay wiki links; marks are disallowed because they cannot round-trip. */
export const WikiLink = Node.create({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  marks: '',
  addAttributes() {
    return {
      target: { default: '', parseHTML: (element) => element.getAttribute('data-wiki-link') || '' },
      label: { default: '', parseHTML: (element) => element.getAttribute('data-label') || '' },
    };
  },
  parseHTML() {
    return [{ tag: 'a[data-wiki-link]' }];
  },
  renderHTML({ node }) {
    return [
      'a',
      {
        'data-wiki-link': node.attrs.target,
        'data-label': node.attrs.label,
        href: node.attrs.target,
        class: 'wiki-link',
      },
      node.attrs.label || node.attrs.target,
    ];
  },
  markdownTokenizer: {
    name: 'wikiLink',
    level: 'inline',
    start(src: string) {
      return src.indexOf('[[');
    },
    tokenize(src: string) {
      const match = /^\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/.exec(src);
      if (!match || !match[1].trim()) return;
      return { type: 'wikiLink', raw: match[0], target: match[1], label: match[2] || '' };
    },
  },
  parseMarkdown(token) {
    return { type: 'wikiLink', attrs: { target: token.target, label: token.label || '' } };
  },
  renderMarkdown(node) {
    const { target = '', label = '' } = node.attrs || {};
    return `[[${target}${label ? `|${label}` : ''}]]`;
  },
});

export const lowlight = createLowlight({
  javascript,
  typescript,
  python,
  bash,
  json,
  css,
  xml,
  yaml,
  markdown: markdownLanguage,
});
for (const [alias, name] of Object.entries({
  js: 'javascript',
  ts: 'typescript',
  sh: 'bash',
  shell: 'bash',
  html: 'xml',
  md: 'markdown',
  yml: 'yaml',
}))
  lowlight.registerAlias(name, alias);

/** Fences must be longer than any backtick fence inside the code, or the block ends early. */
export const SafeCodeBlock = CodeBlockLowlight.extend({
  renderMarkdown(node) {
    const text = (node.content || []).map((child) => String(child.text || '')).join('');
    const longest = Math.max(0, ...[...text.matchAll(/^ {0,3}(`{3,})/gm)].map((m) => m[1].length));
    const fence = '`'.repeat(Math.max(3, longest + 1));
    return `${fence}${node.attrs?.language || ''}\n${text}\n${fence}`;
  },
});

export interface VisualOverrides {
  image?: AnyExtension;
  callout?: AnyExtension;
  richContainer?: AnyExtension;
  codeBlock?: AnyExtension;
  inlineIsland?: AnyExtension;
  blockIsland?: AnyExtension;
}

/** One extension schema for the real webview editor and the no-DOM integrity tests. */
export function visualExtensions(overrides: VisualOverrides | AnyExtension = {}): AnyExtension[] {
  const o: VisualOverrides = 'name' in overrides ? { image: overrides as AnyExtension } : overrides;
  return [
    // Underline has no Markdown form; links open with Ctrl/Cmd+Click through the host.
    StarterKit.configure({
      codeBlock: false,
      underline: false,
      link: { openOnClick: false, autolink: true, linkOnPaste: false },
    }),
    o.codeBlock || SafeCodeBlock.configure({ lowlight, defaultLanguage: null }),
    Markdown,
    TableKit,
    o.image || Image,
    TaskList,
    TaskItem.configure({ nested: true }),
    o.callout || Callout,
    o.richContainer || RichContainer,
    WikiLink,
    Highlight,
    o.inlineIsland || InlineIsland,
    o.blockIsland || BlockIsland,
  ];
}
