export interface Heading {
  text: string;
  slug: string;
  level: number;
  offset: number;
}
export interface Link {
  target: string;
  label: string;
  kind: 'wiki' | 'markdown' | 'image';
  start: number;
  end: number;
  targetStart: number;
  targetEnd: number;
}
export interface Page {
  id: string;
  root: string;
  path: string;
  uri: string;
  title: string;
  tags: string[];
  draft?: boolean;
  order?: number;
  text: string;
  body: string;
  headings: Heading[];
  links: Link[];
  metadataError?: string;
  /** Front matter fields with an unexpected type (the page still loads). */
  metadataWarnings?: string[];
  /** `translated_from`: hash of the source page body this translation was made from. */
  translatedFrom?: string;
  description?: string;
  /** Set when the title is the file name (no front matter `title`, no `#` heading). */
  titleFromFile?: boolean;
  /** Scalar front matter values as text (lists joined with commas), for rules and search. */
  properties?: Record<string, string>;
}
export interface Resolution {
  page?: Page;
  heading?: Heading;
  error?: 'missing' | 'ambiguous' | 'heading' | 'unsafe';
  external?: boolean;
}
export interface TextChange {
  start: number;
  end: number;
  text: string;
}
