import { inflateRawSync } from 'node:zlib';

/**
 * Minimal ZIP reader for workbook files: central directory, stored and deflated entries,
 * no encryption, no ZIP64. Sizes are bounded to protect the extension host.
 */
export interface ZipFile {
  names(): string[];
  read(name: string): Uint8Array | undefined;
  text(name: string): string | undefined;
}

const MAX_ENTRY = 256 * 1024 * 1024;

export function unzip(bytes: Uint8Array, maxTotal = 512 * 1024 * 1024): ZipFile {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0)
    throw new Error('Not a ZIP container (the file may be incomplete or still being written).');
  const count = buf.readUInt16LE(end + 10);
  let offset = buf.readUInt32LE(end + 16);
  const entries = new Map<
    string,
    { method: number; size: number; compressed: number; local: number; flags: number }
  >();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) throw new Error('Corrupt ZIP directory.');
    const flags = buf.readUInt16LE(offset + 8);
    const method = buf.readUInt16LE(offset + 10);
    const compressed = buf.readUInt32LE(offset + 20);
    const size = buf.readUInt32LE(offset + 24);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extra = buf.readUInt16LE(offset + 30);
    const comment = buf.readUInt16LE(offset + 32);
    const local = buf.readUInt32LE(offset + 42);
    const name = buf
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString(flags & 0x800 ? 'utf8' : 'latin1');
    entries.set(name, { method, size, compressed, local, flags });
    offset += 46 + nameLength + extra + comment;
  }
  let total = 0;
  for (const e of entries.values()) {
    if (e.size > MAX_ENTRY) throw new Error('A workbook part is too large to read safely.');
    total += e.size;
  }
  if (total > maxTotal) throw new Error('The workbook is too large to read safely.');
  const read = (name: string) => {
    const e = entries.get(name);
    if (!e) return undefined;
    if (e.flags & 1) throw new Error('Encrypted workbooks are not supported.');
    if (buf.readUInt32LE(e.local) !== 0x04034b50) throw new Error('Corrupt ZIP entry.');
    const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
    const data = buf.subarray(start, start + e.compressed);
    if (e.method === 0) return new Uint8Array(data);
    if (e.method === 8) {
      const out = inflateRawSync(data, { maxOutputLength: Math.max(e.size, 1) + 1024 });
      return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
    }
    throw new Error(`Unsupported ZIP compression method ${e.method}.`);
  };
  return {
    names: () => [...entries.keys()],
    read,
    text: (name) => {
      const data = read(name);
      return data && new TextDecoder().decode(data);
    },
  };
}
