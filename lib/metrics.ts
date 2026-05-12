import data from "../data/metrics.json";

export interface Metrics {
  linesToday: number;
  activeRoadblocks: number;
  selfHealed: number;
  totalAttempts: number;
  chroniclesWritten: number;
  recent: { title: string; at: string }[];
  updatedAt: string;
}

export function getMetrics(): Metrics {
  return data as Metrics;
}
