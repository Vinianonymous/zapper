import type { CircuitDocument } from "../model/contracts";
import { validateDocument } from "../persistence/json";

/** Undo snapshots contain only editable data, never solver results or viewport state. */
export class Workspace {
  private past: CircuitDocument[] = [];
  private future: CircuitDocument[] = [];
  constructor(public document: CircuitDocument) {}
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }

  edit(change: (document: CircuitDocument) => void): void {
    const next = structuredClone(this.document);
    change(next);
    this.replace(next);
  }

  replace(document: CircuitDocument): void {
    const next = validateDocument(document);
    this.past.push(this.document);
    if (this.past.length > 100) this.past.shift();
    this.future = [];
    this.document = next;
  }

  undo(): void {
    const previous = this.past.pop();
    if (!previous) return;
    this.future.push(this.document); this.document = previous;
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.document); this.document = next;
  }
}
