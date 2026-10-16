/**
 * Classifies request targets for the API playground. Cloud metadata services are blocked
 * (they hand out machine credentials); loopback, private and link-local targets need an
 * explicit confirmation because a page's API description could otherwise point requests at
 * services on your network.
 */
export type TargetKind = 'public' | 'loopback' | 'private' | 'link-local' | 'metadata';

const METADATA_HOSTS = new Set([
  'metadata.google.internal',
  'metadata.goog',
  'metadata',
  'instance-data',
  'instance-data.ec2.internal',
]);
const METADATA_IPS = new Set([
  '169.254.169.254',
  '169.254.170.2',
  '100.100.100.200',
  'fd00:ec2::254',
]);

function ipv4(address: string): number[] | undefined {
  const parts = address.split('.');
  if (parts.length !== 4) return undefined;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return nums.every((n) => n >= 0 && n <= 255) ? nums : undefined;
}

export function classifyAddress(raw: string): TargetKind {
  let address = raw.toLowerCase().replace(/^\[|\]$/g, '');
  if (METADATA_IPS.has(address)) return 'metadata';
  // IPv4-mapped IPv6 (::ffff:10.0.0.1).
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (mapped) address = mapped[1];
  const v4 = ipv4(address);
  if (v4) {
    if (METADATA_IPS.has(address)) return 'metadata';
    const [a, b] = v4;
    if (a === 127 || a === 0) return 'loopback';
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'private';
    if (a === 100 && b >= 64 && b <= 127) return 'private'; // carrier-grade NAT
    if (a === 169 && b === 254) return 'link-local';
    return 'public';
  }
  if (address === '::1' || address === '::') return 'loopback';
  if (/^f[cd][0-9a-f]{2}:/.test(address)) return 'private';
  if (/^fe[89ab][0-9a-f]:/.test(address)) return 'link-local';
  return 'public';
}

/** Kind of a URL host before DNS (names are checked again after resolution). */
export function classifyHost(hostname: string): TargetKind {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (METADATA_HOSTS.has(host)) return 'metadata';
  if (host === 'localhost' || host.endsWith('.localhost')) return 'loopback';
  if (
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.lan') ||
    host.endsWith('.home.arpa')
  )
    return 'private';
  return classifyAddress(host);
}

/** The most sensitive kind among several (a name may resolve to several addresses). */
export function worstKind(kinds: TargetKind[]): TargetKind {
  const order: TargetKind[] = ['metadata', 'link-local', 'private', 'loopback', 'public'];
  return order.find((k) => kinds.includes(k)) || 'public';
}

/** Methods that may change data on the server; every send is confirmed. */
export const changesData = (method: string): boolean =>
  !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
