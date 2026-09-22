# Phase 2I-C0 — Product Render Action & Output Access Audit

**Nature:** Read-only product integration audit. No UI implementation, no API routes added, no database changes in this mission. Assesses the surface area for the thinnest integration of the proven execution backend into Content Studio.

## 1. Current \/videos\ Flow

- **Access/Creation:** Users access \/videos\, select a Project and Production, and hit "Novo Vídeo," or select from recent drafts via URL parameter \?draft=[id]\.
- **Existing Actions:** 
  - "Salvar Rascunho" (Save Draft) patches the \ideo_drafts\ table successfully.
  - "Gerar Vídeo" (Generate Video) currently exists as a stub/mock. It calls \handleGenerateVideo\, which sets an \isGenerating\ loading state, awaits a 3000ms dummy timeout, and fires a toast.
- **Draft Data:** The draft context (scenes, \currentDraftId\, \productionId\, \projectId\) is fully available in React state, making it ideal for the \POST\ request.
- **Integration Target:** The existing "Gerar Vídeo" \Button\ inside the settings card is the natural injection point for the real action. 

## 2. Current Render API Contract

**POST \/api/video-drafts/[id]/render\ (Create)**
- **Body:** \{ idempotencyKey?: string }\
- **Behavior:** Validates draft, ownership, project identity, and scene bindings. Creates an immutable \input_snapshot\. Never parses arbitrary input files from the browser.
- **Response:** \{ executionId, status: 'queued', queuedAt, reused: boolean }\ at 201 Created.

**GET \/api/render-executions/[id]\ (Status)**
- **Behavior:** Ensures ownership, strictly filters sensitive columns.
- **Response:** Safe projection (\id\, \ideo_draft_id\, \status\, \ttempt\, \queued_at\, \claimed_at\, \completed_at\, \ailed_at\, \output_mime_type\, \output_size_bytes\, \output_duration_ms\, \error_code\, \error_message\).
- **Verdict:** Fully adequate and secure for client-side status polling. 

## 3. Product Status Mapping

The frontend requires minimal UX states derived directly from backend transitions:

| Backend Status (\ender_executions\) | Product UX Language | Button State | Display |
|---|---|---|---|
| \
ull\ (not requested) | — | "Gerar Vídeo" | Default |
| \queued\ / \claimed\ | "Renderizando" | Disabled + Spinner | "Em processamento" / In-flight status |
| \completed\ | "Concluído" | "Renderizar Novamente" | Show Video Preview / Download |
| \ailed\ | "Falhou" | "Tentar Novamente" | Show safe \error_message\ if exists. |

Do not invent further statuses. These map linearly.

## 4. Polling Strategy

- **Audit Findings:** The repo uses standard \etch()\ combined with \useEffect\ state and does not utilize \SWR\ or \@tanstack/react-query\. 
- **Implementation:** React state-driven loop. Upon getting an \executionId\ from \POST\, a \useEffect\ invokes \GET /api/render-executions/[id]\ every 2000-3000ms until the status is \completed\ or \ailed\.
- No WebSockets, Redis, or SSE required. 

## 5. Output Access Gap & Audit

- **Current State:** Successful worker uploads land cleanly in \content-studio:users/{userId}/renders/scratch/{executionId}/output.mp4\ via restrictive \CONTENT_STUDIO_MINIO_*\ credentials (VPS-only, no GetObject/ListBucket).
- **The Gap:** The Vercel app configures its own \S3_*\ server-side client (\lib/storage/s3.ts\), and exports a helper: \createPresignedReadUrl\. However, current proxy endpoints in the repository (e.g. \pi/storage/sign-image-path\) are strictly fenced to \images/\ prefixes. **There is NO existing route granting the browser short-lived viewing capability to the \enders/scratch/\ prefix.**
- The browser must not be granted direct S3/MinIO permissions, nor should the buckets be public.

## 6. Minimal Secure Output-Access Design

**Proposed minimal addition (No permanent frontend credentials):**
- Create **\GET /api/render-executions/[id]/output-url\**
  1. Authenticates Supabase user.
  2. Queries \ender_executions\ by ID + user's ownership.
  3. Checks \status === 'completed'\ && \output_storage_path\ is populated.
  4. Calls the existing \createPresignedReadUrl(execution.output_storage_path, { disposition: 'inline', filename: 'preview.mp4' })\.
  5. Returns \{ url }\ valid for 1 hour.
- **Why this works:** Reuses robust, internal AWS SDK presigner. Does not incur Vercel edge/lambda bandwidth streaming costs. Maintains zero public bucket footprint.

## 7. Scratch vs Approved Invariant

- A \completed\ render output remains temporary "scratch". It is **NOT** automatically ingested into \library_files\ nor mapped as a globally approved Project asset.
- **UI Label:** It must be displayed strictly as "Último render" or "Prévia renderizada" to demarcate that this is an iteration, not the final approved content architecture.

## 8. Idempotency & Re-render UX

- **First render:** The UI generates a random \crypto.randomUUID()\ \idempotencyKey\ string and POSTs it.
- **Double click:** The same UUID is inherently passed. The backend \UNIQUE\ idempotency constraint intercepts and deduplicates this cleanly (Task 2I-B1).
- **Re-render / Retry (Completed or Failed):** Clicking "Gerar Vídeo" again intentionally resets React state, generates a **NEW** UUID, and submits. This inherently produces a brand new execution row (as per backend contract).

## 9. History Scope

- **Requirement:** 2I-C needs **only the current/latest execution** for the active session. Avoid building a full execution history timeline UI in Content Studio just to watch statuses.
- **Hard Reload Fallback:** If the browser refreshes, React volatile state dies. To restore UX seamlessly upon draft revisit, we apply the thinnest approach: 
  - Add a trivial query endpoint \GET /api/render-executions?videoDraftId=[id]&limit=1\ (returns the recentmost safe projection). 
  - On page-load, if a draft exists, check for its active unfailed/uncompleted render. 

## 10. Failure UX

UI displays: "A renderização falhou. Tentar novamente."
- Exclude all internal traces. 
- Map safe backend values exclusively: \error_message\, or generic mapping of \error_code\ (e.g., \RENDER_FAILED\, \OUTPUT_UPLOAD_FAILED\).
- Reset the button state back to active ("Tentar Novamente"), discarding any lingering "Em andamento" loaders.

## 11. Static PNG Non-Regression

- **Protected Path:** Static rendering operates strictly through \/imagens\ \StaticRenderManifest\ and \/api/creative/static-authoring/render\. It does not rely on \ender_executions\ or the async Remotion worker.
- **Verdict:** Integrating the video route causes zero interference to the static topology. A trivial PNG smoke check (create image draft, request render) should just be executed post-C2 to certify zero collisions via Next.js routing overlaps or shared helper impacts.

## 12. Splitting 2I-C

Slicing into two distinct implementation chunks to avoid roadmap creep:

- **2I-C1: Render Action & Polling**
  - Implement \GET /api/render-executions\ (list/limit 1) to support UI reload.
  - Wire \/videos\ POST + setInterval polling + simple status states (Em processamento, Falhou, Concluído).
- **2I-C2: Output Preview/Access**
  - Implement \GET /api/render-executions/[id]/output-url\.
  - Introduce an embedded HTML5 \<video controls>\ or a clear download/preview button referencing the signed URL on the frontend upon \status === 'completed'\.

## 13. Return-to-Templates Gate

**Explicit Exit Condition:**
Once the authenticated product worker can:
1. Click to trigger a render.
2. Watch the status transition automatically.
3. Access/play the securely signed \completed\ MP4 inside the UI.
4. Hit "Try again" safely if a failure occurs...

...Execution backend productization is formally **CLOSED**.
Next milestone: \RETURN_TO_CREATIVE_WORKSPACE_TEMPLATES\. 
Zero further backend infra additions permitted without product factuality.
