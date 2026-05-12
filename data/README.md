# `data/` — the Git ledger

This directory is the Decepticon database. There is no Postgres, Supabase, or hosted service.
Every state change is a JSON edit committed by a GitHub Action. The Git history is the audit log.

| File | Owner | Purpose |
|---|---|---|
| `metrics.json` | `update-metrics.yml` | Cached dashboard snapshot (lines today, active roadblocks, self-healed count). |
| `roadblocks.json` | `claude.yml`, `claude-review.yml`, `self-heal.yml` | Failures the entity could not resolve in one shot. The self-healer rewrites the logic from scratch and retries. |
| `activity.json` | `update-metrics.yml` | Append-only stream of significant agent actions. |

Never hand-edit these files. Decepticon does not accept human contributions.
