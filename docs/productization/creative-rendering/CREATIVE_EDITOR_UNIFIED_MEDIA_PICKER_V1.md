# CREATIVE_EDITOR_UNIFIED_MEDIA_PICKER_V1

The Static Editor now natively connects to `I2vSourceBrowser` (repurposed and exposed via `UnifiedMediaPickerDialog`) to adopt the improved Media Selection UI previously designed exclusively for AI Video generation. This directly resolves the overly flat media picker by categorizing inputs into *Galeria, Biblioteca (Arquivos), Upload (Enviar) e Geradas por IA*.

## Provenance
| | |
|---|---|
| Baseline (previous mission) | `CREATIVE_EDITOR_CONTEXTUAL_STYLES_AND_TYPOGRAPHY_V1` |
| Branch | `feat/creative-editor-unified-media-picker-v1` |
| `origin/main` at takeover | `7f00b9aa4bf3f1d6b33acfc7f8f51e604581dc0b` |

## Safe Architecture Adoption (Static Editor Implementation)
The core constraints instructed NOT to redesign or overwrite the Media Picking hierarchy, ensuring we reused 100% of the underlying components structured for Video, effectively uniting both mediums correctly under a standard presentation model without regressing video UI or introducing duplicate file pickers.

- **UnifiedMediaPickerDialog:** This component abstracts the core `<I2vSourceBrowser />` into an embeddable Dialog widget used by Static Editor entries `ProjectLibraryAssetPicker` explicitly replaces.
- **Component Interface Mapping & Strict Payload Matching:** `I2vSourceBrowser` generates arbitrary `I2vSourceSelection` objects featuring heterogeneous payload outputs (`source: { type: 'generated' }` vs `{ type: 'library' }`). `UnifiedMediaPickerDialog` encapsulates filtering and type-resolution and delegates valid strictly-mapped `SlotLibraryFile` responses payload so `projectImages` mapping logic operates without arbitrary `as any` casting or partial hacks.
- **On-Demand Dynamic Promotion for AI Images (`save-to-library`):** "Generated Images" do not qualify natively as durable assets in the Static composition. If a user identifies an "AI Image", the `UnifiedMediaPickerDialog` immediately traps the action, triggers a `Loader` visually, invokes `POST /api/images/:id/save-to-library`. Natively, the backend safeguards ID idempotency returning `200 OK` (duplication-proof) assigning it a full `libraryFile`, which is mapped downstream seamlessly.

## Context Validation 
1. **Arquivos / Galeria / Enviar (Library Source)**: Extracts properties seamlessly without extra network requests directly through `supabase.from('library_files').select('id, name, public_url, thumbnail_url, mime_type, origin').eq('id', selection.source.id).eq('project_id', projectId).eq('kind', 'image').is('deleted_at', null).single()` fulfilling immediately `projectImages`.
2. **Geradas por IA (Generated Source)**: Promoted autonomously via `POST /api/images/:id/save-to-library`, successfully utilizing the returned `libraryFile`.
3. **Immutability & Video Regression Protection**: `I2vSourceBrowser` remained exactly the same for Video instances. Shared templates such as `free-scene-panels.tsx` ("Imagem da Biblioteca" VS "Imagem") gained contextualized properties `addImageLabel?: string` defaulting securely back to Video needs. Both testing scopes passed fully transparently.

## Expected Impacts
* **MIGRATION:** NONE
* **RENDERER IMPACT:** NONE
* **WORKER IMPACT:** NONE

All files remain isolated contextually within standard editing views with no modifications touching static configurations or container manifests requiring deployment synchronization.

**IMPLEMENTATION COMPLETE**