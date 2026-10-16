import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url),
  pkg = JSON.parse(await readFile('package.json', 'utf8'));
const seen = new Set(),
  sections = [];
async function visit(name, parentRequire) {
  let file;
  try {
    file = parentRequire.resolve(`${name}/package.json`);
  } catch {
    for (const base of parentRequire.resolve.paths(name) || []) {
      const candidate = path.join(base, name, 'package.json');
      try {
        if (JSON.parse(await readFile(candidate, 'utf8')).name === name) {
          file = candidate;
          break;
        }
      } catch {}
    }
    if (!file) throw new Error(`Cannot find metadata for ${name}`);
  }
  const dependency = JSON.parse(await readFile(file, 'utf8')),
    key = `${dependency.name}@${dependency.version}`;
  if (seen.has(key)) return;
  seen.add(key);
  const folder = path.dirname(file),
    files = (await readdir(folder)).filter((f) => /^(license|copying)([.\-]|$)/i.test(f));
  if (!files.length) throw new Error(`No license file for ${key}`);
  sections.push(
    `## ${key}\n\nLicense: ${dependency.license || 'See text below'}\n\n${(await Promise.all(files.map((f) => readFile(path.join(folder, f), 'utf8')))).map((text) => `\`\`\`text\n${text.trim()}\n\`\`\``).join('\n\n')}`,
  );
  for (const child of Object.keys(dependency.dependencies || {}).sort())
    await visit(child, createRequire(file));
}
for (const name of Object.keys(pkg.dependencies).sort()) await visit(name, require);
await writeFile(
  'THIRD_PARTY_NOTICES.md',
  '# Third-party notices\n\nGenerated from the runtime dependencies bundled in the extension. Development tools are not shipped.\n\n' +
    sections.join('\n\n') +
    '\n',
);
console.log(`Recorded licenses for ${seen.size} runtime packages.`);
