import { TextChange } from './model';

/** The single span where `current` differs from `base`, in `base` coordinates. */
export function diffSpan(base: string, current: string): TextChange | undefined {
  if (base === current) return undefined;
  let start = 0;
  while (start < base.length && start < current.length && base[start] === current[start]) start++;
  let endBase = base.length,
    endCurrent = current.length;
  while (endBase > start && endCurrent > start && base[endBase - 1] === current[endCurrent - 1]) {
    endBase--;
    endCurrent--;
  }
  return { start, end: endBase, text: current.slice(start, endCurrent) };
}

export const applyChange = (text: string, change: TextChange): string =>
  text.slice(0, change.start) + change.text + text.slice(change.end);

/**
 * Rebases a Studio edit made against `base` onto `current`, which may contain another
 * editor's changes (Split mode, external tools). Edits that touch the same or adjacent text
 * conflict: the caller must stop and let the user decide rather than guess.
 */
export function rebaseEdit(
  base: string,
  current: string,
  studio: TextChange,
): { change: TextChange } | { conflict: true } {
  const source = diffSpan(base, current);
  if (!source) return { change: studio };
  const touches = studio.start <= source.end && source.start <= studio.end;
  if (touches) return { conflict: true };
  const shift = studio.start >= source.end ? source.text.length - (source.end - source.start) : 0;
  return { change: { start: studio.start + shift, end: studio.end + shift, text: studio.text } };
}
