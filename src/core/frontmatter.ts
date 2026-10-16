import { Document, parseDocument } from 'yaml';

const pattern = /^(﻿?)---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;

/**
 * Sets (or with `null`, removes) front matter fields while keeping the rest of the YAML,
 * its comments and the page body byte-identical. Invalid YAML is refused, never replaced.
 */
export function withFrontMatter(text: string, updates: Record<string, unknown>): string {
  const match = pattern.exec(text);
  const doc = match ? parseDocument(match[2], { uniqueKeys: true }) : new Document({});
  if (doc.errors.length)
    throw new Error(`Fix the page's front matter first: ${doc.errors[0].message}`);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) doc.delete(key);
    else doc.set(key, value);
  }
  const yaml = String(doc).trimEnd();
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const body = match ? text.slice(match[0].length) : text;
  if (yaml === '{}' || !yaml) return `${match?.[1] || ''}${body}`;
  return `${match?.[1] || ''}---${eol}${yaml.replace(/\n/g, eol)}${eol}---${eol}${body}`;
}
