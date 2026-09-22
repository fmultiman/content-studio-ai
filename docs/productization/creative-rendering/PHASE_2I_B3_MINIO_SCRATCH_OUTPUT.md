# Phase 2I-B3 — MinIO Scratch Output Persistence

**Nature:** Bounded implementation of the third executable slice of `PHASE_2I_B0_RENDER_EXECUTION_CONTRACT.md` (§22: 2I-B3), building on `PHASE_2I_B2_RENDER_WORKER_COORDINATION.md`. Closes the first truthful asynchronous lifecycle: `queued → claimed → runtime resolution → render → local /tmp MP4 → MinIO scratch upload → complete → completed`. No product UI, no VPS/Portainer access, no LibraryFile/ChannelPieceMedia creation, no DB migration.

## 1. Objective

Implement, per B0 §11/§12 and B2 §13's disclosed B3 boundary: the worker-side MinIO/S3-compatible scratch upload, a hardened `/complete` route that accepts only this execution's own deterministic output target, and a portable dependency-packaging solution for the new `@aws-sdk/client-s3` runtime dependency the worker did not previously need.

## 2. Files Changed This Phase

| File | Nature |
|---|---|
| `lib/render-execution/scratch-output-target.ts` | New — the single shared deterministic-target derivation, imported by both the Control Plane route and the worker bundle. |
| `lib/render-execution/minio-client-config.ts` | New — pure MinIO env parsing + PutObject param shaping (worker-only concern, kept testable under `lib/**`). |
| `lib/render-execution/worker-lifecycle.ts` | New — pure upload/complete/cleanup/retry decision functions the coordinator wires together. |
| `infra/render-worker-runtime/minio-upload.mjs` | New — the only file that imports `@aws-sdk/client-s3`; worker-side upload wrapper. |
| `infra/render-worker-runtime/coordinator.mjs` | Modified — adds the upload → complete → cleanup lifecycle after a successful render; continuous-loop mode is no longer gated (B2 kept it disabled pending this phase). |
| `infra/render-worker-runtime/export.mjs` | Modified — adds an esbuild bundling step (`bundleCoordinator`) and a portable dependency-load smoke test (`smokeTestBundlePortability`), both run automatically on every export. |
| `app/api/render-executions/claim/route.ts` | Modified — the claim response now includes `userId` (needed by the worker to compute the deterministic scratch key). |
| `app/api/render-executions/[id]/complete/route.ts` | Modified — hardened to reject any output bucket/key other than this execution's own server-derived target. |
| `package.json` / `pnpm-lock.yaml` | Modified — `esbuild` promoted from a transitive (pnpm-store-only, not root-resolvable) dependency to an explicit, pinned `devDependency` (`0.28.1`, the exact version already resolved transitively) — a repo build-tool dependency, never shipped to the VPS runtime. |
| `lib/render-execution/__tests__/{scratch-output-target,minio-client-config,worker-lifecycle,worker-secret-not-logged,complete-route-output-authority}.test.ts` | New — 5 files, 51 tests. |

No `scripts/*.sql` migration, no `app/(dashboard)/videos/` change, no `LibraryFile`/`ChannelPieceMedia` creation code anywhere in this diff.

## 3. Task 1/2 — Output Target Authority Audit and Hardening

**Audit finding:** the B2 `/complete` route accepted `outputBucket`/`outputStoragePath` from the worker-authenticated request body with only generic sanity checks (`outputBucket` non-empty/≤255/no `.`; `outputStoragePath` non-empty/≤1024/no `..`/no leading `/`). A worker request (i.e. anyone holding the shared worker secret) could therefore have marked **any** syntactically valid bucket/path — including another user's prefix or another execution's own key — as this execution's authoritative output. This was too permissive per B0 §16's "browser must never set output paths" principle extended to its intended scope (only the worker, via the shared secret, could reach this route at all — but even the worker should only ever be able to confirm its own execution's own target, not claim an arbitrary one).

**Fix:** `lib/render-execution/scratch-output-target.ts` centralizes the ONE deterministic target derivation (`buildScratchOutputTarget({ userId, executionId })` → `{ bucket, key }`) and an exact-match predicate (`isExpectedScratchOutputTarget`). The `/complete` route now:
1. Loads the execution row (`user_id`, `status`) — unchanged from B2.
2. Validates the `claimed → completed` transition — unchanged from B2.
3. **New (§6A in the route's own comments):** computes the execution's own expected target from `execution.user_id` + `execution.id` and requires the worker-submitted `outputBucket`/`outputStoragePath` to match it **exactly** — any other value (wrong bucket, another user's prefix, another execution's key, a path-traversal-mutated key) is rejected with `400 OUTPUT_TARGET_MISMATCH` before any DB write happens.
4. Writes the row using the same (now-verified-identical) values — the generic sanity checks from B2 remain as defense in depth underneath the new exact-match check, not replaced by it.

The worker-submitted values are therefore a **confirmation** ("this is what I actually uploaded to"), never trusted input — the server never derives what to persist from anything the request body alone asserts.

## 4. Deterministic Scratch Key Convention (Task 2)

```
bucket: content-studio (or RENDER_EXECUTION_SCRATCH_BUCKET / S3_BUCKET_NAME / S3_BUCKET env override, in that order)
key:    users/{user_id}/renders/scratch/{render_execution_id}/output.mp4
```

Exactly B0 §11's convention — reusing the existing bucket, not inventing a second one. Both `userId` and `executionId` are validated as UUIDs before the key is constructed (`buildScratchOutputKey` throws on anything else), so a path-traversal-shaped input cannot silently produce a path-traversal-shaped key.

**Properties proven by test** (`scratch-output-target.test.ts`):
- Same execution retried (reclaimed after a lease expiry, or a bounded complete-retry, §9) → same key → safe overwrite of the same object.
- A new execution (even for the same user) → a different, non-overlapping key.
- Different users never collide.
- No `..`, no leading `/`, no arbitrary bucket, no cross-user, no cross-execution key is ever accepted as a match.

**Single source of truth:** the Control Plane route imports this module directly (`@/lib/render-execution/scratch-output-target`); the worker's `minio-upload.mjs` imports the *same file* by relative path (`../../lib/render-execution/scratch-output-target.ts`), which esbuild transpiles and inlines into the bundled coordinator at export time (§8). There is exactly one implementation of this convention in the repository, not two that could drift.

**How the worker learns `userId`:** the claim response (`app/api/render-executions/claim/route.ts`) now includes `userId: execution.user_id` alongside `executionId` — an opaque UUID the worker already implicitly operates within the scope of for this one claimed execution; not sensitive, not new attack surface.

## 5. MinIO/S3 Client (Task 3)

`infra/render-worker-runtime/minio-upload.mjs` — the only file in the worker package that imports `@aws-sdk/client-s3`. Configuration (`lib/render-execution/minio-client-config.ts: readMinioClientConfig`):

| Env var | Required | Default |
|---|---|---|
| `CONTENT_STUDIO_MINIO_ENDPOINT` | Yes | — (e.g. `http://minio:9000`) |
| `CONTENT_STUDIO_MINIO_BUCKET` | Yes | — (e.g. `content-studio`) |
| `CONTENT_STUDIO_MINIO_ACCESS_KEY` | Yes | — |
| `CONTENT_STUDIO_MINIO_SECRET_KEY` | Yes | — |
| `CONTENT_STUDIO_MINIO_REGION` | No | `us-east-1` |

`forcePathStyle` is fixed `true` (not env-configurable) — required for MinIO's path-style addressing, per the given infrastructure facts. Returns `null` (fail closed) when any required var is absent; the worker never attempts a partially-configured request.

These are a **deliberately separate env-var family** from the main app's own `S3_*` vars (`lib/storage/s3.ts`) — per B0 §10/§12, the worker's MinIO credential is a distinct, narrower, worker-only secret. It is read only inside `minio-client-config.ts`/`minio-upload.mjs`, never by any Vercel-side route, and never sent to the control plane in any request body, log line, or response.

## 6. Least-Privilege Credential Contract (Task 4) — Not Created, Documented Only

No credential was created or requested this phase (no VPS/MinIO access was used or available). The required policy, for the human operator to provision:

**MinIO policy shape (conceptual — exact IAM/policy JSON syntax to be written against the real MinIO admin API by the operator):**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": ["arn:aws:s3:::content-studio/users/*/renders/scratch/*"]
    }
  ]
}
```
- **Required:** `s3:PutObject` on `content-studio/users/*/renders/scratch/*` only.
- **Not required for this phase's actual code path:** `s3:GetObject`/`s3:HeadObject` — the chosen completion-proof strategy (§10) does not perform a read-back, so no read grant is requested. If a future phase adds a verification read, extend the policy narrowly at that time rather than granting it speculatively now.
- **Explicitly NOT granted:** `s3:ListAllMyBuckets`, any bucket-admin/policy-admin action, `s3:DeleteObject` outside the scratch prefix (this worker never deletes remote objects at all — only local `/tmp` files, §11), and no access outside the `users/*/renders/scratch/*` prefix.

This mirrors B0 §12's Option B (worker holds a held, prefix-scoped credential; no presigned-URL model — rejected there because Vercel cannot reach the internal `http://minio:9000` endpoint). No evidence surfaced this phase to revisit that choice.

## 7. Dependency Portability (Task 5 — the Critical Gate)

**The problem, confirmed before writing any upload code:** per `infra/render-worker-runtime/README.md` §2/§9, the worker package ships **no `node_modules` of its own** — `server.mjs` resolves `remotion`/`@remotion/*`/`react`/`react-dom` purely via Node's parent-directory walk-up to the VPS base image's fixed `/app/node_modules`, which the README's own dependency-manifest audit (§9, table) explicitly confirmed does **not** include the AWS SDK ("Does it need the AWS SDK? No."). Adding `@aws-sdk/client-s3` as an ordinary dependency and assuming it would resolve on the VPS the same way `remotion` does would have been exactly the false assumption Task 5 warned against.

**Chosen solution: Option 1 — bundle the coordinator into one self-contained artifact at export time.** `infra/render-worker-runtime/export.mjs` now runs `bundleCoordinator()` after the existing file-copy step: esbuild (`entryPoints: [coordinator.mjs]`, `bundle: true`, `platform: 'node'`) inlines `coordinator.mjs`, `minio-upload.mjs`, `@aws-sdk/client-s3`'s full transitive closure, and the three shared `lib/render-execution/*.ts` helpers (transpiled from TS as part of the same bundle pass — no separate `tsc` step) into a single output file. `platform: 'node'` makes esbuild treat Node's own built-ins (`fs`, `path`, `crypto`, `http`, `https`, `stream`, `zlib`, `buffer`, `events`, `net`, `tls`, `url`, `util`, `assert`, `querystring`, `dns`, `worker_threads`, `perf_hooks`, `string_decoder`, `timers`, `child_process`) as external automatically — those are provided by the Node runtime the VPS already has, not bundled — while every actual npm package is inlined. The output resolves **nothing** beyond Node itself.

**Format: CommonJS (`coordinator.bundle.cjs`), not ESM.** The first bundling attempt used `format: 'esm'` and failed at runtime with `Dynamic require of "buffer" is not supported` — `@smithy/util-buffer-from` (a transitive `@aws-sdk/client-s3` dependency) contains a CJS module that calls a dynamic, variable-argument `require(moduleName)` for a Node builtin, and esbuild's ESM output has no synchronous `require` to hand that through to. Bundling to CommonJS instead gives the output a real `require()` (Node resolves builtins through it natively), which resolved the entire dependency graph. `coordinator.mjs`'s own source uses no top-level `await` or other ESM-only construct, so this is a build-output format change only, not a behavior change.

**A build-time false positive, corrected:** an initial static self-containment checker (regex-scanning the bundle's text for unresolved `require(...)`/`import ... from ...` specifiers) flagged `@aws-sdk/signature-v4-crt`/`@aws-sdk/signature-v4a` as "still referenced." Investigation traced this to `@aws-sdk/signature-v4-multi-region`'s own **error-message string literals** (e.g. `` `...calling [require("@aws-sdk/signature-v4-crt");]` ``, advisory text for a user who explicitly wants optional SigV4A/CRT multi-region signing — a feature this worker never uses) — the regex matched the text pattern inside an unrelated string, not an actual import statement. esbuild's own `build()` call (which throws a real, hard error on a genuinely unresolvable import) had already succeeded with zero errors, proving the graph was in fact fully resolved. The flawed static checker was replaced (§8) with an executable proof instead of a brittle text scan.

## 8. Portable Export Proof (Task 15)

`assertBundleIsSelfContained`'s text-scanning approach was replaced with `smokeTestBundlePortability(outfile)` — a **runtime** proof, not a static one:

1. Runs `node coordinator.bundle.cjs` via `child_process.execFile` with `cwd: os.tmpdir()` (a directory tree with **no** relationship to the repo — proves module resolution cannot depend on any repo `node_modules` reachable by directory walk-up) and `env: { PATH: process.env.PATH }` only (no `CONTENT_STUDIO_*` vars at all).
2. The bundle's own first lines (unchanged from B2) synchronously validate `CONTENT_STUDIO_CONTROL_PLANE_URL`/`CONTENT_STUDIO_RENDER_WORKER_SECRET` and `process.exit(1)` with a specific message **before doing anything else**.
3. The smoke test asserts: exit code `1`, stderr contains exactly `CONTENT_STUDIO_CONTROL_PLANE_URL is required`, and stderr does **not** contain `ERR_MODULE_NOT_FOUND`/`Cannot find module`/`Cannot find package`.

Reaching that specific validation message is only possible if every import in the entire module graph (including the deeply-nested `@smithy/*` packages `@aws-sdk/client-s3` pulls in) already resolved and evaluated successfully — a genuine unresolved import would instead throw Node's own `ERR_MODULE_NOT_FOUND` before any of the script's own code ever runs. This is a stronger proof than static source scanning, which cannot reliably distinguish an actual import from the same text appearing inside an unrelated string literal (§7's disclosed false positive).

**Actual run performed this phase** (local, not VPS):
```
[export] Copied 28 files into .../dist/content-studio
[export] Bundling coordinator.mjs (+ minio-upload.mjs + shared lib/render-execution helpers) with esbuild...
[export] Bundled coordinator.bundle.cjs. Running portable dependency-load smoke test (outside repo, empty env)...
[export] Smoke test passed — coordinator.bundle.cjs loads its full module graph with no repo node_modules reachable.
[export] Done. Copy this directory to /opt/content-studio/render-worker on the VPS.
[export] On the VPS, run: node coordinator.bundle.cjs (NOT coordinator.mjs directly).
```
Bundle size: ~1.4 MB (reasonable for the AWS SDK v3 S3 client + its Smithy runtime closure). `export.mjs` now fails loudly (non-zero exit, the whole export aborts) if either the bundle step or the smoke test fails — this is not a soft warning.

**What this does NOT prove:** a live PutObject call against a real MinIO endpoint (no MinIO server was reachable this phase, per the no-remote-infrastructure constraint) — see §16 for the exact remaining VPS proof.

## 9. Upload Implementation (Task 6)

`uploadRenderOutputToScratch({ userId, executionId, localFilePath })` (`minio-upload.mjs`):
1. `readMinioClientConfig()` — fails closed (`ok: false`) if any required env var is absent.
2. `fs.promises.stat(localFilePath)` — obtains the **actual** byte size from the filesystem (never guessed, never trusted from anywhere else); fails closed if the file is missing or empty.
3. `buildScratchOutputTarget({ userId, executionId })` — the same shared helper as the route (§4); additionally cross-checks the worker's own configured bucket against the expected bucket and fails loudly on a mismatch rather than silently uploading to the wrong place.
4. `PutObjectCommand` via `buildPutObjectParams` (`minio-client-config.ts`) — `Body` is a `fs.createReadStream` (not a fully-buffered read), `ContentType: 'video/mp4'` always, `ContentLength` set from the real stat'd size.
5. Returns `{ ok: true, bucket, key, sizeBytes }` on success, `{ ok: false, error }` (short, sanitized — never a raw AWS SDK stack trace, truncated to 500 chars) on any failure.

No `LibraryFile` row, no `ChannelPieceMedia` row, no publish action — this remains strictly a scratch upload, matching B0 §13's output-authority boundary (unchanged, untouched this phase).

## 10. Output Existence Semantics (Task 7)

**Chosen guarantee: a successful `PutObjectCommand` SDK response is sufficient proof of existence.** No `HeadObjectCommand` verification call was added. Rationale: the AWS SDK's `PutObjectCommand` already throws on any non-success response from the S3-compatible endpoint (network failure, 4xx/5xx, checksum mismatch) — a resolved promise already means the object was accepted by the store. MinIO (unlike eventually-consistent AWS S3 in some historical regions) is strongly consistent for a single-node/single-cluster deployment such as this one, so there is no read-after-write ambiguity a HEAD call would meaningfully close. Adding one would be a second network round-trip with no additional trustworthy signal beyond what the PUT response already guarantees — exactly the "do not add a verification request merely ceremonially" instruction this task gave. If a future phase's evidence shows otherwise (e.g. a multi-node MinIO deployment with weaker consistency guarantees), this decision should be revisited then, not preemptively.

## 11. Complete API Hardening (Task 8)

Covered in full in §3. Summary of the enforced invariants (all tested, `complete-route-output-authority.test.ts` + `scratch-output-target.test.ts`):
- Transition remains `claimed → completed` only (unchanged from B2, `INVALID_STATUS_TRANSITION` otherwise).
- Missing required output fields → `400` (unchanged from B2: `MISSING_OUTPUT_BUCKET`/`MISSING_OUTPUT_STORAGE_PATH`/`MISSING_OUTPUT_SIZE`/`MISSING_OUTPUT_DURATION`).
- Generic malformed-locator sanity checks remain (`..`, leading `/`, bucket containing `.`) — `INVALID_OUTPUT_LOCATOR`.
- **New this phase:** exact-match against the execution's own server-derived target — anything else → `400 OUTPUT_TARGET_MISMATCH`, checked and rejected **before** the DB write, using `execution.user_id` (loaded from the row, never the request body) and `execution.id` (the route's own path param, never client-suppliable).

## 12. Upload Failure Behavior (Task 9)

Render succeeds, upload fails → the row must never become `completed`. `coordinator.mjs`'s `runOneCycle()`:
```
uploadOutcome = await uploadRenderOutputToScratch(...)
if (shouldReportFailAfterUploadFailure(uploadOutcome)) {
  await reportFail(executionId, 'OUTPUT_UPLOAD_FAILED', uploadOutcome.error, undefined)
  if (shouldDeleteLocalFileAfterUploadFailure()) await deleteLocalFile(...)
  return 'failed'
}
```
`OUTPUT_UPLOAD_FAILED` is a new, bounded `error_code` consistent with B0 §14's taxonomy shape (short, stable, product-facing classification — B0 §14 itself lists `upload_failed` as an anticipated code for exactly this case, marked retryable). `uploadOutcome.error` is already sanitized/truncated at the source (`minio-upload.mjs`, ≤500 chars, never a raw AWS SDK stack trace) before it ever reaches the `/fail` request body. `shouldCallComplete`/`shouldReportFailAfterUploadFailure` (`worker-lifecycle.ts`) make this an explicit, tested either/or — there is no code path where both could fire, and no code path where neither fires for a render that succeeded.

## 13. Complete-Call Retry After a Successful Upload (Task 10)

The important case: `PutObject` succeeds, but the `/complete` HTTP call itself fails transiently (network blip, control-plane 5xx). `reportCompleteWithRetry` (`coordinator.mjs`) retries **the same HTTP call, against the same deterministic key** — never a new render, never a new upload:

- Up to `MAX_COMPLETE_RETRY_ATTEMPTS = 5` attempts (`worker-lifecycle.ts`), exponential backoff (`completeRetryDelayMs`: 2s, 4s, 8s, 16s, capped at 30s).
- Only a **transient** failure (network error, or HTTP ≥500) is retried (`isRetryableCompleteFailure`) — a non-transient 4xx (e.g. the row is no longer `claimed`, or `OUTPUT_TARGET_MISMATCH`, which would indicate a real bug rather than a transient condition) stops immediately, since retrying it can never succeed.
- This is deliberately **not** a general durable queue — it is a small, capped, in-process retry for the one HTTP call left after a successful upload, per the task's own explicit scope limit.

**Residual failure (documented, not silently accepted):** if all 5 attempts are exhausted (or a non-retryable failure occurs) while the object is already durably uploaded to MinIO, the row never reaches `completed` — the object becomes an **orphan** in the scratch prefix (no execution row references it as `output_*`). This is the smallest-scope acceptable outcome for this phase: the alternative (a general durable retry queue surviving process restarts) was explicitly out of scope. The existing scratch-retention policy already anticipated in B0 §19 (a future fixed-window cleanup sweep) is the intended eventual reclaimer for this class of orphan, not something this phase needed to build.

## 14. Retry / Idempotency (Task 11)

Already structurally guaranteed by §4's deterministic key: a **technical** retry (same execution reclaimed after a lease expiry, or the same execution's complete call retried per §13) always targets the same key — safe to overwrite. A **user-initiated** retry (B0 §4.2) always creates a **new** `render_executions` row with its own UUID, and therefore always computes a different key via the same `buildScratchOutputKey` — no cross-execution overwrite is structurally possible. No content-hash deduplication was added (explicitly out of scope) — "technical retry" and "new user render" are kept exactly as distinct as B0 §4 already established, unmodified this phase.

## 15. Local File Cleanup (Task 12)

Encoded as pure, individually tested decisions in `worker-lifecycle.ts`, wired by `coordinator.mjs`:

| Path | Behavior | Function |
|---|---|---|
| Full success (upload + complete) | Delete local file | `shouldDeleteLocalFileAfterSuccess` |
| Upload failure | Delete local file immediately (nothing left to upload — a retry means a fresh render, not a re-upload of the same bytes) | `shouldDeleteLocalFileAfterUploadFailure` |
| Upload succeeded, complete retries exhausted | Delete local file (the object is already durably in MinIO — see §13's documented orphan — the local copy has no further purpose and would otherwise accumulate unboundedly in `/tmp`) | `shouldDeleteLocalFileAfterCompleteRetriesExhausted` |
| Upload succeeded, complete retry still pending (mid-loop, not yet exhausted) | **Not** deleted — `reportCompleteWithRetry` keeps retrying entirely within a single `runOneCycle()` call (no separate "pending" state persists across cycles), so the local file simply is not touched until that call returns either success or exhaustion | (implicit — no premature `deleteLocalFile` call exists in the retry loop itself) |

Local `/tmp` growth stays bounded in every terminal outcome (success, upload failure, or complete-retry exhaustion) — the only window where the file is kept is the few seconds a single complete-retry sequence is actively running, never indefinitely.

## 16. Continuous Loop Activation (Task 13)

B2 deliberately kept `CONTENT_STUDIO_RENDER_LOOP=1` gated with a runtime warning ("do not use until B3"). That warning block has been removed this phase — `CONTENT_STUDIO_RENDER_LOOP=1` is now a fully supported, real continuous-polling mode, because the full `render → upload → complete` lifecycle is now truthfully wired end-to-end. Unchanged: exactly one execution claimed and processed at a time (`runOneCycle()` is `await`ed fully — render, upload, and complete/retry all finish — before the next `claimExecution()` call); no worker pool; no parallel render. Normal no-work polling remains a single cheap `POST /claim` call per interval (default 8s, unchanged from B2), inexpensive regardless of loop mode.

## 17. Tests (Task 14)

51 new focused tests across 5 files, all passing:

| File | Coverage |
|---|---|
| `scratch-output-target.test.ts` | Deterministic key generation; same-execution-same-key; new-execution-different-key; cross-user non-collision; path-traversal/non-UUID rejection; bucket env-override precedence; full target build + exact-match accept/reject (arbitrary bucket, cross-user, cross-execution, path-traversal-mutated key); malformed input never throws. |
| `minio-client-config.test.ts` | Env validation (each required var's absence → `null`); full config shape; `forcePathStyle` always `true`; region default/override; `buildPutObjectParams` always sets `video/mp4`, uses the real passed-in byte size, passes bucket/key/body through unchanged. |
| `worker-lifecycle.test.ts` | Upload success permits complete / upload failure never permits complete; bounded retry attempt ceiling and exponential-capped backoff; transient-vs-non-transient retry eligibility; local-file cleanup timing for all three terminal paths (§15). |
| `worker-secret-not-logged.test.ts` | Static word-boundary scan of `coordinator.mjs`/`minio-upload.mjs`: no `console.log/warn/error` call references the raw secret-VALUE identifiers (`WORKER_SECRET`, `secretAccessKey`, `accessKeyId`) — deliberately distinguishes the safe env-VAR-NAME text (which legitimately appears in "not configured" messages) from the actual value-holding variables. |
| `complete-route-output-authority.test.ts` | Confirms the real route source imports the real shared helper (not a re-implementation), calls it before the DB write, rejects with `400 OUTPUT_TARGET_MISMATCH`, and derives the check from `execution.user_id` (DB-sourced) rather than the request body. |

**Why route-level tests are wiring proofs, not full integration tests:** consistent with the existing B2 convention (`worker-coordination-contracts.test.ts`), the `/complete` route's early steps require a live Supabase round-trip before reaching the output-target check — no test in this repository stands up a live DB. The underlying decision logic (`isExpectedScratchOutputTarget`) is exhaustively tested directly and for real (not re-implemented) in `scratch-output-target.test.ts`; `complete-route-output-authority.test.ts` closes the remaining gap by proving the route actually imports and calls that exact function, in the right order, from the right source values.

All MinIO/S3 interaction is mocked or avoided entirely in unit tests (`minio-upload.mjs`'s actual `S3Client`/`PutObjectCommand` calls are never exercised by vitest — only the pure config/param-shaping functions it delegates to are). No live MinIO server was required or used.

## 18. Manual VPS Deployment Steps (Task 16 — Prepared, Not Executed)

**Nothing in this list was performed this phase.** Zero VPS/Portainer/Swarm/MinIO-admin access was used, per the explicit constraint.

1. **Provision the MinIO credential** (operator, out of band): create a least-privilege MinIO access key scoped to `content-studio/users/*/renders/scratch/*` with `s3:PutObject` only (§6's policy shape) — exact policy JSON syntax depends on the real MinIO version/admin surface, to be finalized by the operator against the live cluster.
2. **Regenerate and export the worker payload** (repo, already runnable): `node infra/render-worker-runtime/generate-fixture.mjs && node infra/render-worker-runtime/export.mjs` — produces `infra/render-worker-runtime/dist/content-studio/`, including the bundled `coordinator.bundle.cjs` (§7/§8).
3. **Copy the exported directory** to `/opt/content-studio/render-worker` on the VPS host (bind-mounted into the existing container at `/app/content-studio`, unchanged from Phase 2I-A1).
4. **Set the worker container's environment**, in addition to the existing B2 vars (`CONTENT_STUDIO_CONTROL_PLANE_URL`, `CONTENT_STUDIO_RENDER_WORKER_SECRET`, optionally `CONTENT_STUDIO_RENDER_WORKER_ID`/`CONTENT_STUDIO_RENDER_POLL_INTERVAL_MS`):
   ```
   CONTENT_STUDIO_MINIO_ENDPOINT=http://minio:9000
   CONTENT_STUDIO_MINIO_BUCKET=content-studio
   CONTENT_STUDIO_MINIO_ACCESS_KEY=<from step 1>
   CONTENT_STUDIO_MINIO_SECRET_KEY=<from step 1>
   ```
5. **Set the Vercel-side env** (already required since B2, unchanged): `CONTENT_STUDIO_RENDER_WORKER_SECRET` (same value as step 4's worker secret — distinct from the MinIO credential).
6. **Start `server.mjs`** (unchanged, Phase 2I-A1) — `node server.mjs` from within the bind-mounted directory.
7. **Run the coordinator** — `node coordinator.bundle.cjs` (NOT `coordinator.mjs`/`coordinator.source.mjs` — those are unbundled reference copies only and will fail to resolve `@aws-sdk/client-s3` on the VPS). Start with `CONTENT_STUDIO_RENDER_LOOP` unset (proof-only, one execution) for the first real VPS run; set `CONTENT_STUDIO_RENDER_LOOP=1` only after confirming a real end-to-end success (step 8).
8. **Trigger one real execution** (e.g. via `POST /api/video-drafts/:id/render` against a real `VideoDraft`, from B1) and observe: claim → render → upload log line (`Uploaded: <bucket>/<key> (<bytes> bytes)`) → completion log line → the `render_executions` row transitioning to `status = 'completed'` with real `output_*` columns populated. Independently confirm the object exists in MinIO (via `mc ls`/the MinIO console) at the exact logged key.
9. Only after step 8 succeeds, consider enabling `CONTENT_STUDIO_RENDER_LOOP=1` for continuous operation (Task 13).

## 19. Exact Real-Infrastructure Proof Still Required

This phase's local proof is: the bundle builds, its full module graph loads successfully outside the repo with an empty environment (§8), and all decision logic is unit-tested. **Not proven locally, and requiring the real VPS** (§18's steps):
- A real `PutObjectCommand` against the live MinIO endpoint actually succeeds over the `content-studio-backplane` network from inside the worker container.
- The provisioned least-privilege credential's actual scope, once created by the operator, matches §6's intended policy (no broader, no narrower than needed).
- End-to-end: a real `VideoDraft` render reaches `status = 'completed'` with a real, independently-verifiable MinIO object at the logged key.
- Confirmation that `4.0.448` (VPS base image's actual Remotion version, per README.md §3's already-disclosed open item, unrelated to this phase but still unresolved) does not affect the render step this lifecycle depends on.
- A live crash-recovery/lease-reclaim proof (kill the worker mid-upload or mid-complete-retry, confirm the next poll cycle reclaims correctly) — this remains 2I-B4's explicit scope, not this phase's.

## 20. Verdict

**`READY_FOR_VPS_OUTPUT_PERSISTENCE_PROOF`**

Every task this phase's scope requires is implemented and validated locally: a hardened, exact-match output-target authority on `/complete` (closing a real permissiveness gap found during audit); a single, shared, deterministic scratch-key convention used identically by both the Control Plane and the worker; a worker-side MinIO upload client with sanitized, bounded error reporting; a truthful `render → upload → complete` lifecycle with no path by which a local-only or upload-failed render can reach `completed`; a bounded, transient-only complete-retry with documented residual-orphan behavior; deterministic local-file cleanup that never grows `/tmp` unboundedly; and — the phase's hardest gate — a proven-portable worker dependency-packaging solution (esbuild bundling to CommonJS, verified by an executable, not merely static, dependency-load smoke test run entirely outside the repository tree). Nothing MinIO-administrative, VPS-administrative, or UI-facing was touched, matching this phase's explicit scope boundary. The next required step is real-infrastructure proof on the actual VPS (§18/§19) — 2I-B4 (crash-recovery proof) and 2I-C (product UI) remain correctly unblocked but un-started.
