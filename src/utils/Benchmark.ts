// src/utils/Benchmark.ts
// Live performance measurement for hackathon demo
// Tracks inference time for each pipeline stage

type BenchmarkEntry = {
  startTime: number;
  samples: number[];
};

class BenchmarkTimer {
  private timings: Map<string, BenchmarkEntry> = new Map();
  private readonly MAX_SAMPLES = 30;

  start(label: string): void {
    const existing = this.timings.get(label);
    if (existing) {
      existing.startTime = Date.now();
    } else {
      this.timings.set(label, { startTime: Date.now(), samples: [] });
    }
  }

  end(label: string): number {
    const entry = this.timings.get(label);
    if (!entry || entry.startTime === 0) return 0;

    const duration = Date.now() - entry.startTime;
    entry.samples.push(duration);
    if (entry.samples.length > this.MAX_SAMPLES) {
      entry.samples.shift();
    }
    entry.startTime = 0;
    return duration;
  }

  getStats(label: string): { avg: number; min: number; max: number; last: number } {
    const entry = this.timings.get(label);
    if (!entry || entry.samples.length === 0) {
      return { avg: 0, min: 0, max: 0, last: 0 };
    }
    const s = entry.samples;
    return {
      avg: Math.round(s.reduce((a, b) => a + b, 0) / s.length),
      min: Math.min(...s),
      max: Math.max(...s),
      last: s[s.length - 1],
    };
  }

  getTotal(): number {
    const labels = ['detection', 'liveness', 'recognition'];
    return labels.reduce((sum, l) => sum + this.getStats(l).avg, 0);
  }

  getFullReport(): string {
    const d = this.getStats('detection');
    const l = this.getStats('liveness');
    const r = this.getStats('recognition');
    const total = d.avg + l.avg + r.avg;
    return (
      `Detection: ${d.avg}ms | ` +
      `Liveness: ${l.avg}ms | ` +
      `Recognition: ${r.avg}ms | ` +
      `TOTAL: ${total}ms`
    );
  }

  reset(): void {
    this.timings.clear();
  }
}

export const Benchmark = new BenchmarkTimer();
