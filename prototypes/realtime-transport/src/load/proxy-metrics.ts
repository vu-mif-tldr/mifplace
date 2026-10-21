/** CPU and memory of the reverse proxy over an interval (T6). */
export interface ProxySample {
  /** Share of one core, in %. */
  cpuPercent: number;
  rssMb: number;
}

/**
 * Reads Caddy's Prometheus endpoint (the `metrics` directive) and turns the process counters into
 * per-interval values, like ProcessSampler does for the server.
 */
export class ProxySampler {
  private readonly url: string;
  private last: { cpuSeconds: number; at: number } | null = null;

  constructor(url: string) {
    this.url = url;
  }

  /** Values since the previous call; `null` on the first call, which only starts the interval. */
  async sample(): Promise<ProxySample | null> {
    const response = await fetch(this.url);
    if (!response.ok) throw new Error(`GET ${this.url}: HTTP ${response.status}`);
    const text = await response.text();
    const cpuSeconds = metric(text, 'process_cpu_seconds_total');
    const rssBytes = metric(text, 'process_resident_memory_bytes');
    const at = performance.now();
    const previous = this.last;
    this.last = { cpuSeconds, at };
    if (previous === null) return null;
    const cpuPercent = ((cpuSeconds - previous.cpuSeconds) / ((at - previous.at) / 1_000)) * 100;
    return { cpuPercent: Math.round(cpuPercent * 10) / 10, rssMb: Math.round(rssBytes / 1e5) / 10 };
  }
}

/** The value of an unlabelled metric in the Prometheus text format. */
export function metric(text: string, name: string): number {
  const match = new RegExp(`^${name} (\\S+)$`, 'm').exec(text);
  if (match === null) throw new Error(`no ${name} in the metrics`);
  return Number(match[1]);
}
