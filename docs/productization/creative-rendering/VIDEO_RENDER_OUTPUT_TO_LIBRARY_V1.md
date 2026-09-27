# VIDEO_RENDER_OUTPUT_TO_LIBRARY_V1

## Checkpoints

*   **Starting Product Checkpoint:** `e822c0bc38ce96d4792b9dbe7d4e9a162ec6388c`
*   **Implementation Checkpoint:** `6a7ee3f1e7ab024b2a90a75d785cdeed9a1c21ca`
*   **Final Mission Checkpoint:** `6a7ee3f1e7ab024b2a90a75d785cdeed9a1c21ca` (no further changes required during production proof)

## Phase 0 Factual Architecture & Storage Findings

*   **RenderExecution Storage Semantics:** Video output rendering drops an MP4 in the `content-studio/users/{userId}/library/` object storage namespace, but its record lives solely in the `render_executions` table (`output_url`). It operates as a materialization record, distinct from a durable Library asset.
*   **Scratch vs Durable Conclusion:** Since the render output object is already stored persistently in the S3-compatible backend (not in a temporary/TTL scratch bucket), the "copy to Library" process securely references this identical output path. There was no need to bodily move or duplicate the bytes to achieve a "durable save"; we simply created the declarative durability record (`LibraryFile`).
*   **LibraryFile Authority and Provenance:** The `LibraryFile` is the authoritative source for durable project media. When saving a video render, the file leverages `origin = 'studio_render'` and is tightly linked via the `source_render_execution_id` foreign-relation. This cleanly inherits its identity exactly back to the source execution without introducing new generic tables (like a `VideoAsset` or `VideoOutput`).

## Semantics & Behavior 

*   **Endpoint Authorization:** Implemented cleanly in the server route `/api/render-executions/[id]/save-to-library`. Project verification, ownership, and user validation exist as server-first safeguards against arbitrary path submissions from the client.
*   **Eligibility Rules:** The backend specifically restricts durability to a strictly `completed` render state with an existing output URL. Invalid states (queued, failed) and lack-of-ownership naturally enforce rejection.
*   **Idempotency Semantics:** If `save-to-library` is repeatedly invoked, the database checks for an existing `LibraryFile` pointing to the equivalent `source_render_execution_id`. The client endpoint returns `result: already_saved` rather than forging a duplicate record.
*   **Arquivos Origin/Filter Discovery:** Discovered that Arquivos historically filtered files entirely to `origin='upload'`. This was corrected with a narrowly bounded filter to also allow `origin='studio_render'` elements of `kind='video'`, ensuring that Static PNG workspace exports didn't immediately flood the generalized file view.
*   **Gallery Behavior and Duplicate Avoidance:** The Gallery logic remains undisturbed. Render histories persist independently bounded to `render_executions`. Since Studio static outputs are filtered independently in the Gallery, durably saving the MP4 prevents identical indistinguishable cards from leaking into the same view feed.
*   **ChannelPiece Boundary:** No `ChannelPieceMedia` creation or implicit binding occurs during durability checks. M4 rigidly asserts output -> durable library transition ONLY.
*   **Approval/Publication Boundary:** Zero state shifts impact `ChannelPiece` publication flows. Durability != approval.
*   **Authoring-State Non-Mutation:** Creating a durable LibraryFile introduces no side-effect mutations, dirtiness, or canvas invalidations to `VideoDraft` / `VideoScene`.

## Migration & Worker Impact

*   **Migration:** NONE. Existing provenance and column fields adequately supported the operation.
*   **Worker:** UNCHANGED. The core architectural boundary (rendering to target store vs durable representation mapping) was preserved without tweaking python/lambda runner dependencies.

## Production & Responsive Proof

*   **Proof:** Successfully verified directly in `content.multihuman.com.br` accessing via Supabase fetch & app sessions. 
*   **Original Render Execution Identity:** `db4f91e4-03e5-4fec-a0f7-44a858a0bbb6`
*   **Resulting LibraryFile Identity:** `00b198f9-1cbc-4048-95ca-41013a84dbd7`
*   **Responsive Proof:** The new output-action dialog scales appropriately without triggering horizontal overflows or clipping key buttons at 1440px, 1024px, 768px, and 390px.
*   **Validation Totals:**
    *   104 files / 1454 tests PASS
    *   0 lint errors / 42 existing warnings
    *   Typecheck & Build PASS
*   **Limitations / Deferred hardening:** Duplicate save relies on `source_render_execution_id` queries for idempotency, which covers standard usage but doesn't have a strict multi-request DB unique constraint. Given normal flow, it safely serves its purpose without needing an immediate migration step.

<br/>

`VIDEO_RENDER_OUTPUT_TO_LIBRARY_V1_COMPLETE`
