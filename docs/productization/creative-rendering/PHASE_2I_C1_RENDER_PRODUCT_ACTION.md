# Phase 2I-C1 — Video Render Product Action & Inline Result UX

**Nature:** Bounded product integration + C2 planning. Implements the UI action slice over the proven execution backend. No new backend state, no database mutation. Factual Gallery integration audit. 

## 1. Image-Generation UX Precedent
The UI of `/imagens` demonstrates a consistent UX pattern for content generation:
- The result is positioned INLINE with the authoring state.
- During generation, the area displays a `Loader2` communicating server processing without fake progress loops.
- Terminal statuses trigger transient toasts + persistent state in the inline viewer.
- Reloading the page recovers the current draft and its active generation state if applicable.
This identical approach is adopted for Video rendering to preserve cognitive parity across the workspace.

## 2. Gerar Vídeo Integration
The naive timeout implementation has been removed. 
- The `Gerar Vídeo` action formally targets `POST /api/video-drafts/[id]/render` using standard browser `fetch`.
- Draft authentication, project/production validations, and identity generation all continue strictly decoupled from client inputs (only `draft.id` dictates context).

## 3. Idempotency & Polling behavior
- **Idempotency:** Replaced double-click races using a React-bound UUID `renderIdempotencyKey`. It's provided once at mount and explicitly reset on intentional restarts ("Gerar Novamente").
- **Polling:** Native React `useEffect` + `setTimeout` loop, checking `GET /api/render-executions/[id]` every 3 seconds. It strictly drops out and terminates intervals the moment `status` transitions to `completed` or `failed`.
- **Toast Logic:** A `useRef(false)` orchestrates single-emission behavior for toast drops ("Vídeo renderizado" / "falha"), neutralizing duplicate notifications across arbitrary navigation updates.

## 4. Inline Result Placement & Context States
The result frame acts immediately below the Video setting controls and directly above Draft scenes. 

State map:
- `queued`/`claimed`: "Renderizando..." label, pulsing UI elements + `Loader2`.
- `completed`: "Concluído" label + green UI. Explanatory placeholder advising output preview logic (C2) resides momentarily here.
- `failed`: "Falhou" + red presentation + backend's safe `error_message` payload display. Re-enables the primary button targeting retry.

## 5. Reload Recovery
Users navigating away or refreshing manually recover execution statuses trivially. 
- Integrated lightweight fetch to `GET /api/render-executions?videoDraftId=[draftId]` limited to bounds of 1 per draft.
- Poller detects active statuses transparently initializing the `useEffect` background fetch pipeline if resuming on `queued`/`claimed`.

## 6. Storyboard Boundary
The Storyboard interface relies structurally on the raw `VideoScene[]` schema mapping. Rendering context (such as terminal state, loading) is entirely fenced out of the modal. Render executions act as standalone outputs per draft, ensuring authoring and terminal playback remain separated.

## 7. C2 Inline Video Integration Plan
Inside the newly-minted `"completed"` branch of the result component block, C2 outputs will seamlessly embed through an HTML5 `<video controls src={signedUrl}>`. Minimal modals might remain accessible for enlarged visualization, but the primary playback contract stays exactly where the current placeholder exists.

## 8. Gallery Factual Data Source & C2 Recommendation
**Audit Observations:**
- The actual Gallery (`lib/gallery-output-library.ts` / `/galeria/page.tsx`) computes unified "Outputs" directly off Supabase's `Image` table joined functionally with drafts and generic components via `project_id`.
- Categories depend fundamentally upon `status` flags mapped loosely to `{ generated, approved, rejected }`.
**C2 Integration Strategy:**
Do NOT enforce mandatory ingestion of video scratch files into canonical asset libraries (e.g. `library_files`). Integrating Render Executions with the Gallery implies a unified read operation pulling terminal executions (`status=completed`), translating metadata directly to `GalleryOutputItem` schema shapes. Videos will adopt an underlying missing-thumbnail UI placeholder until explicit snapshot generation functionality guarantees poster frames.

## 9. PNG/Static Non-Regression
Static architectural topologies (`StaticRenderManifest` / Next.js API renders via `dev/creative-preview`) stay preserved inherently. They bypass the `render_executions` worker entirely. The introduced UI components act inside `/videos` bounded namespaces.

## 10. Exit Criteria Verification (Testing & Validation)
- Replaced mock rendering with a functional polling interface inside the React component hierarchy.
- Introduced strict regex-based state-machine assertions inside `video-render-ux-wiring.test.ts`. 
- Verified 720 tests executing positively against current state definitions securely validating 2I-C1 boundaries without backend mutations.
