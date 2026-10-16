// Renders Mermaid in a worker: its globals are not patched by the VS Code extension host,
// and layout work stays off the host's main thread.
import { parentPort } from 'node:worker_threads';
import { renderMermaidSVG } from 'beautiful-mermaid';

parentPort?.on(
  'message',
  (message: { id: number; source: string; options: Record<string, unknown> }) => {
    try {
      parentPort!.postMessage({
        id: message.id,
        svg: renderMermaidSVG(message.source, message.options),
      });
    } catch (error) {
      parentPort!.postMessage({
        id: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
);
