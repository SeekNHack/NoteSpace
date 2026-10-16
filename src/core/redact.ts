/**
 * Removes credential-looking text before anything is sent to a language model. It is a safety
 * net, not a guarantee: users still choose what to send.
 */
const patterns: Array<[RegExp, string]> = [
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    '[REDACTED PRIVATE KEY]',
  ],
  [/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, '[REDACTED AWS KEY]'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, '[REDACTED GITHUB TOKEN]'],
  [/\bgithub_pat_[A-Za-z0-9_]{40,}\b/g, '[REDACTED GITHUB TOKEN]'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, '[REDACTED SLACK TOKEN]'],
  [/\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b/g, '[REDACTED API KEY]'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, '[REDACTED API KEY]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED JWT]'],
  [
    /(\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\b\s*[:=]\s*)(["']?)[^\s"'`]{6,}\2/gi,
    '$1[REDACTED]',
  ],
  [/(\bBearer\s+)[A-Za-z0-9._~+/-]{16,}=*/g, '$1[REDACTED]'],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi, '$1[REDACTED]@'],
];

export function redactSecrets(text: string): { text: string; count: number } {
  let count = 0;
  for (const [pattern, replacement] of patterns)
    text = text.replace(pattern, (...match) => {
      count++;
      return replacement.replace(/\$(\d)/g, (_, n) => String(match[Number(n)] ?? ''));
    });
  return { text, count };
}
