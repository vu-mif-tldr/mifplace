import type { LiveCanvasStats } from '../client/live-canvas.ts';
import type { TransportOptions } from '../client/transports.ts';
import type { TransportName } from '../shared/protocol.ts';
import type { HistogramData } from './histogram.ts';

/** Client timings. Empty = the browser defaults from DEFAULT_TRANSPORT_OPTIONS. */
export type ClientOptions = Partial<Omit<TransportOptions, 'baseUrl'>>;

export interface ViewerPoolConfig {
  url: string;
  transport: TransportName;
  viewers: number;
  rampPerSecond: number;
  client: ClientOptions;
}

export type ToViewers =
  /** The warm-up is over: reset the counters and start recording. */
  | { t: 'measure' }
  /** The writer has stopped: wait until every viewer has `targetId`, then report and stop. */
  | { t: 'finish'; targetId: number; drainMs: number };

export type FromViewers =
  | { t: 'progress'; started: number; open: number; failed: number }
  | { t: 'report'; report: ViewerPoolReport };

export interface ViewerPoolReport {
  viewers: number;
  /** Viewers connected when the measurement ended. */
  open: number;
  /** Viewers that could not even load the snapshot. */
  failed: number;
  /** Viewers that did not reach `targetId` within the drain time: they lost events. */
  behind: number;
  /** Over the measurement window. */
  stats: LiveCanvasStats;
  latency: HistogramData;
  /** Event loop delay of this thread over the whole measurement window, ms. */
  eventLoop: { p99: number; max: number };
}

export function emptyStats(): LiveCanvasStats {
  return { applied: 0, duplicates: 0, gaps: 0, resyncs: 0, reconnects: 0 };
}

/** target += factor * source, field by field. */
export function addStats(target: LiveCanvasStats, source: LiveCanvasStats, factor = 1): void {
  for (const key of Object.keys(target) as (keyof LiveCanvasStats)[]) {
    target[key] += factor * source[key];
  }
}
