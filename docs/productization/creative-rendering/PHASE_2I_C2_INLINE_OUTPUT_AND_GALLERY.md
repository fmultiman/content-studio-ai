# Phase 2I-C2 — Inline Output Access & Gallery

**Nature:** Bounded product integration. Closes the Render Execution productization track enabling inline MP4 playback and asset discoverability securely without permanent buckets/links.

## 1. Secure Output URL Contract
Instead of persisting generic readable urls that mandate bucket access, C2 ships `GET /api/render-executions/[id]/output-url`:
- Validates Supabase authentication and execution ownership.
- Extracts `output_storage_path` strictly verified to match `users/{userId}/renders/scratch/{executionId}/` ensuring cross-tenant boundaries.
- Adopts `createPresignedReadUrl` generating 1hr signed URLs utilizing native `S3_` Vercel runtime creds. 
- Fully obfuscates bucket location and internals from clients.

## 2. Inline Player UX & Signed URL Lifecycle
- Transformed the static UI placeholder in `/videos` to a `<video src={renderOutputUrl} playsInline controls />` element dynamically. 
- Lifecycle: The React `useEffect` poller issues the url request **once** upon transitioning to `status: 'completed'`. Page reloads trigger this fetch similarly rendering the latest state securely upon visiting active drafts.
- No mandatory modals mask the viewing experience natively. 

## 3. Download Decision
Supported seamlessly out of the box via routing parametrization formatting:
- Query `?disposition=attachment` generates AWS signatures commanding browser-directed attachment disposition, mapped securely to `window.location.href` bypassing expensive in-memory Blob operations via Javascript. 

## 4. Gallery Normalization Strategy
Instead of cloning objects into canonical `library_files` and triggering heavy persistence, Gallery natively maps inputs:
- Exposes `render_executions` with `status=completed` functionally.  
- Appends into `buildGalleryOutputs` producing matching generic shapes `GalleryOutputItem` utilizing typescript discriminations cleanly (`mediaType: 'video' | 'image'`). 

## 5. Generated vs Approved Rule
- Video outputs populate strictly the **"Outputs gerados"** (Recent) lists.
- They bypass **"Aprovadas"** intrinsically protecting invariant definitions where scratch videos remain distinctly non-canonical previews unless deliberately escalated using standard post-render workflows. 

## 6. Video Card Behavior
- Visually distinguished implicitly utilizing `<Video>` lucid-react iconography masking thumbnail blanks. 
- Dialog actions feature full `<video>` injection preventing unneeded bandwidth streams while supporting rich popup interactions identically to single-page image behaviors safely. 

## 7. Storyboard Boundary
Left unmodified structurally resolving scene timelines securely isolated from generation mechanics reliably preventing execution bleeding into domain models.

## 8. PNG Non-Regression Smoke
Tested image mechanisms proving paths `/api/creative/static-authoring/` intact without execution overlap or Next.js route interception faults effectively retaining isolated topologies flawlessly. 

## Final Exit Condition Met
With playable UI surfaces shipped securely mirroring scratch pipelines and cross-surface discoverability (Gallery) handled gracefully via server query unionism (without DB duplication), rendering UI tracks complete functionally. Next pipeline initiates Creative Templates. 
