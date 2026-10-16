import { build, context } from 'esbuild';
const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['vscode'],
  outfile: 'dist/extension.js',
  sourcemap: true,
  logLevel: 'info',
};
if (process.argv.includes('--watch')) {
  await (await context(options)).watch();
} else {
  // beautiful-mermaid only runs inside the worker bundle; the main bundle never loads it.
  await build({ ...options, external: ['vscode', 'beautiful-mermaid'], minify: true });
  // Optional MCP stdio server, started by MCP clients with plain Node.js.
  await build({
    ...options,
    entryPoints: ['src/mcp-server.ts'],
    outfile: 'dist/mcp-server.js',
    external: [],
    sourcemap: false,
    minify: true,
  });
  await build({
    ...options,
    entryPoints: ['src/mermaid-worker.ts'],
    outfile: 'dist/mermaid-worker.js',
    sourcemap: false,
    minify: true,
  });
  await build({
    entryPoints: ['src/visual-ui.ts'],
    bundle: true,
    platform: 'browser',
    target: 'es2022',
    format: 'iife',
    outfile: 'dist/visual.js',
    minify: true,
    logLevel: 'info',
  });
  await build({
    entryPoints: ['src/task-board-reader.ts'],
    bundle: true,
    platform: 'browser',
    target: 'es2022',
    format: 'iife',
    outfile: 'dist/task-board.js',
    minify: true,
    logLevel: 'info',
  });
  await build({
    entryPoints: ['src/planner-ui.ts'],
    bundle: true,
    platform: 'browser',
    target: 'es2022',
    format: 'iife',
    outfile: 'dist/planner.js',
    minify: true,
    logLevel: 'info',
  });
  await build({
    entryPoints: ['src/canvas-ui.ts'],
    bundle: true,
    platform: 'browser',
    target: 'es2022',
    format: 'iife',
    outfile: 'dist/canvas.js',
    minify: true,
    logLevel: 'info',
  });
  await build({
    entryPoints: ['src/dashboard-ui.ts'],
    bundle: true,
    platform: 'browser',
    target: 'es2022',
    format: 'iife',
    outfile: 'dist/dashboard.js',
    minify: true,
    logLevel: 'info',
  });
  await build({
    entryPoints: ['src/api-ui.ts'],
    bundle: true,
    platform: 'browser',
    target: 'es2022',
    format: 'iife',
    outfile: 'dist/api.js',
    minify: true,
    logLevel: 'info',
  });
  await build({
    entryPoints: ['src/api-client-ui.ts'],
    bundle: true,
    platform: 'browser',
    target: 'es2022',
    format: 'iife',
    outfile: 'dist/api-client.js',
    minify: true,
    logLevel: 'info',
  });
}
