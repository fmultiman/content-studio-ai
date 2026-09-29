# VIDEO_GENERATION_POLLING_LATENCY_V1

MCP completion latency: adaptive per-job schedule, a 10 s scheduler wake, and a database-only status
refresh in the browser. **Supersedes** the cadence numbers in
`VIDEO_GENERATION_CONNECTION_CAPABILITY_ROUTING_V1.md` §12 (60 s tick, 60/60/60/120/180 s steps, 30 s page sync).
No migration, no schema change, no new secret.

## Why

`KLING_MCP_REAL_GENERATION_PROOF_V1` proved the path end to end (submit 19:59:43, provider done, stored
20:01:46) but the design imposed avoidable waiting: the scheduler woke every ~60 s and every job's own
schedule was never shorter than that, so a job that finished just after a check waited up to another
minute; the page then added its own provider calls every 30 s.

## Two separate mechanisms

| Mechanism | Before | After |
|---|---|---|
| **Scheduler wake** (VPS → `POST /api/internal/video-generations/poll`) | ~60 s | **10 s** |
| **Provider query frequency** (per job, from `next_poll_at`) | 60/60/60/120/180 s | **adaptive, 10 s first** |
| **Browser status refresh** | 30 s, *and* it asked the provider each time | **10 s, database read only** |
| **Browser → provider sync** | every in-flight MCP row, every 30 s | **recovery only** (row overdue > 2 min) |

A wake that finds nothing due costs two cheap DB statements (orphan sweep `UPDATE` matching no row, and
the due `SELECT`) and makes **no provider call**. Provider traffic is governed only by each row's
`next_poll_at`, never by the wake frequency.

## Per-job schedule (`poll_attempts` = checks already made)

| Checks made | Next check in | Window |
|---|---|---|
| submit → 1st | 10 s | |
| 1–30 | 10 s | ~5 min (where a short video normally finishes) |
| 31–60 | 20 s | to ~15 min |
| 61–120 | 60 s | to ~1 h |
| > 120 | 3 min | until the 6 h / 23 h caps (unchanged) |

Provider load: ~12 checks for a 2-minute video, ≤ 60 in the first 15 minutes, ≤ 120 in the first hour;
with batch ≤ 10 and concurrency 2 the request rate stays far below Kling's documented 5 QPS.

Transient failures (outage, token refresh hiccup, storage/download failure) back off to **3× the normal
step, floor 30 s, cap 5 min** (`pollErrorDelayMs`); a revoked authorization backs off 5 min and never fails
the job; terminal rows clear `next_poll_at` and are never selected again. Max-age / hard-cap behavior is
unchanged.

## Overlap safety (verified, unchanged code)

- **Claim is atomic**: `UPDATE ... WHERE id = ? AND next_poll_at = <value read> AND status IN
  ('submitted','processing')` — Postgres serializes concurrent updates on the row, so exactly one caller
  matches; the others get no row. It also writes the lease (`next_poll_at = now + 3 min`) and increments
  `poll_attempts` in the same statement, so a check is counted once.
- A leased row is not due, so later 10 s wakes skip it; a crashed run's lease expires by itself.
- Completion is idempotent: deterministic object key (`{generation_id}.mp4`), compare-and-swap terminal
  transition, terminal rows untouched.
- The manual `/sync` route (and the page's recovery sync) does **not** take the lease; it is safe because of
  the idempotent completion, and is why the browser is limited to recovery.

## Browser (`/videos`)

While any generation is `queued|submitted|processing` the page re-reads `GET /api/video-generations`
every 10 s (skipped while the tab is hidden; ticks never overlap). That endpoint reads our database and
presigns already-stored paths; it never contacts the provider. A provider sync
(`POST /api/video-generations/{id}/sync`) is requested only for an MCP row whose `next_poll_at` is more
than 2 minutes in the past — i.e. the scheduler is not serving it — and at most once a minute per row.
The scheduler remains the only reliability mechanism.

## VPS scheduler contract (systemd)

The repo does not contain the unit files (they live on the VPS). Contract to apply:

```ini
# content-studio-video-poller.timer
[Timer]
OnBootSec=30s
OnUnitActiveSec=10s
AccuracySec=1s          # REQUIRED: systemd's default AccuracySec=1min would coalesce a 10 s timer
[Install]
WantedBy=timers.target
```

The service stays `Type=oneshot` with the existing `EnvironmentFile` and `curl -fsS -m 310 -X POST ...`. Because
a oneshot unit cannot be started again while it is still running, systemd itself serializes invocations
(a slow poll simply delays the next wake); the server-side lease still makes any overlap harmless.
Do not put the secret in the unit file or in command output.

Capacity note: a 10 s tick is ~8,640 Vercel function invocations/day (~260 k/month), most of them empty.

## Not done here (follow-ups)

- Provider-side push (webhook) does not exist for MCP; polling remains the mechanism.
- The orphan sweep runs on every wake; if wake volume ever matters it can run every Nth wake.
- Realtime (SSE/WebSocket) for the browser was deliberately not introduced.
