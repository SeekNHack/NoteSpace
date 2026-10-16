import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const token =
  /(^|\s)((?:due|start|done|priority|status|repeat|project|order):\S+|@[\p{L}\p{N}_.-]+|\^[A-Za-z0-9-]{1,32}|#[\p{L}\p{N}_/-]+)(?=\s|$)/gu;

/** Shows task metadata words as chips in Studio. Decorations only: the Markdown is unchanged. */
export const TaskTokens = Extension.create({
  name: 'taskTokens',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('taskTokens'),
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos, parent) => {
              if (!node.isText || parent?.type.name !== 'paragraph') return;
              const $pos = state.doc.resolve(pos);
              let inTask = false;
              for (let d = $pos.depth; d > 0; d--)
                if ($pos.node(d).type.name === 'taskItem') inTask = true;
              if (!inTask) return;
              for (const match of node.text!.matchAll(token)) {
                const from = pos + match.index! + match[1].length;
                const word = match[2];
                const kind = word.startsWith('#')
                  ? 'tag'
                  : word.startsWith('@')
                    ? 'person'
                    : word.startsWith('^')
                      ? 'id'
                      : word.split(':')[0];
                decorations.push(
                  Decoration.inline(from, from + word.length, { class: `task-token task-${kind}` }),
                );
              }
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
