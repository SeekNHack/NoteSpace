import { parseDocument } from 'yaml';

/** Kinds of page properties, read from the YAML value (as a database column type). */
export type PropertyType = 'text' | 'number' | 'checkbox' | 'date' | 'list' | 'url';
export interface Property {
  key: string;
  type: PropertyType;
  /** The value as the editor shows it: text, a number, true/false, YYYY-MM-DD or a list. */
  value: string | number | boolean | string[];
}

const frontMatter = /^(?:﻿)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
/** Keys the page itself manages (shown elsewhere or internal). */
const hidden = new Set(['title', 'translated_from']);
/** Keys with their own control (the page menu's Previous / Next Links), not shown as properties. */
const shownElsewhere = new Set(['pager']);
const date = /^\d{4}-\d{2}-\d{2}$/;

/** A page's front matter as typed properties, in file order; objects are left out. */
export function typedProperties(text: string): Property[] {
  const match = frontMatter.exec(text);
  if (!match) return [];
  const doc = parseDocument(match[1], { uniqueKeys: true });
  if (doc.errors.length) return [];
  const data = doc.toJS({ maxAliasCount: 0 }) as unknown;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  const out: Property[] = [];
  for (const [key, raw] of Object.entries(data as Record<string, unknown>)) {
    if (hidden.has(key) || shownElsewhere.has(key)) continue;
    if (Array.isArray(raw)) {
      if (raw.every((v) => ['string', 'number', 'boolean'].includes(typeof v)))
        out.push({ key, type: 'list', value: raw.map(String) });
    } else if (raw instanceof Date)
      out.push({ key, type: 'date', value: raw.toISOString().slice(0, 10) });
    else if (typeof raw === 'boolean') out.push({ key, type: 'checkbox', value: raw });
    else if (typeof raw === 'number' && Number.isFinite(raw))
      out.push({ key, type: 'number', value: raw });
    else if (typeof raw === 'string')
      out.push({
        key,
        type: date.test(raw) ? 'date' : /^https?:\/\/\S+$/.test(raw) ? 'url' : 'text',
        value: raw,
      });
    else if (raw === null) out.push({ key, type: 'text', value: '' });
  }
  return out;
}

const keyPattern = /^[A-Za-z_][\w-]{0,39}$/;
export const validPropertyKey = (key: string) => keyPattern.test(key) && !hidden.has(key);

/**
 * The YAML value to store for an edit: lists from comma-separated text, numbers and booleans
 * as such, dates as YYYY-MM-DD text (YAML would otherwise read them as timestamps). Empty
 * text removes the property (`null`).
 */
export function propertyValue(
  type: PropertyType,
  input: unknown,
): string | number | boolean | string[] | null {
  if (type === 'checkbox') return input === true || input === 'true';
  if (type === 'list') {
    const items = (Array.isArray(input) ? input.map(String) : String(input ?? '').split(','))
      .map((s) => s.trim())
      .filter(Boolean);
    return items;
  }
  const text = String(input ?? '').trim();
  if (!text) return null;
  if (type === 'number') {
    const n = Number(text);
    if (!Number.isFinite(n)) throw new Error('Type a number.');
    return n;
  }
  if (type === 'date' && !date.test(text)) throw new Error('Type a date as YYYY-MM-DD.');
  if (type === 'url' && !/^https?:\/\/\S+$/.test(text)) throw new Error('Type an http(s) link.');
  return text.slice(0, 2000);
}
