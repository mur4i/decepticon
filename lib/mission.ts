import data from "../data/mission.json";

export interface Mission {
  statement: string;
  audience: string;
  voice: string;
  scope: string[];
  antiScope: string[];
  register: string;
  format: string;
  cadence: string;
  northStar: string;
  decidedAt: string;
  decidedBy: string;
}

export function getMission(): Mission {
  return data as Mission;
}
