import { looksLikeMedia } from './core/media';
import * as vscode from 'vscode';
import { WikiRoot, WikiWorkspace } from './workspace';
import { Page } from './core/model';
import { insidePath, posix, splitTarget, uriPath } from './core/paths';

const raster = /\.(png|jpe?g|gif|webp)$/i;
const media = /\.(mp4|webm|mp3|ogg)$/i;
const attachment = /\.(pdf|txt|csv|zip|docx|xlsx|pptx)$/i;
function checkImage(bytes: Uint8Array, ext: string): void {
  const signature = Buffer.from(bytes.subarray(0, 16));
  const valid =
    ext === '.png'
      ? signature.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      : ['.jpg', '.jpeg'].includes(ext)
        ? signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff
        : ext === '.gif'
          ? /^GIF8[79]a/.test(signature.toString('latin1'))
          : ext === '.webp'
            ? signature.toString('latin1', 0, 4) === 'RIFF' &&
              signature.toString('latin1', 8, 12) === 'WEBP'
            : false;
  if (!valid) throw new Error('Image content does not match its extension.');
}
export async function resolveImage(
  workspace: WikiWorkspace,
  root: WikiRoot,
  page: Page,
  target: string,
): Promise<vscode.Uri | undefined> {
  const path = splitTarget(target).path;
  if (/^(?:[a-z]+:|\/\/)/i.test(path)) return;
  const file = posix.normalize(
    path.startsWith('/') ? path.slice(1) : posix.join(posix.dirname(page.path), path),
  );
  if (!raster.test(file)) return;
  const inProjectAssets = file.startsWith('../assets/') && root.projectUri;
  if (!insidePath(file) && !inProjectAssets) return;
  const uri = inProjectAssets
    ? vscode.Uri.joinPath(root.projectUri!, file.slice(3))
    : vscode.Uri.joinPath(root.uri, file);
  try {
    await workspace.assertNoSymlink(root, uri);
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type !== vscode.FileType.File || stat.size > 20 * 1024 * 1024) return;
    return uri;
  } catch {
    return;
  }
}
/** Local passive media only; remote URLs, symlinks and oversized files are excluded. */
export async function resolveMedia(
  workspace: WikiWorkspace,
  root: WikiRoot,
  page: Page,
  target: string,
): Promise<vscode.Uri | undefined> {
  const path = splitTarget(target).path;
  if (/^(?:[a-z]+:|\/\/)/i.test(path)) return;
  const file = posix.normalize(
    path.startsWith('/') ? path.slice(1) : posix.join(posix.dirname(page.path), path),
  );
  if (!media.test(file)) return;
  const inProjectAssets = file.startsWith('../assets/') && root.projectUri;
  if (!insidePath(file) && !inProjectAssets) return;
  const uri = inProjectAssets
    ? vscode.Uri.joinPath(root.projectUri!, file.slice(3))
    : vscode.Uri.joinPath(root.uri, file);
  try {
    await workspace.assertNoSymlink(root, uri);
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type !== vscode.FileType.File || stat.size > 50 * 1024 * 1024) return;
    return uri;
  } catch {
    return;
  }
}
export async function resolveAttachment(
  workspace: WikiWorkspace,
  root: WikiRoot,
  page: Page,
  target: string,
): Promise<vscode.Uri | undefined> {
  const path = splitTarget(target).path;
  if (/^(?:[a-z]+:|\/\/)/i.test(path)) return;
  const file = posix.normalize(
    path.startsWith('/') ? path.slice(1) : posix.join(posix.dirname(page.path), path),
  );
  if (!attachment.test(file)) return;
  const inProjectAssets = file.startsWith('../assets/attachments/') && root.projectUri;
  if (!insidePath(file) && !inProjectAssets) return;
  const uri = inProjectAssets
    ? vscode.Uri.joinPath(root.projectUri!, file.slice(3))
    : vscode.Uri.joinPath(root.uri, file);
  try {
    await workspace.assertNoSymlink(root, uri);
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type !== vscode.FileType.File || stat.size > 25 * 1024 * 1024) return;
    return uri;
  } catch {
    return;
  }
}
export async function importAttachment(
  workspace: WikiWorkspace,
  root: WikiRoot,
  page: Page,
  source: vscode.Uri,
): Promise<string> {
  if (!attachment.test(source.path))
    throw new Error('Choose a PDF, text, CSV, ZIP, DOCX, XLSX, or PPTX attachment.');
  const stat = await vscode.workspace.fs.stat(source);
  if (stat.type !== vscode.FileType.File || stat.size > 25 * 1024 * 1024)
    throw new Error('Attachment must be a regular file smaller than 25 MiB.');
  const bytes = await vscode.workspace.fs.readFile(source);
  const ext = posix.extname(source.path).toLowerCase();
  const original =
    posix
      .basename(source.path, ext)
      .replace(/[^\p{L}\p{N}._-]+/gu, '-')
      .replace(/^[-.]+|[-.]+$/g, '') || 'attachment';
  const directory = root.projectUri
    ? vscode.Uri.joinPath(root.projectUri, 'assets', 'attachments')
    : vscode.Uri.joinPath(root.uri, 'assets', 'attachments');
  await workspace.assertNoSymlink(root, directory);
  await vscode.workspace.fs.createDirectory(directory);
  let uri: vscode.Uri | undefined,
    filename = '';
  for (let i = 0; i < 10000; i++) {
    filename = `${original}${i ? `-${i}` : ''}${ext}`;
    const candidate = vscode.Uri.joinPath(directory, filename);
    try {
      await vscode.workspace.fs.stat(candidate);
    } catch (e) {
      if (e instanceof vscode.FileSystemError && e.code === 'FileNotFound') {
        uri = candidate;
        break;
      }
      throw e;
    }
  }
  if (!uri) throw new Error('Could not find a free attachment filename.');
  await vscode.workspace.fs.writeFile(uri, bytes);
  const base = root.projectUri
    ? posix.join(root.config?.content.root || 'docs', page.path)
    : page.path;
  return posix.relative(
    posix.dirname(base),
    root.projectUri
      ? posix.join('assets/attachments', filename)
      : posix.join('assets/attachments', filename),
  );
}
export async function importImage(
  workspace: WikiWorkspace,
  root: WikiRoot,
  page: Page,
  source: vscode.Uri,
): Promise<string> {
  if (!raster.test(source.path)) throw new Error('Choose a PNG, JPEG, GIF, or WebP image.');
  const stat = await vscode.workspace.fs.stat(source);
  if (stat.type !== vscode.FileType.File || stat.size > 20 * 1024 * 1024)
    throw new Error('Image must be a regular file smaller than 20 MiB.');
  const bytes = await vscode.workspace.fs.readFile(source);
  const ext = posix.extname(source.path).toLowerCase();
  return storeImage(workspace, root, page, posix.basename(source.path, ext), ext, bytes);
}
export async function storeImage(
  workspace: WikiWorkspace,
  root: WikiRoot,
  page: Page,
  name: string,
  ext: string,
  bytes: Uint8Array,
): Promise<string> {
  if (!raster.test(ext) || bytes.length > 20 * 1024 * 1024)
    throw new Error('Unsupported image or image exceeds 20 MiB.');
  checkImage(bytes, ext);
  const original =
    name.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^[-.]+|[-.]+$/g, '') || 'image';
  const directory = root.projectUri
    ? vscode.Uri.joinPath(root.projectUri, 'assets', 'images')
    : vscode.Uri.joinPath(root.uri, 'assets', 'images');
  await workspace.assertNoSymlink(root, directory);
  await vscode.workspace.fs.createDirectory(directory);
  let uri: vscode.Uri | undefined,
    filename = '';
  for (let i = 0; i < 10000; i++) {
    filename = `${original}${i ? `-${i}` : ''}${ext}`;
    const candidate = vscode.Uri.joinPath(directory, filename);
    try {
      await vscode.workspace.fs.stat(candidate);
    } catch (e) {
      if (e instanceof vscode.FileSystemError && e.code === 'FileNotFound') {
        uri = candidate;
        break;
      }
      throw e;
    }
  }
  if (!uri) throw new Error('Could not find a free image filename.');
  await vscode.workspace.fs.writeFile(uri, bytes);
  const relative = root.projectUri
    ? posix.relative(
        posix.dirname(posix.join(root.config?.content.root || 'docs', page.path)),
        posix.join('assets/images', filename),
      )
    : posix.relative(posix.dirname(page.path), posix.join('assets/images', filename));
  return relative;
}
export async function browseImages(
  workspace: WikiWorkspace,
  root: WikiRoot,
  page: Page,
): Promise<Array<{ label: string; target: string }>> {
  const directory = root.projectUri
    ? vscode.Uri.joinPath(root.projectUri, 'assets', 'images')
    : vscode.Uri.joinPath(root.uri, 'assets', 'images');
  await workspace.assertNoSymlink(root, directory);
  const uris = await vscode.workspace.findFiles(
    new vscode.RelativePattern(directory, '**/*.{png,jpg,jpeg,gif,webp}'),
    null,
    1001,
  );
  if (uris.length > 1000) throw new Error('Asset browser is limited to 1,000 images.');
  const base = root.projectUri
    ? posix.join(root.config?.content.root || 'docs', page.path)
    : page.path;
  return uris
    .map((uri) => ({
      label: posix.basename(uri.path),
      target: posix.relative(
        posix.dirname(base),
        root.projectUri
          ? posix.relative(uriPath(root.projectUri), uriPath(uri))
          : posix.relative(uriPath(root.uri), uriPath(uri)),
      ),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Copies a local audio/video file into the wiki's media assets and returns a relative link. */
export async function importMedia(
  workspace: WikiWorkspace,
  root: WikiRoot,
  page: Page,
  source: vscode.Uri,
): Promise<string> {
  if (!media.test(source.path)) throw new Error('Choose an MP4, WebM, MP3, or Ogg file.');
  const stat = await vscode.workspace.fs.stat(source);
  if (stat.type !== vscode.FileType.File || stat.size > 50 * 1024 * 1024)
    throw new Error('Media must be a regular file smaller than 50 MiB.');
  const bytes = await vscode.workspace.fs.readFile(source);
  const ext = posix.extname(source.path).toLowerCase();
  if (!looksLikeMedia(bytes, ext))
    throw new Error('The file content does not match its media type.');
  const original =
    posix
      .basename(source.path, ext)
      .replace(/[^\p{L}\p{N}._-]+/gu, '-')
      .replace(/^[-.]+|[-.]+$/g, '') || 'media';
  const directory = root.projectUri
    ? vscode.Uri.joinPath(root.projectUri, 'assets', 'media')
    : vscode.Uri.joinPath(root.uri, 'assets', 'media');
  await workspace.assertNoSymlink(root, directory);
  await vscode.workspace.fs.createDirectory(directory);
  let filename = '';
  for (let i = 0; i < 10000; i++) {
    filename = `${original}${i ? `-${i}` : ''}${ext}`;
    try {
      await vscode.workspace.fs.stat(vscode.Uri.joinPath(directory, filename));
    } catch (e) {
      if (e instanceof vscode.FileSystemError && e.code === 'FileNotFound') {
        await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(directory, filename), bytes);
        const base = root.projectUri
          ? posix.join(root.config?.content.root || 'docs', page.path)
          : page.path;
        return posix.relative(posix.dirname(base), posix.join('assets/media', filename));
      }
      throw e;
    }
  }
  throw new Error('Could not find a free media filename.');
}
