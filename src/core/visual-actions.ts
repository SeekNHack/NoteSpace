export type VisualAction = 'save' | 'source' | 'split' | 'undo' | 'redo';

/**
 * Actions wait until Studio edits reach the shared document. History steps keep their order,
 * Save requests coalesce, and only the latest requested editor mode is kept.
 */
export class VisualActionQueue {
  private history: Array<'undo' | 'redo'> = [];
  private save = false;
  private mode: 'source' | 'split' | undefined;

  request(action: VisualAction): void {
    if (action === 'undo' || action === 'redo') {
      if (this.history.length < 50) this.history.push(action);
    } else if (action === 'save') this.save = true;
    else this.mode = action;
  }

  takeNext(ready: boolean): VisualAction | undefined {
    if (!ready) return undefined;
    const step = this.history.shift();
    if (step) return step;
    if (this.save) {
      this.save = false;
      return 'save';
    }
    const mode = this.mode;
    this.mode = undefined;
    return mode;
  }

  clear(): void {
    this.history = [];
    this.save = false;
    this.mode = undefined;
  }
}
