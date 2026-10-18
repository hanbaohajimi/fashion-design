export interface LayoutPosition {
  readonly nodeId: string;
  readonly x: number;
  readonly y: number;
}

export interface LayoutBatch {
  readonly mutationId: string;
  readonly positions: readonly LayoutPosition[];
  request?: { readonly mutationId: string; readonly baseLayoutRevision: number; readonly positions: readonly LayoutPosition[] };
}

export type LayoutSaveState = "saved" | "dirty" | "saving" | "error";

/** A failed batch remains intact so an unknown server outcome can be replayed idempotently. */
export class WorkflowLayoutSave {
  private pending = new Map<string, LayoutPosition>();
  private batch: LayoutBatch | null = null;
  private flight: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private state: LayoutSaveState = "saved";
  private listeners = new Set<() => void>();

  constructor(private save: (batch: LayoutBatch) => Promise<void>) {}

  setHandler(save: (batch: LayoutBatch) => Promise<void>): void { this.save = save; }

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  readonly getSnapshot = () => this.state;
  readonly hasUnsaved = () => this.batch !== null || this.pending.size > 0;
  readonly getPositions = (): readonly LayoutPosition[] => [...new Map([
    ...(this.batch?.positions ?? []).map((position) => [position.nodeId, position] as const),
    ...this.pending.entries(),
  ]).values()];

  stage(positions: readonly LayoutPosition[]): void {
    for (const position of positions) this.pending.set(position.nodeId, position);
    if (!this.hasUnsaved()) return;
    if (!this.flight && this.state !== "error") this.publish("dirty");
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush().catch(() => undefined); }, 500);
  }

  readonly flush = (): Promise<void> => {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.flight) return this.flight;
    if (!this.hasUnsaved()) return Promise.resolve();
    this.publish("saving");
    // Start in a microtask so flight is set before an immediately resolving save.
    this.flight = Promise.resolve().then(async () => {
      while (this.hasUnsaved()) {
        if (!this.batch) {
          this.batch = { mutationId: crypto.randomUUID(), positions: [...this.pending.values()] };
          this.pending.clear();
        }
        await this.save(this.batch);
        this.batch = null;
      }
      this.publish("saved");
    }).catch((error: unknown) => {
      this.publish("error");
      throw error;
    }).finally(() => { this.flight = null; });
    return this.flight;
  };

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private publish(state: LayoutSaveState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
