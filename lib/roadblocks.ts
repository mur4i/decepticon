import data from "../data/roadblocks.json";

export type RoadblockStatus = "open" | "retrying" | "resolved" | "abandoned";

export interface Roadblock {
  id: string;
  title: string;
  ref?: string;
  summary: string;
  status: RoadblockStatus;
  attempts: number;
  createdAt: string;
  lastAttemptAt?: string;
  resolvedAt?: string;
  resolution?: string;
}

export interface RoadblockFile {
  items: Roadblock[];
}

export function getRoadblocks(): Roadblock[] {
  return (data as RoadblockFile).items;
}

export function getActiveRoadblocks(): Roadblock[] {
  return getRoadblocks().filter(
    (r) => r.status === "open" || r.status === "retrying"
  );
}
