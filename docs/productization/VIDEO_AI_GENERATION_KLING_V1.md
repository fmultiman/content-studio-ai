# VIDEO_AI_GENERATION_KLING_V1

## Phase 0: Reconnaissance & Plan

### Current factual findings
1. **Migrations**: Latest migration is `038_static_authoring_free_composition.sql`. The next available is `039_create_video_generations.sql`.
2. **Schema**: 
   - `projects` and `productions` own the lifecycle context.
   - `images` identifies generated/draft/approved images with `image_url` and `project_id`.
   - `library_files` stores durable assets with `kind`, `storage_path`, and `mime_type`.
   - `generation_tasks` is heavily image-centric and not suitable for a clean video architecture.
3. **Imagens Domain**: Generated images are stored in `images`.
4. **Library**: Reusable assets live in `library_files`.
5. **Source-Image Contract (Decision A)**: 
   - **Verdict**: `source_image_id UUID REFERENCES images(id)` is the smallest correct boundary since `/imagens` output lives there. This enforces ownership explicitly through the `images` relation. An image generated on `/imagens` will be passed by `images.id`.
6. **S3 Helpers**: Can reuse `uploadImageToS3`, `createPresignedReadUrl`, `uploadLibraryFile`, and `lib/storage/s3.ts`. We will need a server-side curl/fetch helper to download the Kling result URL to S3.
7. **`/videos` Structure**: Currently lists `video_drafts`. We will keep historical drafts but add a Create VIdeo modal/page for AI video generation which writes `video_generations`.
8. **Production Action**: `Criar Vídeo` in Production currently creates a `VideoDraft`. Semantic change: It will route to `/videos?project=X&production=Y`.
9. **Credentials (Decision B)**: We will use server-owned credentials via `.env` (`KLING_API_AK` and `KLING_API_SK`), avoiding a UI settings page for now.
10. **Async Contract**: 
    - `queued -> submitted -> running -> completed | failed`
    - Provider Callback: webhook route `/api/kling/callback` will verify payload and update generation state.
11. **Provider Adapter**: We will use a standard Kling API JWT auth function that signs the payload using the SK. Wait for I2V specific endpoint (`/v1.2/videos/image2video` or similar).

### Implementation Plan

**1. Database Migration (`039_create_video_generations.sql`)**
Create `video_generations` table with:
- `id`, `user_id`, `project_id`, `production_id`
- `mode` (image_to_video, text_to_video)
- `prompt`
- `source_image_id` (nullable, FK to `images.id`)
- `status` (queued, submitted, running, completed, failed)
- `provider` (Kling), `model` (e.g., kling-v1.6)
- `task_id` (external Kling task identity)
- `request_config`, `provider_metadata`, `result_metadata`, `error_details` (JSONB)
- `storage_path`, `public_url`
- timestamps.

**2. Storage Downloader**
Add a utility in `lib/storage/video-downloader.ts` that takes a temporary Kling URL, fetches the binary, computes a safe user-scoped S3 path, and uploads it to our S3-compatible backend.

**3. API Routes & Adapter**
- `lib/providers/kling/adapter.ts`: Functions for `submitImageToVideo`, `submitTextToVideo`, `generateToken`, and `getTaskStatus`.
- `POST /api/video-generations`: Starts the VideoGeneration, calls Kling adapter, updates task_id and status to `submitted`.
- `GET /api/video-generations`: List generations for the workspace.
- `POST /api/kling/callback`: Idempotent completion webhook, receives result, downloads to S3, marks status `completed`.

**4. UI Adjustments**
- Change Production "Criar Vídeo" to link to `/videos`.
- In `/videos`, add a button "Criar Vídeo (IA)" that opens a creation flow (Image-to-Video).
- List `video_generations` alongside `video_drafts`.

### Real Provider Execution / Smoke Test
**STATUS: PENDING USER APPROVAL**

**Ação exata que consumirá créditos:**
- **Endpoint:** `POST https://api.klingai.com/v1/videos/image2video` (Kling AI API, I2V)
- **Model:** `kling-v1`
- **Modo:** Image-to-Video (I2V)
- **Duração:** 5 segundos
- **Resolução:** 720p
- **Credenciais necessárias:** `KLING_API_AK` e `KLING_API_SK` devem estar configurados no `.env`.
- **Callback Público:** A aplicação usará a rota `/api/kling/callback`. Se você estiver rodando em `localhost`, essa URL não será alcançável pelo Kling. Contudo, o polling pela UI através de `/api/video-generations/[id]/sync` garantirá que o status e o download funcionem. O webhook callback verdadeiro exigiria um túnel configurado ou ambiente público, mas o contrato webhook já foi preparado de forma idempotente para ser provado.

**Peço sua autorização:**
Autoriza a execução do **PRIMEIRO SMOKE PAGO (I2V)** via requisição real ao Kling AI para provarmos o comportamento na UI e no Banco de Dados? Se sim, fornecerei as instruções finais de teste.
