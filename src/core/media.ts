/** True when the bytes look like the declared audio/video container. */
export function looksLikeMedia(bytes: Uint8Array, ext: string): boolean {
  const head = Buffer.from(bytes.subarray(0, 12));
  switch (ext.toLowerCase()) {
    case '.mp4':
      return head.toString('latin1', 4, 8) === 'ftyp';
    case '.webm':
      return head.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex'));
    case '.ogg':
      return head.toString('latin1', 0, 4) === 'OggS';
    case '.mp3':
      return (
        head.toString('latin1', 0, 3) === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)
      );
    default:
      return false;
  }
}
