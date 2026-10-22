// Reader bundle for boards embedded in pages and the other interactive blocks; media/webview.js
// owns the VS Code API and calls them.
import { wireTaskBoards } from './task-board-ui';
import { enhanceReaderBlocks, wireReaderBlocks } from './reader-blocks';

Object.assign(window, {
  wikiTaskBoards: wireTaskBoards,
  wikiReaderBlocks: wireReaderBlocks,
  wikiEnhanceBlocks: enhanceReaderBlocks,
});
