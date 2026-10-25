import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { metric } from '../src/load/proxy-metrics.ts';

describe('metric', () => {
  it('reads an unlabelled value from the Prometheus text format', () => {
    const text = [
      '# HELP process_cpu_seconds_total Total user and system CPU time spent in seconds.',
      '# TYPE process_cpu_seconds_total counter',
      'process_cpu_seconds_total 12.34',
      'process_resident_memory_bytes 4.5e+07',
      'go_goroutines{instance="a"} 7',
    ].join('\n');
    assert.equal(metric(text, 'process_cpu_seconds_total'), 12.34);
    assert.equal(metric(text, 'process_resident_memory_bytes'), 45_000_000);
    assert.throws(() => metric(text, 'go_goroutines'), /no go_goroutines/);
  });
});
