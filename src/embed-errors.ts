import * as vscode from 'vscode';

/** A readable reason for a broken embed: missing files are named by the path the page used. */
export function embedError(error: unknown, path: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') ||
    /ENOENT|EntryNotFound|FileNotFound/.test(message)
  )
    return `“${path}” was not found in this wiki. Check the path, or choose an existing file from the / menu.`;
  return message;
}
