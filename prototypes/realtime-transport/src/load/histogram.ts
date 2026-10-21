export interface HistogramData {
  buckets: Uint32Array;
  count: number;
  sum: number;
  max: number;
  negative: number;
}

export interface HistogramSummary {
  count: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

const MAX_MS = 60_000;

/**
 * Latencies in 1 ms buckets up to 60 s. Unlike the perf_hooks histograms it is plain data: worker
 * threads send theirs to the main thread, which adds them up before taking percentiles.
 */
export class Histogram implements HistogramData {
  buckets = new Uint32Array(MAX_MS + 1);
  count = 0;
  sum = 0;
  max = 0;
  /** Samples below 0, recorded as 0. A sign that two clocks are compared that differ. */
  negative = 0;

  record(ms: number): void {
    if (ms < 0) {
      this.negative++;
      ms = 0;
    }
    this.buckets[Math.min(Math.round(ms), MAX_MS)]++;
    this.count++;
    this.sum += ms;
    this.max = Math.max(this.max, ms);
  }

  merge(other: HistogramData): void {
    for (let i = 0; i < other.buckets.length; i++) this.buckets[i] += other.buckets[i];
    this.count += other.count;
    this.sum += other.sum;
    this.max = Math.max(this.max, other.max);
    this.negative += other.negative;
  }

  /** Nearest-rank percentile with 1 ms resolution; 0 when empty. */
  percentile(p: number): number {
    if (this.count === 0) return 0;
    const rank = Math.ceil((p / 100) * this.count);
    let seen = 0;
    for (let ms = 0; ms <= MAX_MS; ms++) {
      seen += this.buckets[ms];
      if (seen >= rank) return ms;
    }
    return MAX_MS;
  }

  data(): HistogramData {
    const { buckets, count, sum, max, negative } = this;
    return { buckets, count, sum, max, negative };
  }

  summary(): HistogramSummary {
    return {
      count: this.count,
      mean: this.count === 0 ? 0 : Math.round(this.sum / this.count),
      p50: this.percentile(50),
      p95: this.percentile(95),
      p99: this.percentile(99),
      max: Math.round(this.max),
    };
  }
}
