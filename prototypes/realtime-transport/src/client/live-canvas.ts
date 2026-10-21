import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  EMPTY_CELL,
  formatCursor,
  fromWire,
  type CanvasSnapshot,
  type PlaceResult,
  type ServerMessage,
  type TransportName,
} from '../shared/protocol.ts';
import {
  createTransport,
  DEFAULT_TRANSPORT_OPTIONS,
  describe,
  sleep,
  type Transport,
  type TransportOptions,
  type TransportState,
} from './transports.ts';

const LATENCY_WINDOW = 200;

export interface LiveCanvasStats {
  /** Events applied to the canvas. */
  applied: number;
  /** Events skipped because the client already had them (after a snapshot or a reconnect). */
  duplicates: number;
  /** Missing ids noticed. Each one makes the client reload the snapshot; should stay 0. */
  gaps: number;
  /** Snapshot reloads, on a reset from the server or on a gap. */
  resyncs: number;
  /** Times the transport became open again after the first time. */
  reconnects: number;
  /** Failed attempts to load the snapshot during a resync, for example while the server restarts. */
  snapshotFailures: number;
}

export interface LiveCanvasOptions extends Partial<Omit<TransportOptions, 'baseUrl'>> {
  baseUrl: string;
  transport: TransportName;
  onChange?: () => void;
  onLog?: (line: string) => void;
  /** Called for every applied event with its delivery latency in ms. */
  onApplied?: (latencyMs: number) => void;
  /**
   * Where to load the snapshot from, if not `baseUrl`. The load tool's slow viewers (T5) load it
   * directly and only stream through the throttling proxy.
   */
  snapshotUrl?: string;
}

/**
 * The client side of the protocol, the same for every transport and free of the DOM: keeps the
 * canvas and the last event id, skips duplicates, and reloads the snapshot on a gap or a reset.
 */
export class LiveCanvas {
  cells = new Uint8Array(CANVAS_WIDTH * CANVAS_HEIGHT).fill(EMPTY_CELL);
  lastEventId = 0;
  /** Server time of the last event; with the id it makes the cursor the client continues from. */
  lastEventTs = 0;
  state: TransportState = 'stopped';
  readonly stats: LiveCanvasStats = {
    applied: 0,
    duplicates: 0,
    gaps: 0,
    resyncs: 0,
    reconnects: 0,
    snapshotFailures: 0,
  };
  /** Delivery latency of the last events in ms: client receive time minus server event time. */
  readonly latencies: number[] = [];
  private readonly snapshotUrl: string;
  private readonly onChange: () => void;
  private readonly onLog: (line: string) => void;
  private readonly onApplied: (latencyMs: number) => void;
  private readonly transport: Transport;
  private opens = 0;
  private resyncing = false;
  private stopped = false;

  constructor(options: LiveCanvasOptions) {
    this.snapshotUrl = options.snapshotUrl ?? options.baseUrl;
    this.onChange = options.onChange ?? (() => {});
    this.onLog = options.onLog ?? (() => {});
    this.onApplied = options.onApplied ?? (() => {});
    this.transport = createTransport(
      options.transport,
      { ...DEFAULT_TRANSPORT_OPTIONS, ...options },
      {
        cursor: () => formatCursor({ id: this.lastEventId, ts: this.lastEventTs }),
        onMessage: (message) => this.receive(message),
        onState: (state, detail) => this.setState(state, detail),
      }
    );
  }

  async start(): Promise<void> {
    await this.loadSnapshot();
    this.transport.start();
  }

  stop(): void {
    this.stopped = true;
    this.transport.stop();
  }

  drop(): void {
    this.transport.drop();
  }

  place(x: number, y: number, color: number): Promise<PlaceResult> {
    return this.transport.place(x, y, color);
  }

  private receive(message: ServerMessage): void {
    if (message.t === 'reset') {
      void this.resync('the server asked for a reset');
      return;
    }
    if (message.t !== 'batch' || message.events.length === 0) return;

    for (const wire of message.events) {
      const event = fromWire(wire);
      if (event.id <= this.lastEventId) {
        this.stats.duplicates++;
        continue;
      }
      if (event.id !== this.lastEventId + 1) {
        this.stats.gaps++;
        void this.resync(`gap: expected event ${this.lastEventId + 1}, got ${event.id}`);
        return;
      }
      this.cells[event.y * CANVAS_WIDTH + event.x] = event.color;
      this.lastEventId = event.id;
      this.lastEventTs = event.ts;
      this.stats.applied++;
      const latency = Date.now() - event.ts;
      this.latencies.push(latency);
      this.onApplied(latency);
    }
    if (this.latencies.length > LATENCY_WINDOW) {
      this.latencies.splice(0, this.latencies.length - LATENCY_WINDOW);
    }
    this.onChange();
  }

  private async resync(reason: string): Promise<void> {
    if (this.resyncing) return;
    this.resyncing = true;
    this.stats.resyncs++;
    this.onLog(`resync: ${reason}`);
    this.transport.stop();
    // Retry until the server answers: it may be restarting right now.
    for (let delay = 250; !this.stopped; delay = Math.min(delay * 2, 5_000)) {
      try {
        await this.loadSnapshot();
        break;
      } catch (error) {
        this.stats.snapshotFailures++;
        this.onLog(`snapshot failed: ${describe(error)}`);
        await sleep(delay);
      }
    }
    this.resyncing = false;
    if (!this.stopped) this.transport.start();
  }

  private async loadSnapshot(): Promise<void> {
    const response = await fetch(new URL('/api/canvas', this.snapshotUrl));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const snapshot = (await response.json()) as CanvasSnapshot;
    this.cells = Uint8Array.from(snapshot.cells);
    this.lastEventId = snapshot.lastEventId;
    this.lastEventTs = snapshot.lastEventTs;
    this.onLog(`snapshot loaded, last event ${snapshot.lastEventId}`);
    this.onChange();
  }

  private setState(state: TransportState, detail?: string): void {
    this.state = state;
    if (state === 'open' && ++this.opens > 1) this.stats.reconnects++;
    this.onLog(detail === undefined ? state : `${state}: ${detail}`);
    this.onChange();
  }
}

/** Nearest-rank percentile, `null` for no values. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? null;
}
