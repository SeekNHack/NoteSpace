// Reader bundle for boards embedded in pages; media/webview.js owns the VS Code API and calls it.
import { wireTaskBoards } from './task-board-ui';

(window as unknown as { wikiTaskBoards: typeof wireTaskBoards }).wikiTaskBoards = wireTaskBoards;
