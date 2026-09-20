# Shared Creative Rendering Spike — Audit (Wave 0)

**Status:** Audit concluída — READ-ONLY, nenhuma alteração de produto
**Produto:** Content Agent Studio
**Data:** 2026-09-20
**Base auditada:** worktree `traycer/content-studio-ai-soft-yak` @ `6057e09` (idêntico a `main` recente: "Fix/studio shell hydration mobile (#27)")
**Legenda:** `FACT` = verificado no código/git · `INFERENCE` = dedução a partir de evidência · `RECOMMENDATION` = proposta · `NOT FOUND` = procurado e inexistente

---

## 1. Executive Summary

**FACT — o encaixe é viável sem substituir arquitetura existente.** O repositório é um Next.js 16 / React 19 / TypeScript 5.7 / Zod 3 / pnpm monolito com Supabase (Postgres + RLS) e storage S3-compatível. Ele já possui as fundações que a Creative Rendering Layer precisa consumir: `Project` com `identity` JSONB validada por Zod, `Production`, `EditorialContent → ChannelPiece → ChannelPieceMedia` (que já aceita `library_file_id`), `LibraryFile`/`LibraryFolder` com upload presign e URLs assinadas em tempo de leitura, `VideoDraft.scenes` com exatamente os campos que a Timeline Manifest V0 descreve como legado, e um padrão de schema Zod `.strict()` + `z.infer` + testes Vitest.

**FACT — o que NÃO existe:** nenhuma noção de artifact, approval, history, VideoWork, Scene Plan, Timeline, RenderExecution, template, token visual de Project, fonte por Project, AssetRef, primitive, SVG handling, dimensões de imagem persistidas ou provider abstraction. Remotion não aparece em `package.json`, `pnpm-lock.yaml` nem em código (0 ocorrências).

**FACT — divergências estruturais importantes:**
1. A pasta `docs/discovery/` (todos os 17 documentos de autoridade + Visual Reference Pack + docs antigos de vídeo) existe **apenas como arquivos não rastreados no checkout principal** (`D:/Trabalhos/Content Agent Studio/content-studio-ai-git`). Não está em nenhum branch nem commit. Este worktree não a contém.
2. `VIDEO_PRODUCTION_V0_DOMAIN.md` §33 classifica **HyperFrames como HIPÓTESE FORTE para primeiro renderer** e **Remotion como ADIADO (segundo motor)**. Os documentos novos invertem isso sem registrar supersessão explícita.
3. Project Identity V1 real é 100% texto livre (`expression.visual_identity` é uma string). Não há typography/colors/brand estruturados; `VisualTokensSnapshot` só pode nascer de fixture no spike.
4. Render server-side com `@remotion/renderer` **não roda em Vercel Functions** (limite de 50 MB; Chromium é dependência) — documentação oficial Remotion. O spike deve renderizar localmente via script/CLI; produção exigirá Lambda/worker (fora do spike).

**Gate 0 Verdict: `PASS_WITH_CONSTRAINTS`** (detalhado na §16).

---

## 2. Repo State

### 2.1 Ritual de abertura

| Item | Resultado |
| --- | --- |
| Branch atual | `traycer/content-studio-ai-soft-yak` (worktree Traycer) — FACT |
| `git status --porcelain` (worktree) | limpo — FACT |
| HEAD | `6057e09` Fix/studio shell hydration mobile (#27) — FACT |
| Checkout principal | `D:/Trabalhos/Content Agent Studio/content-studio-ai-git` em `feat/design-system-route-adoption-ds1hd` @ mesmo `6057e09`, **com 13 arquivos modificados não commitados** (`app/(dashboard)/imagens/*`, `videos/*`, `app/api/image-drafts/route.ts`, `app/api/video-drafts/route.ts`, `lib/draft-hub.ts`, `next.config.mjs`, …; +1193/−418) e pastas não rastreadas `docs/discovery/`, `.agents/`, `.claude/`, `.codex/`, `.tmp/` — FACT (somente leitura; nada foi tocado) |
| Package manager | **pnpm** — FACT (`pnpm-lock.yaml` lockfileVersion 9.0; `pnpm-workspace.yaml` com `allowBuilds: sharp, unrs-resolver`) |
| Node local | v24.16.0 — FACT; `@types/node ^22` no `devDependencies` — FACT |
| Next | 16.2.4 — FACT |
| React / ReactDOM | 19.2.4 — FACT |
| TypeScript | 5.7.3 — FACT |
| Zod | 3.25.76 instalado (`^3.24.1`) — FACT |
| Vitest | 4.1.9 — FACT |
| Tailwind | 4.2.0 (via `@tailwindcss/postcss`) — FACT |
| sharp | 0.34.5 — FACT |
| Remotion | **NOT FOUND** em package.json, lockfile e código — FACT |
| `node_modules` no worktree | ausente (0 entradas) — FACT. Não instalei (proibido). Consequência: **não foi possível executar `pnpm test` / `pnpm typecheck` nesta rodada.** |
| Nenhum `cd`, `pull`, `checkout`, `install`, migration ou write de produto executado | FACT |

### 2.2 Scripts e configuração

`package.json` (FACT): `dev`, `build`, `start`, `lint` (`eslint .`), `typecheck` (`tsc --noEmit -p tsconfig.typecheck.json`), `test` (`vitest run`), `validate` (`pnpm typecheck && pnpm lint && pnpm build`). Sem campo `packageManager`, sem `engines`.

`vitest.config.ts` (FACT): `include: ['lib/**/*.test.ts']`, `environment: 'node'`, alias `@` → raiz.
INFERENCE: o glob `*.test.ts` **não** casa `.test.tsx`; os testes `lib/__tests__/*.test.tsx` (ex.: `proven-primitives.test.tsx`, `cards-metadata-actions.test.tsx`) provavelmente não são executados por `pnpm test`. Verificar quando houver `node_modules`.

`tsconfig.json` (FACT): `strict`, `moduleResolution: bundler`, `jsx: react-jsx`, `paths: {"@/*": ["./*"]}`, `target: ES6`, `resolveJsonModule: true`.

`next.config.mjs` (FACT): `images.unoptimized: true`, redirect `/publicacoes → /conteudos`, `allowedDevOrigins`. Sem `serverExternalPackages`, sem webpack override.

`eslint.config.mjs` (FACT): `eslint-config-next` flat config com regras React Compiler rebaixadas para `warn`.

`proxy.ts` (FACT): middleware Next 16 (`proxy`) que atualiza sessão Supabase; matcher exclui assets estáticos.

Deploy (INFERENCE): `@vercel/analytics` importado em `app/layout.tsx` → deploy na Vercel. **NOT FOUND:** `.github/`, `vercel.json`, `vercel.ts`, Dockerfile, CI de qualquer tipo. Vars de ambiente usadas: Supabase (`NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY`), S3 (`S3_ENDPOINT|BUCKET|ACCESS_KEY|SECRET_KEY|REGION|FORCE_PATH_STYLE`, `PUBLIC_STORAGE_BASE_URL`), OpenAI (`OPENAI_API_KEY|IMAGE_MODEL|EVALUATION_MODEL|PROMPT_MODEL`).

### 2.3 Documentos de autoridade encontrados

`docs/discovery/creative-rendering/` no checkout principal (FACT — todos os 17 arquivos citados na missão existem):
`CREATIVE_PRIMITIVES_SCHEMA_V0.md`, `CREATIVE_PRIMITIVE_HARNESS_V0.md`, `EDITORIAL_DOCUMENTARY_CARD_ANATOMY_V0.md`, `EDITORIAL_DOCUMENTARY_CARD_FIXTURES_V0.md`, `EDITORIAL_DOCUMENTARY_CARD_V0.md`, `PORTAL_DOCUMENTARY_CARD_FIXTURE_V0.json`, `REMOTION_ADAPTER_MAPPING_V0.md`, `RENDER_ARCHITECTURE_V0.md`, `SHARED_CREATIVE_RENDERING_SPIKE_PLAN_V0.md`, `STATIC_RENDER_MANIFEST_V0.md`, `STATIC_RENDER_SCHEMA_V0.md`, `TEMPLATE_DESCRIPTOR_SCHEMA_V0.md`, `TEMPLATE_REGISTRY_V0.md`, `TIMELINE_MANIFEST_V0_REFINEMENT.md`, `TIMELINE_SCHEMA_V0.md`, `TYPOGRAPHY_FONT_CATALOG_V0.md`, `VISUAL_PRIMITIVE_LIBRARY_V0.md`.
Visual Reference Pack: `visual-reference-pack/pack a/001..010.png` (10) e `pack b/01.png, 02.png` (2) — FACT.

`docs/discovery/` (FACT): `VIDEO_PRODUCTION_V0_DOMAIN.md`, `KNOWLEDGE_EXPLAINER_HYBRID_V0_COMPLETE (1).md` (+ variantes `_V0.md`, `_UPDATED.md`, `_UPDATED_V2.md` não citadas pela missão; a `COMPLETE (1)` foi tratada como autoridade conforme instruído).

Todos foram lidos. **Nenhum está versionado em git** (FACT — `git ls-tree` em todos os refs locais não retorna `docs/discovery`).

---

## 3. Existing Architecture Map

### 3.1 Domínio Project / Production / Publicação

Tipos canônicos em `lib/types.ts` (FACT):

| Entidade | Símbolo | Persistência | Observações |
| --- | --- | --- | --- |
| Project | `Project` | `projects` (001, 019, 027, 029, 030) | `identity: ProjectIdentity \| null` (JSONB), `context: string \| null` (legado), `evaluation_mode`, `status: active\|archived` |
| Production | `Production` | `productions` (020) | `title`, `intention`, `type: editorial\|branding\|campaign`; leve por decisão |
| EditorialContent | `EditorialContent` | `editorial_contents` (021) | `title`, `body`, `ai_context`, `status: draft\|ready\|archived`, `production_id` |
| ChannelPiece | `ChannelPiece` | `channel_pieces` (021) | `channel` (`PublicationChannel`), `format` (`PublicationFormat` inclui `carousel`, `reel`, `short`, `story`), `status: draft\|ready\|approved\|archived` |
| ChannelPieceMedia | `ChannelPieceMedia`, `ChannelPieceMediaResolved` | `channel_piece_media` (022–024) | XOR `image_id`/`library_file_id` (`cpm_exactly_one_source`), `role: primary\|thumbnail\|carousel_item\|background\|attachment`, `position`, único `primary` |
| Image (gerada) | `Image` | `images` (001, 013) | `image_url`, `storage_path`, `thumbnail_path`, `mime_type`, `status: draft\|generating\|approved\|rejected`, `aspect_ratio`, `metadata JSONB` |
| ImageDraft | `ImageDraft` | `image_drafts` (002, 008–011, 020) | workspace de geração; `generation_attempts[]`, `current_evaluation` |
| VideoDraft | `VideoDraft`, `VideoScene` | `video_drafts.scenes JSONB` (002, 020) | ver §7 |
| LibraryFile / Folder | `LibraryFile`, `LibraryFolder` | `library_files` (015, 018), `library_folders` (016, 017) | ver §8 |
| Post (legado) | `Post` | `posts` (012, 014, 026) | migrado para EditorialContent (M8/M9) |
| generation_tasks | — (sem tipo em `lib/types.ts`) | `generation_tasks` (005) | precedente de Task+Execution acoplado ao NanoBanana |

Rotas (FACT): `app/api/productions`, `editorial-contents`, `channel-pieces` (+`generate-body`), `channel-piece-media` (+`upload`, `organize`, `[id]/download`), `library-files`, `library-folders`, `image-drafts`, `video-drafts`, `images/[id]/signed-url`, `storage/{upload-image,presign-image-upload,sign-image-path}`, `openai/generate-image`, `nanobanana/*`, `evaluate-image`, `prompts/translate`, `videos/generate-scene-prompt`, `posts/*`.

UI (FACT): `app/(dashboard)/projetos/[id]/page.tsx` (Project), `.../producoes/[productionId]/page.tsx` (Tabs `overview | images | videos | editorial`), `.../conteudos/[editorialContentId]/page.tsx` (ChannelPieces + `ChannelPieceMediaSection` + `MediaPickerDialog`), `/imagens`, `/videos`, `/arquivos` (Library), `/galeria` (outputs gerados), `/conteudos`, `/dashboard`, `/configuracoes`.

**NOT FOUND:** `ProductionArtifact`, `VideoWork`, `Approval`, `History`, `RenderExecution`, `MediaRequirement`, `RenderRevision`. A única semântica de aprovação existente é `images.status='approved'` e `channel_pieces.status='approved'` (campos, não registros de decisão).

### 3.2 Padrão de schemas e validação

FACT: único módulo Zod do repo é `lib/schemas/project-identity.ts` (+ `lib/project-identity-normalizer.ts`). Convenções observadas:
- `z.object({...}).strict()` em todos os níveis; `z.literal(1)` para `schema_version`; `z.infer` como única fonte do tipo (`ProjectIdentity`);
- helpers privados `optionalText` / `optionalStringArray` com `.trim().min(1).max(N)`, dedupe via `transform`;
- constantes de limite exportadas (`IDENTITY_TEXT_MAX_CHARS` etc.) para uso em testes/UI;
- erro tipado `ProjectIdentityParseError extends Error { issues: z.ZodIssue[] }`; função `normalizeProjectIdentity(input: unknown): ProjectIdentity | null` distingue ausência (`null`) de erro estrutural (throw);
- testes em `lib/schemas/__tests__/project-identity.test.ts` e `lib/__tests__/*.test.ts` com `describe/it/expect` (Vitest), fixtures inline `validMinimal`/`validFull`;
- testes de componente usam `renderToStaticMarkup` de `react-dom/server` (sem RTL/jsdom) — `lib/__tests__/proven-primitives.test.tsx`.
- **NOT FOUND:** `z.discriminatedUnion` (nenhum uso ainda); `react-hook-form`/`@hookform/resolvers` estão em `dependencies` mas **não são importados** em nenhum componente (FACT — grep vazio).
- Rotas de API validam manualmente (`typeof`, `UUID_RE`, `Array.isArray`), não com Zod — FACT (ex.: `app/api/video-drafts/route.ts`, `library-files/route.ts`).

### 3.3 Build / runtime boundaries

FACT: páginas são client components grandes (`'use client'`, `useState` + `fetch('/api/...')`): `/imagens` 1843 linhas, `/videos` 1142, `/arquivos` 1104, `/galeria` 783. `lib/` não contém `.tsx` nem `'use client'`/`server-only`. Componentes React vivem em `components/` (shadcn em `components/ui/`, 47 arquivos; `components.json` style `new-york`, aliases `@/components`, `@/lib`, `@/hooks`).

---

## 4. Proposed → Existing Mapping

| Proposed concept (docs) | Existing equivalent (repo) | Reuse? | Gap | Recommended location |
| --- | --- | --- | --- | --- |
| Project (control plane) | `Project` / `projects` | Sim | — | — |
| Production | `Production` / `productions` | Sim | — | — |
| EditorialContent → ChannelPiece | `EditorialContent`, `ChannelPiece` | Sim | — | — |
| ChannelPieceMedia como destino do output | `channel_piece_media.library_file_id` | Sim | Só via `LibraryFile` (por design M1) | — |
| LibraryFile | `LibraryFile` / `library_files` | Sim | sem `width/height`, sem `checksum`, sem `role`, sem SVG handling | estender depois via metadata (fora do spike) |
| ProductionArtifact | NOT FOUND | — | inexistente | adiar (decisão de Video Production V0) |
| Approvals / History | NOT FOUND (só `status` fields) | — | inexistente | adiar |
| VideoWork | NOT FOUND | — | inexistente | adiar; usar `fixture:` refs |
| VideoDraft / scenes | `VideoDraft`, `VideoScene` (`video_drafts.scenes` JSONB) | Sim (fonte para importer) | JSONB sem validação; `image_url` é data-URL base64 | preservar; bridge futura `lib/creative/video/video-draft-importer.ts` |
| Scene Plan | NOT FOUND | — | inexistente | Wave pós-spike |
| Timeline Manifest | NOT FOUND | — | novo contrato | `lib/schemas/creative/timeline.ts` |
| StaticRenderManifest | NOT FOUND | — | novo contrato | `lib/schemas/creative/static-render.ts` |
| CanvasSpec / TemplateRef / AssetRef / MotionSpec / TransitionSpec / IdentitySnapshotRef | NOT FOUND | — | novos | `lib/schemas/creative/primitives.ts` |
| Project Identity (semântica) | `ProjectIdentitySchema` (5 zonas texto) | Sim (consumir) | sem typography/colors/brand estruturados | não alterar |
| Identity Compiler | `lib/context-compiler.ts` (`buildImageGenerationContext`, `buildImageEvaluationContext` → strings de prompt) | Padrão sim; código não | compila para prompt, não para tokens | novo `lib/creative/identity/compile-visual-identity.ts` (mesmo estilo `ProjectContextSource`) |
| VisualTokensSnapshot | NOT FOUND (tokens do DS em `app/globals.css` são **tokens de UI do produto**, não de Project) | Não (não confundir) | novo | `lib/schemas/creative/visual-tokens.ts` |
| FontRef / Font Resolver | `next/font/google` em `app/layout.tsx` (Geist, Geist Mono, Inter Tight, JetBrains Mono → CSS vars `--font-*`) — apenas UI | Não | fontes de Project inexistentes | `lib/creative/fonts/` (resolver boundary; spike com fixture) |
| Template Registry | NOT FOUND | — | novo | `lib/creative/templates/registry.ts` (estático em código) |
| TemplateDescriptor | NOT FOUND | — | novo | `lib/schemas/creative/template-descriptor.ts` |
| Template React (`editorial.documentary-card`) | NOT FOUND | — | novo | `components/creative/templates/editorial-documentary-card/` |
| Shared visual primitives (TornPaper, Tape…) | NOT FOUND (lucide-react = ícones de UI; `sharp` = thumbnails) | Não | novo | `components/creative/primitives/` |
| Asset Resolver | `createPresignedReadUrl` (S3, 3600 s), `resolveMediaSource` (`app/api/channel-piece-media/_helpers.ts`) | Padrão sim | sem `AssetRef` neutro; resolvers vivem em rotas | `lib/creative/assets/resolve-asset.ts` (fixture + library_file) |
| Upload → Library | `POST /api/storage/presign-image-upload` + `POST /api/library-files` (`/arquivos`), `POST /api/channel-piece-media/upload` (multipart, S3 + LF + CPM) | Sim | SVG não sanitizado; sem dimensões; PNG-alpha não detectado | reutilizar; harness pós-spike |
| Visual Primitive Library / Harness | NOT FOUND | — | novo | pós-spike; fixtures em `public/creative-fixtures/` no spike |
| Renderer Adapter (Remotion) | NOT FOUND | — | novo | `lib/creative/renderers/remotion/` + entry `remotion/` |
| RenderExecution | `generation_tasks` (precedente Task+Execution) | Padrão, não tabela | — | adiar persistência; objeto em memória no spike |
| Preview (Player/Thumbnail) | NOT FOUND | — | novo | rota técnica `app/(dashboard)/dev/creative-preview/` ou script (§9) |
| Authoring State | páginas com `useState` local (ex.: `scenes` em `/videos`) | Padrão sim | — | Wave 6, hook local |
| Validation result model | `ProjectIdentityParseError.issues` | Padrão sim | sem `ValidationIssue` genérico | `lib/creative/validation.ts` |
| Async render infra | `generation_tasks` + polling/webhook (NanoBanana) | Precedente | sem fila | fora do spike |

---

## 5. Project Identity Findings

**FACT — estado real:**
- Schema: `lib/schemas/project-identity.ts` — `schema_version: 1`, zonas `foundation.purpose`, `relationship.audience`, `expression.{visual_identity, voice}`, `governance.{principles[], restrictions[]}`, `practice.generation_preferences[]`. Tudo texto/arrays de texto; `.strict()`.
- Persistência: `projects.identity JSONB` (`scripts/027_add_project_identity.sql`); `style_profile` removido (029).
- Normalização: `normalizeProjectIdentity` / `parseProjectIdentity` / `ProjectIdentityParseError`.
- Compilação: `lib/context-compiler.ts` produz **strings markdown para prompts** (geração e avaliação de imagem). Consumidores: `lib/ai-simulator.ts` (`generateImagePrompt`, com `identity.expression.visual_identity` como style fallback), `app/api/evaluate-image/route.ts`, `app/api/prompts/translate` (via testes).
- UI: `components/projects/project-identity-form.tsx` (dialog com `Textarea` por zona; salva via `supabase.from('projects').update`), `project-identity-display.tsx`, `inherited-project-identity.tsx` + `lib/inherited-project-identity.ts` (`resolveInheritedIdentitySummary`, `IdentitySurface = production|image|video|editorial`).
- Vídeo: `/videos` exibe a identidade herdada (`WorkspaceIdentityContext`), mas `app/api/videos/generate-scene-prompt/route.ts` lê apenas `projects.context` — a Identity V1 **não** alimenta o prompt de cena (FACT).
- **NOT FOUND:** typography, colors, logo/brand asset, tokens, safe area, qualquer campo estruturado visual.

**INFERENCE:** `expression.visual_identity` é a única zona de onde uma futura compilação semântica poderia partir, mas é prosa; não há como derivar `VisualTokensSnapshot` determinístico dela sem LLM. Portanto, no spike o snapshot vem de fixture, e o `snapshot_ref` (`fixture:identity:...`) resolve em memória — exatamente como `CREATIVE_PRIMITIVES_SCHEMA_V0 §6` permite.

**RECOMMENDATION — onde encaixar no futuro, sem tocar agora:**
- Adicionar uma zona nova ao schema quando for a hora (ex.: `expression.typography.{display,body}: FontRef`, `expression.palette`, `expression.brand_assets`) mantendo `schema_version: 1` se todos os campos forem opcionais e `.strict()` for respeitado — INFERENCE: o normalizer só rejeita `schema_version !== 1`, então uma zona opcional adicional é aditiva. Isso exige revisão do `hasContent()` e dos form helpers (`identityToFormState`). Fora do spike.
- Compiler: `lib/creative/identity/compile-visual-identity.ts` com assinatura no estilo do `context-compiler` (`source: ProjectContextSource & { overrides?: ... }`) → `VisualTokensSnapshot`. No spike, `resolveIdentitySnapshot(ref)` lê de `lib/creative/fixtures/identity/*.ts`.
- `IdentitySnapshotRef.snapshot_ref` futuro: `project:<id>@<updated_at|hash>` para reprodutibilidade, já que não há versionamento de identity hoje (FACT: `projects.updated_at` é o único carimbo).

---

## 6. Static/Image Findings

**FACT — pipeline atual de imagens (intocável):**
- UI `/imagens` (`app/(dashboard)/imagens/page.tsx`) com `ImageInputSection`, `PromptSection`, `ImageResult`, `GenerationHistory`; drafts via `/api/image-drafts` (`image_drafts`, exige `production_id`).
- Geração: `POST /api/openai/generate-image` (`gpt-image-*`, `size`, `quality`; upload S3 via `uploadImageToS3` folder `images`; insert em `images`); `POST /api/nanobanana/generate` + `callback` + `status/[taskId]` (`generation_tasks`); `POST /api/storage/upload-image` (data URL ou URL remota → S3 + thumb WebP 360px via `sharp`).
- Avaliação: `POST /api/evaluate-image` (gpt-4o-mini, `buildImageEvaluationContext`, `evaluation_mode`).
- Outputs: `images` table; Galeria (`/galeria`, `lib/gallery-output-library.ts`) lista outputs gerados com URL assinada (`GALLERY_SIGNED_URL_TIMEOUT_MS`).
- `ChannelPieceMedia` aceita `image_id` (gerada) **ou** `library_file_id` (upload).

**NOT FOUND:** ImageDraft não tem noção de template, canvas, composição ou texto real. `aspect_ratio` é string livre em `images`.

**INFERENCE — impacto da nova camada:** zero sobre o fluxo atual se a camada for aditiva. O output de um still renderizado deve entrar pelo caminho já previsto pelas decisões antigas: `render → LibraryFile (kind='image') → ChannelPieceMedia (role='carousel_item' | 'primary')`. Isso já é suportado por `POST /api/library-files` (registro) + S3 `uploadLibraryFile` sem qualquer migration. **Não** inserir stills em `images` (tabela semanticamente ligada a geração por IA e ao evaluator).

**RECOMMENDATION:** no spike, o PNG fica em disco (`.tmp/`/scratch) e a promoção para LibraryFile fica **fora** do spike (Wave pós-verdict), evitando tocar storage/DB.

---

## 7. Video Findings

**FACT — VideoDraft real:**
```ts
// lib/types.ts
export interface VideoScene {
  id: string; order: number; description: string; prompt: string | null;
  image_url: string | null; duration: number /* seconds */; movement: string | null;
}
export interface VideoDraft { id; user_id; project_id; production_id; name; scenes: VideoScene[]; created_at; updated_at }
```
- Persistência: `video_drafts.scenes JSONB DEFAULT '[]'` (002), `production_id` (020). `POST/PATCH /api/video-drafts` aceita `scenes` como `Array.isArray(body.scenes) ? body.scenes : []` — **sem validação de shape** (FACT).
- `image_url` é preenchido pelo `SceneCard` com **data URL base64** via `FileReader` (`components/videos/scene-card.tsx`) — ou seja, imagens de cena são inline no JSONB, não `LibraryFile`/`images` (FACT).
- `movement` vocabulário (FACT, `scene-card.tsx`): `static | zoom_in | zoom_out | pan_left | pan_right | tilt_up | tilt_down | dolly`. `duration` opções: 2,3,4,5,8,10 s.
- `handleGenerateVideo` em `/videos/page.tsx` é **simulado** (`setTimeout(3000)` + toast "fluxo simulado") — não existe render (FACT).
- `StoryboardModal` é só visualização das cenas.
- `/api/videos/generate-scene-prompt` gera prompt por cena com OpenAI usando `projects.context`.
- **NOT FOUND:** timeline, tracks, frames, fps, Scene Plan, Asset Manifest, Video Specification, qualquer render.

**Reconciliação com `TIMELINE_MANIFEST_V0_REFINEMENT §18`:** a lista de campos legados citada (`order, description, prompt, image_url, duration, movement`) **bate exatamente** com `VideoScene` (FACT), faltando apenas `id`. A decisão "VideoDraft legado não é promovido diretamente para timeline" permanece válida e coerente com o código.

**RECOMMENDATION — evolução sem substituir VideoDraft:**
1. Não tocar em `VideoScene` nem em `/api/video-drafts` no spike.
2. Pós-spike, criar `lib/creative/video/video-draft-importer.ts`: `VideoScene[] → SceneDraft[]` (Scene Plan draft neutro), com mapeamento explícito `movement → MotionSpec` (`zoom_in|dolly → slow_push`, `pan_* → slow_pan + direction`, `zoom_out`/`tilt_*` → sem preset suportado → warning `unsupported_motion`) e `duration s → duration_frames` (Assembly normaliza para frames, conforme §5 do refinamento).
3. `image_url` base64 vira `AssetRef{type:'external'|'fixture'}` apenas em importer; produto futuro deve migrar cenas para `LibraryFile` — fora do escopo.
4. Manter `Script Segment ≠ Scene Plan ≠ Timeline Segment ≠ Template ≠ Renderer` — nenhuma dessas responsabilidades deve ser colocada em `VideoScene`.
5. `TimelineManifest.context.video_work_ref` é obrigatório no schema proposto, mas `VideoWork` não existe → no spike usar `fixture:video-work:*`; RECOMMENDATION tornar `video_work_ref` opcional **ou** aceitar `video_draft_ref` como alternativa até VideoWork existir (registrar como decisão de Wave 2).

---

## 8. Asset/Library Findings

**FACT — o que existe:**
- `library_files` (015/018): `project_id`, `folder`, `name`, `kind: image|video|audio|document|other`, `mime_type`, `file_size`, `storage_provider ('s3')`, `storage_path`, `public_url`, `thumbnail_url`, `deleted_at` (lixeira). `library_folders` (016/017) com `path`, `parent_path`, `is_project_root`.
- Storage: `lib/storage/s3.ts` — `createPresignedImageUpload` (PUT presign 900 s; folders `images|posts|library`; path `users/{userId}/{folder}/{prefix}{uuid}/{safeName}.{ext}`), `uploadLibraryFile` (buffer direto), `uploadImageToS3` (original + thumb WebP via `sharp`), `createPresignedReadUrl` (GET presign 3600 s, `inline|attachment`), `moveLibraryS3Object`, `deleteS3Object`, `isS3StorageConfigured`.
- Upload UI `/arquivos`: presign → PUT direto do browser → `POST /api/library-files` com `kind` derivado de `mime` (`getKind`), `mimeType` default `application/octet-stream`. **Aceita qualquer MIME** (INFERENCE: SVG pode ser enviado, mas fica `kind='image'` sem sanitização nem preview seguro).
- Upload via ChannelPiece: `POST /api/channel-piece-media/upload` (multipart, 50 MB, allowlist `jpeg|png|webp|gif|mp4|webm|quicktime` — **SVG bloqueado**), com compensação de falhas (S3 → LF → CPM).
- Resolução em leitura: `resolveMediaSource` gera URL assinada por request — **URLs temporárias nunca persistidas** como fonte de verdade (comentário no código). Esse é exatamente o padrão `AssetRef → ResolvedAsset` que `REMOTION_ADAPTER_MAPPING §21` pede.
- `MediaPickerDialog` lista `library_files?projectId=` com filtro `image|video` e associa por `libraryFileId` — a UI de "escolher asset da Library para um slot" já existe em forma embrionária.
- Escopo por Project: `library_files.project_id` (nullable) e `library_folders.project_id` (NOT NULL) — assets podem ser project-scoped ou globais do usuário. **Não existe** escopo `system` (assets do Studio).

**NOT FOUND:** dimensões (`width/height`), alpha/transparência, checksum, versão de arquivo, `role`, metadata JSON em `library_files`, sanitização de SVG, thumbnail para uploads via presign (`thumbnail_url: null` no fluxo `/arquivos`), abstração de provider de storage (só S3).

**Quanto da proposta `Upload → Library → AssetRef → resolver → template slot → renderer` já existe:** `Upload → Library` (sim), `→ resolver` (padrão sim, específico de CPM), `AssetRef`/`template slot`/`renderer` (não).

**RECOMMENDATION — ponto de extensão futuro (fora do spike):**
- `AssetRef{type:'library_file', ref: library_files.id}` resolve via um `lib/creative/assets/resolve-asset.ts` que reutiliza `createPresignedReadUrl` e lê `mime_type`/`file_size`; dimensões podem ser obtidas on-demand com `sharp(buffer).metadata()` (já dependência) até existir coluna.
- PNG transparente: detectável com `sharp.metadata().hasAlpha` (INFERENCE) — Harness Wave H3.
- SVG: exige sanitizer (dep nova, ex. DOMPurify/`svgo` — não instalar agora) e allowlist explícita; hoje o CPM upload o rejeita, o `/arquivos` o aceita sem tratar — inconsistência a resolver no Harness.
- System primitives: não existe escopo `system` em `library_files`; RECOMMENDATION iniciar system primitives **em código/`public/`** (registry estático) e só depois avaliar tabela/escopo.
- No spike: assets de fixture em `public/creative-fixtures/` (servidos pelo Next e acessíveis ao Remotion via `staticFile()`), sem tocar S3/DB.

---

## 9. Front-end Findings

**FACT:**
- Padrão: páginas client com `useState`/`useEffect` + `fetch` para `/api/*`; sem state manager global; sem `react-hook-form` em uso; forms são controlados manualmente (ex.: `ProjectIdentityForm`, `SceneCard`).
- Shell/DS: `components/layout/studio-shell.tsx` (980 linhas), `lib/studio-shell-state.ts`, `lib/sidebar-navigation.ts` (grupos Workspace/Criação/Bibliotecas/Sistema com hrefs), `PageHeader`, `DashboardPage`, primitives DS (`Card*`, `StatusBadge`, `StateMessage`, `ContextMetadata`, `ViewModeToggle`).
- Tokens de UI: `app/globals.css` Layer 2 semantic tokens (`--canvas`, `--surface-*`, `--text-*`, `--border-*`, `--action-*`, `--card-*`, `--indicator-*`), temas `light|dark|studio` (`lib/theme.ts`), fontes via `next/font/google` (`--font-geist-sans`, `--font-studio-sans` = Inter Tight, etc.). **Estes são tokens da interface do Studio, não Visual Tokens de Project** — INFERENCE forte: misturá-los quebraria a neutralidade (o render não pode depender do tema da UI).
- Preview existente: nenhum canvas/renderer; `StoryboardModal` mostra `<img>` das cenas; `ImageResult` mostra a imagem gerada.
- Editor patterns: `SceneCard` (lista editável com `onUpdate`, drag-and-drop de arquivo, select de `movement`/`duration`) é o padrão de "authoring de item" mais próximo.

**RECOMMENDATION — onde um Authoring State pode nascer sem reconstruir o produto:**
- Wave 6 como rota técnica isolada (`app/(dashboard)/dev/creative-preview/page.tsx`, não listada em `sidebar-navigation.ts`) ou como painel dentro da Production tab `editorial` no futuro. Estado local `useState<DocumentaryCardAuthoringState>` → `toStaticRenderManifest()` → `resolve` → `<Thumbnail>/<Player>` props. Nenhum banco.
- Mantém o padrão do repo (client component + estado local), sem introduzir store global.
- Preview e render final compartilham o **mesmo componente React** (`components/creative/templates/...`), consumido pelo `@remotion/player` (`Thumbnail`/`Player`) no Next e pelo bundle Remotion no render. Isso satisfaz `RENDER_ARCHITECTURE §10`.
- Restrições para paridade (INFERENCE a partir da doc Remotion "Code sharing" — bundle Remotion usa webpack próprio): o template **não** deve depender de Tailwind classes, de `app/globals.css`, de `next/font` CSS vars nem de `@/` aliases sem configurar alias no bundler Remotion. Recomendo **inline styles + tokens via props** no template do spike; `@/` alias exige override webpack no `remotion.config.ts` (doc "TypeScript aliases"), o que é aceitável mas deve ser provado na Wave 1.

---

## 10. Remotion Integration Surface

**FACT (documentação oficial Remotion, consultada nesta rodada):**
- React 19 suportado a partir de Remotion 4.0.0; types alinhados em ≥ 4.0.236. Next.js: guia lista "Update to Next.js 15" — Next 16 não é mencionado → INFERENCE de compatibilidade provável, a provar na Wave 1.
- `@remotion/renderer` **não roda em Vercel Serverless Functions** (limite 50 MB; Chromium). Recomendação oficial: Remotion Lambda disparado por função Vercel. Self-host exige `serverExternalPackages: ['@remotion/renderer']` e bundle feito **fora** da API route (`@remotion/bundler` inclui webpack).
- `@remotion/player`: `<Player>` e `<Thumbnail>` rodam em app React comum (Next) com o componente passado diretamente; `noSuspense` (≥ 4.0.271) permite testar com `renderToString` — compatível com o padrão de teste do repo (`renderToStaticMarkup`).
- `renderStill()` / `renderMedia()` em Node com `bundle()`.

**Menor ponto de entrada sem contaminar domínio (RECOMMENDATION):**
```
remotion/                           # entry isolado do bundle (convenção Remotion), fora de app/ e lib/
  index.ts                          # registerRoot(Root)
  Root.tsx                          # <Still>/<Composition> técnicos, props = ResolvedRenderInput serializado
remotion.config.ts                  # alias '@/' + (opcional) Tailwind — só se necessário
lib/creative/renderers/remotion/
  build-props.ts                    # ResolvedStaticRenderInput | ResolvedTimelineInput → RendererProps (sem import de remotion)
  static-adapter.ts                 # renderStill wrapper (Node-only; nunca importado por app/)
  timeline-adapter.ts               # segments → Sequence mapping (importa 'remotion' apenas aqui e em componentes de composição)
  diagnostics.ts
scripts/creative/render-still.mjs   # bundle() + renderStill()  (Wave 1/5)
scripts/creative/render-video.mjs   # bundle() + renderMedia()  (Wave 1/8)
```
Regras: (1) nenhum arquivo em `lib/schemas/creative/**`, `lib/creative/templates/**`, `lib/creative/identity/**`, `lib/creative/assets/**` importa `remotion`/`@remotion/*` — verificável por teste de grep (padrão já usado em `proven-primitives.test.tsx`, que lê fontes com `readFileSync`); (2) `@remotion/renderer`/`@remotion/bundler` **não** são importados de nenhuma rota `app/api/**` no spike (Vercel); (3) `@remotion/player` é o único pacote Remotion que entra em `app/`/`components/` (client), e apenas na rota técnica de preview; (4) o template React usa `useCurrentFrame()` **somente** através de um wrapper de `mode: 'video'` fornecido pelo adapter (ou recebe `frame` por prop, como propõe `TEMPLATE_DESCRIPTOR §16`) — RECOMMENDATION: receber `frame`/`durationFrames` por props mantém o componente livre de imports Remotion e testável com `renderToStaticMarkup`.

Remotion Studio (`npx remotion studio remotion/index.ts`) é ferramenta de dev opcional (script `remotion:studio`), nunca UI do produto.

---

## 11. Reconciled Module Tree

Árvore recomendada (RECOMMENDATION; reconcilia `TEMPLATE_REGISTRY §22` e `SPIKE_PLAN §5` com as convenções reais: schemas em `lib/schemas/`, React em `components/`, testes `lib/**/*.test.ts`, scripts em `scripts/`, assets estáticos em `public/`):

```
lib/
  schemas/
    creative/
      primitives.ts            # Ref, CanvasSpec, TemplateRef, IdentitySnapshotRef, FocalPoint, AssetRef,
                               # MotionSpec, TransitionSpec, StaticOutputFormat, VideoContainer, ContentBindings
      visual-tokens.ts         # VisualTokensSnapshotSchema (typography/colors/spacing/brand)
      static-render.ts         # StaticRenderManifestSchema (+ source/context/output/metadata)
      timeline.ts              # TimelineManifestSchema, tracks, segments (discriminatedUnion 'kind')
      template-descriptor.ts   # TemplateDescriptorSchema, CanvasSupport, capabilities, overflow policy
      __tests__/
        primitives.test.ts
        static-render.test.ts  # parse PORTAL_DOCUMENTARY_CARD_FIXTURE_V0.json (copiado para fixtures)
        timeline.test.ts
        template-descriptor.test.ts
  creative/
    validation.ts              # ValidationIssue / ValidationResult (padrão ProjectIdentityParseError)
    identity/
      resolve-identity-snapshot.ts   # snapshot_ref → VisualTokensSnapshot (fixture no spike)
      compile-visual-identity.ts     # futuro: ProjectIdentity → VisualTokensSnapshot (stub documentado)
    fonts/
      font-ref.ts              # FontRef (não persistido ainda)
      resolve-font.ts          # FontRef → { family, files|url } (fixture: fontes locais em public/)
    assets/
      resolve-asset.ts         # AssetRef → ResolvedAsset (fixture: public/creative-fixtures; library_file: presign)
    templates/
      registry.ts              # registerTemplate/resolveTemplate/validateTemplateBindings/listTemplates (Map estático)
      types.ts                 # TemplateComponentProps, ResolvedTemplate, RegisteredTemplate
      system/
        editorial-documentary-card/
          descriptor.ts        # id/version/scope/variants ['cover','info']/canvas/capabilities/identity_requirements
          content-schemas.ts   # DocumentaryCoverContentSchema, DocumentaryInfoContentSchema (por variant)
          assets-schema.ts
          index.ts             # registra descriptor + schemas + component
    resolve/
      resolve-static-render.ts # manifest → ResolvedStaticRenderInput
      resolve-timeline.ts      # manifest → ResolvedTimelineInput (+ validateTimelineSemantics)
    renderers/
      remotion/                # ver §10
    fixtures/
      identity/comunidades-alternativas.ts   # VisualTokensSnapshot fixture (Portal)
      identity/neutral-second-project.ts     # Fixture C (obrigatória)
      static/portal-documentary-card-cover.json
      static/portal-documentary-card-info.json
      timeline/documentary-card-reel.json
    __tests__/
      registry.test.ts
      resolve-static-render.test.ts
      resolve-timeline.test.ts
      renderer-isolation.test.ts   # grep: nenhum import de remotion em schemas/templates/identity/assets
components/
  creative/
    templates/
      editorial-documentary-card/
        documentary-card.tsx   # resolveVariant → CoverVariant | InfoVariant
        cover-variant.tsx
        info-variant.tsx
        layout-by-canvas.ts    # padding/title sizes por canvas (pertence ao template versionado)
        motion.ts              # slow_push/fade → progress → transform (recebe frame por props)
    primitives/
      surface.tsx  sequence-marker.tsx  brand-signature.tsx  torn-paper.tsx  tape.tsx  artifact-frame.tsx
remotion/
  index.ts
  Root.tsx
remotion.config.ts
scripts/creative/
  render-still.mjs
  render-video.mjs
public/creative-fixtures/
  terra-una/documentary-photo-01.jpg   (ou book-cover)
  primitives/paper-texture-dark-01.png, torn-paper-fragment-01.png, tape-beige-01.png, ...
  fonts/<fixture-display>.woff2, <fixture-body>.woff2
app/(dashboard)/dev/creative-preview/page.tsx   # Wave 6 apenas; não listada no sidebar
docs/discovery/creative-rendering/
  SHARED_CREATIVE_RENDERING_SPIKE_AUDIT.md   (este)
  SHARED_CREATIVE_RENDERING_SPIKE_RESULTS.md (Wave 10)
```

Divergências deliberadas em relação aos docs:
- `lib/creative/schemas/` (docs) → `lib/schemas/creative/` (repo já centraliza schemas Zod em `lib/schemas/`).
- Componentes React fora de `lib/` (repo: `lib/` sem `.tsx`; React em `components/`).
- Entry Remotion em `remotion/` na raiz (convenção Remotion; evita `app/` e `lib/` importarem o bundle).
- Testes seguem `lib/**/*.test.ts` (glob real do Vitest) — testes de componente de template devem ser `.test.ts` usando `createElement` + `renderToStaticMarkup`, ou ajustar o glob do Vitest (mudança de config: só com aprovação explícita).

---

## 12. Dependencies

Prováveis (NÃO instaladas; INFERENCE baseada na doc Remotion e no estado do repo):

| Pacote | Uso | Boundary | Quando |
| --- | --- | --- | --- |
| `remotion` | `AbsoluteFill`, `Sequence`, `Still`, `Composition`, `staticFile`, `interpolate` | `remotion/`, `lib/creative/renderers/remotion/`, componentes de composição | Wave 1 |
| `@remotion/player` | `<Player>`, `<Thumbnail>` (client) | rota técnica de preview; testes com `noSuspense` | Wave 1 (preview local) / Wave 5–6 |
| `@remotion/bundler` | `bundle()` em scripts Node | `scripts/creative/*.mjs` apenas | Wave 1 |
| `@remotion/renderer` | `renderStill()`, `renderMedia()` (baixa Chromium headless) | scripts Node apenas; **nunca** em `app/api` na Vercel | Wave 1 |
| `@remotion/cli` (opcional) | `remotion studio`, `remotion still/render` | devDependency, scripts | Wave 1 (acelera Gate 1) |
| `@remotion/google-fonts` **ou** fontes locais em `public/creative-fixtures/fonts` + `@font-face`/`delayRender` | Font loading gate | `lib/creative/fonts/` | Wave 4 |
| `@remotion/tailwind-v4` (evitar) | só se o template usar Tailwind — RECOMMENDATION não usar no spike | — | — |

Todas pinadas na mesma versão 4.0.x (Remotion exige versões idênticas entre pacotes). Sem dependência Python. Sem fila. Sem Lambda.

Impactos de instalação a provar na Wave 1: `pnpm-workspace.yaml` já usa `allowBuilds` (FACT) → INFERENCE: pnpm ≥ 10 bloqueia scripts de build não aprovados; pacotes Remotion com binários (compositor/ffmpeg em `@remotion/renderer`, Chromium download) podem exigir entrada em `allowBuilds`. Isso é uma **mudança de package files**, permitida apenas na Wave 1 com aprovação.

---

## 13. Risks

| # | Risco | Tipo | Evidência | Mitigação |
| --- | --- | --- | --- | --- |
| R1 | Render server-side impossível em Vercel Functions | FACT (doc Remotion) | §10 | Spike renderiza via scripts locais; produção → Lambda/worker (decisão pós-spike). Não criar rota `/api/render`. |
| R2 | Docs de autoridade não versionados | FACT | §2.3 | Commitar `docs/discovery/` antes da Wave 1 (fora desta rodada). |
| R3 | WIP não commitado no checkout principal toca `/videos`, `/imagens`, `/api/video-drafts`, `/api/image-drafts` (paginação/filtros de drafts; referencia `@/lib/draft-pagination` inexistente neste worktree) | FACT | `git diff --stat` no checkout principal | Spike não toca esses arquivos; coordenar merge antes de Wave 6. |
| R4 | Licença Remotion (uso comercial pode exigir Company License) | INFERENCE | conhecimento público; não verificado no repo | Confirmar licença antes de Wave 1 concluir. |
| R5 | Next 16 não citado na doc de compatibilidade Remotion (cita Next 15) | INFERENCE | §10 | Wave 1 prova `<Player>` em Next 16.2.4 com React 19.2.4. |
| R6 | Bundle Remotion (webpack próprio) não vê `@/` alias, Tailwind, `next/font` | INFERENCE (doc "Code sharing") | §9 | Template com inline styles; alias via `remotion.config.ts`; fontes via resolver. |
| R7 | `pnpm allowBuilds` pode bloquear binários Remotion | INFERENCE | `pnpm-workspace.yaml` | Registrar impacto na Wave 1. |
| R8 | Glob Vitest exclui `.test.tsx` | INFERENCE | `vitest.config.ts` | Testes do spike em `.test.ts`; propor ajuste separado. |
| R9 | Project Identity sem campos visuais → `VisualTokensSnapshot` só por fixture | FACT | §5 | Aceito pelo plano; Fixture C obrigatória para neutralidade. |
| R10 | `VideoScene.image_url` como base64 no JSONB | FACT | §7 | Importer futuro; não usar como AssetRef persistente. |
| R11 | Conflito HyperFrames-first (doc antigo) vs Remotion-first (docs novos) | FACT | §14 | Registrar supersessão explícita; Timeline Manifest continua neutra, então a troca de renderer não invalida o domínio. |
| R12 | Inconsistências entre docs novos (variants `standard` vs `info`; `footer` vs `detail_note`; campos `sequence`/`composition`/`role` fora do schema) | FACT | §14 | Fechar na Wave 2 antes de codar schemas. |
| R13 | `node_modules` ausente no worktree → nada foi executado | FACT | §2.1 | Wave 1 começa com `pnpm install` (aprovado) + `pnpm validate` baseline. |
| R14 | SVG aceito em `/arquivos` sem sanitização | FACT | §8 | Fora do spike; Harness H4. |
| R15 | Uso de fonte de fixture pode não ter licença de redistribuição | INFERENCE | — | Escolher fontes OFL para fixtures. |

---

## 14. Conflicts With Discovery Docs

Divergências reais entre documentos e repositório (ou entre documentos):

| # | Documento | Afirmação | Realidade | Reconciliação proposta |
| --- | --- | --- | --- | --- |
| C1 | `VIDEO_PRODUCTION_V0_DOMAIN §33` | HyperFrames = primeiro renderer; Remotion = ADIADO | Docs novos: Remotion = primeiro adapter | Registrar no `RESULTS` uma decisão explícita de supersessão ("Remotion primeiro para still+vídeo compartilhado; HyperFrames permanece candidato de adapter"). O domínio neutro absorve ambos. |
| C2 | `RENDER_ARCHITECTURE §4.2`, `TIMELINE_SCHEMA §15` | Fluxo passa por `VideoWork`, `ProductionArtifact`, approvals | NOT FOUND no repo | Refs `fixture:` no spike; `video_work_ref` opcional ou `video_draft_ref` alternativo na Wave 2. |
| C3 | `RENDER_ARCHITECTURE §5`, `TEMPLATE_REGISTRY §10` | Identity compila para tokens (typography, brand, surface) | Identity V1 é texto; `context-compiler` gera prompt | Compiler novo separado; snapshot por fixture; Identity não muda. |
| C4 | `TEMPLATE_REGISTRY §22`, `SPIKE_PLAN §5` | `lib/creative/schemas/` | Canônico é `lib/schemas/` | `lib/schemas/creative/` (§11). |
| C5 | `TEMPLATE_DESCRIPTOR §21` (`variants: ['cover','standard']`) vs `ANATOMY`/`FIXTURES`/handoff (`cover`, `info`) | Inconsistência interna | — | Registry anuncia apenas o implementado; alvo: `cover`, `info`. `standard` não existe. |
| C6 | `PORTAL_DOCUMENTARY_CARD_FIXTURE_V0.json` (`footer`, Terra Una) vs `FIXTURES §9` (`detail_note`, "O QUE SÃO COMUNIDADES ALTERNATIVAS?") vs `DESCRIPTOR §13` (content schema com `footer`, sem `detail_note`) | Dois fixtures canônicos com contratos de content diferentes | — | Wave 2 decide o `DocumentaryCoverContentSchema` (RECOMMENDATION: `eyebrow?, title, subtitle?, source_line?, detail_note?`; `footer` removido ou mapeado). O JSON existente vira teste de parsing do **schema base** (content é validado pelo template). |
| C7 | `FIXTURES §18/§29` pseudo-manifests usam `sequence`, `composition.{density,artifact_plan}`, `assets.hero.role` | `STATIC_RENDER_SCHEMA` é `.strict()` e não tem esses campos; `AssetRefSchema` não tem `role` | — | Wave 2: decidir se `sequence` entra em `context` (pagination é contexto de canal) e `composition` em `metadata` controlada ou em campo próprio; `role` fica no schema de assets do template, não no `AssetRef` base. |
| C8 | `TIMELINE_MANIFEST §18` | Campos legados `order, description, prompt, image_url, duration, movement` | Confere (+ `id`) | Sem conflito. |
| C9 | `SPIKE_PLAN Wave 4` = só `cover`; handoff = `cover` + `info` | Escopo | — | Wave 4 = `cover`; Wave 4b = `info` (gate separado), preservando "só anunciar o implementado". |
| C10 | `VISUAL_PRIMITIVE_LIBRARY §9` propõe metadata rica de primitive; `CREATIVE_PRIMITIVES_SCHEMA` não tem `PrimitiveRef` | Lacuna entre docs | — | Spike: primitives resolvidas por `AssetRef{type:'fixture'}`; `PrimitiveRef` adiado ao Harness. |
| C11 | `TYPOGRAPHY_FONT_CATALOG §2` "Project Settings → Identity → Typography" | UI de identity é dialog em `/projetos/[id]` (`ProjectIdentityForm`), não settings | — | Futuro: nova zona no dialog existente. |
| C12 | `STATIC_RENDER_MANIFEST §14` output → `LibraryFile → ChannelPieceMedia` | Suportado (`library_file_id`) | Sem conflito | — |
| C13 | Handoff: "Image Generator atual … permanecer intacto" | Confere; `images` ≠ stills renderizados | — | Stills nunca entram em `images`. |
| C14 | `SPIKE_PLAN §4` "10 slides poderão ser fornecidos" | Já fornecidos (Pack A = 10 PNG, Pack B = 2 PNG) | — | Wave 4 pode usar o pack desde o início. |

---

## 15. Reconciled Execution Waves

Todas as waves abaixo assumem: **nenhuma migration; nenhuma alteração em `lib/types.ts`, `lib/schemas/project-identity.ts`, `/api/image-drafts`, `/api/video-drafts`, `/imagens`, `/videos`; nenhuma rota de render em `app/api`.**

**Pré-Wave 1 (housekeeping, fora do spike):** commitar `docs/discovery/`; alinhar/mergear o WIP de drafts do checkout principal; `pnpm install` + `pnpm validate` como baseline verde.

**Wave 1 — Remotion Isolation Spike.** Instalar `remotion`, `@remotion/player`, `@remotion/bundler`, `@remotion/renderer` (+ `@remotion/cli` dev) na mesma versão; criar `remotion/index.ts`, `remotion/Root.tsx`, `remotion.config.ts`; hello-world `<Still>` 1080x1350 e `<Composition>` 1080x1920/30fps/180f com dados estáticos locais; `scripts/creative/render-still.mjs` e `render-video.mjs`; provar `<Thumbnail>` em uma página client mínima do Next (rota `dev/`), sem banco. Registrar: tempo de instalação, `allowBuilds`, tamanho de `node_modules`, impacto em `pnpm build`, compat Next 16. **Gate 1:** 1 PNG + 1 MP4 locais; `pnpm validate` continua verde.

**Wave 2 — Neutral Schemas.** `lib/schemas/creative/*` conforme §11, `.strict()`, `discriminatedUnion('kind')` na timeline, `z.infer` types, constantes de limite exportadas, `ValidationIssue`/`ValidationResult`; testes em `lib/schemas/creative/__tests__/*.test.ts` (fixture JSON do Portal válida; inválidas previsíveis; teste "nenhum import de remotion"). Fechar C5, C6, C7 e `video_work_ref` (C2) como decisões escritas no topo de cada schema. **Gate 2:** testes passam.

**Wave 3 — Runtime Resolution Layer.** `registry.ts` (Map estático), `resolve-identity-snapshot.ts` (fixtures A/Portal e C/neutro), `resolve-asset.ts` (`fixture` → `public/creative-fixtures`), `resolve-static-render.ts`, `resolve-timeline.ts` + `validateTimelineSemantics`, template placeholder. **Gate 3:** `ResolvedStaticRenderInput` e `ResolvedTimelineInput` produzidos sem Remotion nos contratos.

**Wave 4 — Editorial Documentary Card `cover` (organic-collage).** `components/creative/templates/editorial-documentary-card/` + primitives mínimas (Surface, SequenceMarker, BrandSignature, TornPaper, Tape, ArtifactFrame), `layout-by-canvas.ts`, inline styles, `frame` por props, fontes via `resolve-font` (fixtures OFL locais). Pack B slide 1 como referência; Pack A para hierarquia. **Gate 4:** mesmo componente coerente em 4:5 e 9:16.
**Wave 4b — variant `info`** (Pack B slide 2; sem hero; 1–2 fact cards). Gate próprio.

**Wave 5 — Static Render Path.** manifest → validate → resolve → props → `<Thumbnail>` → `renderStill` → PNG, com diagnostics; evidência salva em `.tmp/creative/` (ignorado). **Gate 5:** PNG 1080x1350 consistente com preview.

**Wave 6 — Authoring Preview Proof.** Rota técnica `app/(dashboard)/dev/creative-preview/page.tsx` (não no sidebar): inputs title/subtitle/eyebrow/source/detail, troca de hero (fixtures), variant, canvas, focal point; estado local → manifest → resolve → `<Thumbnail>`. **Gate 6:** editar título muda o preview sem JSON.

**Wave 7 — Timeline / Video Path.** Fixture `timeline/documentary-card-reel.json` (1 track, 1 template segment, `slow_push`), adapter `Sequence`, `<Player>`. **Gate 7:** 6 s coerentes com o still.

**Wave 8 — Video Render.** `render-video.mjs` → MP4; registrar fps/dimensões/duração/versão/warnings/tempo. **Gate 8:** MP4 válido.

**Wave 9 — Visual QA / Parity.** Still vs frame inicial/final; stress (título longo, sem subtítulo, imagem horizontal/vertical, focal extremo, canvas/motion não suportados); **Fixture C (segundo Project) obrigatória**. **Gate 9:** sem divergência silenciosa.

**Wave 10 — Verdict.** `SHARED_CREATIVE_RENDERING_SPIKE_RESULTS.md` com `PROCEED | PROCEED_WITH_CONSTRAINTS | REVISIT_RENDERER`, incluindo a decisão de infraestrutura de render (Lambda vs worker) e a supersessão C1.

---

## 16. Gate 0 Verdict

**`PASS_WITH_CONSTRAINTS`**

Evidência a favor (FACT): fundações reutilizáveis existem e são compatíveis (Project Identity Zod `.strict()`, Production/EditorialContent/ChannelPiece/ChannelPieceMedia com `library_file_id`, LibraryFile + S3 presign + URLs assinadas em leitura, VideoDraft com os campos exatamente previstos, padrão de schema/teste claro, React 19 suportado por Remotion, stack TS/Node adequado ao Harness); nenhuma área do spike exige migration ou alteração de comportamento atual; Remotion pode entrar isolado em `remotion/` + `lib/creative/renderers/remotion/` sem tocar domínio.

Constraints obrigatórias:
1. **Render fora da Vercel:** o spike renderiza via scripts locais; nenhuma rota `app/api/*` importa `@remotion/renderer`/`@remotion/bundler`. Infra de render de produção (Lambda/worker) é decisão pós-spike.
2. **Docs devem ser commitados** (`docs/discovery/` não rastreado) antes de qualquer wave que dependa deles como autoridade compartilhada.
3. **Identity intocada:** `VisualTokensSnapshot` só por fixture (Portal + segundo Project neutro); `snapshot_ref` fixture-only.
4. **Templates sem Tailwind/globals.css/next-font/aliases não resolvidos** — inline styles + tokens por props; fontes via resolver; `frame` por props.
5. **Package files só na Wave 1**, com aprovação explícita (incluindo eventual `allowBuilds`).
6. **Resolver C5/C6/C7/C2 na Wave 2** antes de escrever os schemas.
7. **Coordenar com o WIP** de drafts do checkout principal; o spike não toca `/videos`, `/imagens`, `/api/video-drafts`, `/api/image-drafts`.
8. **Confirmar licença Remotion** para o uso pretendido antes de fechar a Wave 1.

Nenhum blocker real foi encontrado para o plano na forma de spike local. O único blocker seria para "render em produção dentro do Next na Vercel" — e isso já está explicitamente fora do escopo dos docs (`SPIKE_PLAN Wave 8: proibido Lambda/render farm/infra definitiva`).

---

## 17. Recommended Next Implementation Mission

**Missão: Wave 1 — Remotion Isolation Spike (sem integração de domínio).**

Escopo exato:
1. Pré-requisito no chat: confirmar que `docs/discovery/` foi (ou será) commitado e que o WIP de drafts do checkout principal não será tocado.
2. `pnpm install` + `pnpm validate` baseline (registrar resultado; verificar hipótese R8 do glob Vitest).
3. Adicionar `remotion`, `@remotion/player`, `@remotion/bundler`, `@remotion/renderer` (mesma versão 4.0.x) e `@remotion/cli` (dev); registrar mudanças em `package.json`/`pnpm-lock.yaml`/`pnpm-workspace.yaml` (`allowBuilds`, se necessário).
4. Criar `remotion/index.ts`, `remotion/Root.tsx` (1 `<Still>` 1080x1350 + 1 `<Composition>` 1080x1920, 30 fps, 180 frames; props estáticas locais, sem fixture do Portal), `remotion.config.ts` (alias `@/` só se necessário).
5. Criar `scripts/creative/render-still.mjs` e `scripts/creative/render-video.mjs` (bundle + renderStill/renderMedia → `.tmp/creative/`; adicionar `.tmp/` ao `.gitignore` se ainda não estiver — está listado apenas como untracked no checkout principal).
6. Criar página client mínima `app/(dashboard)/dev/creative-preview/page.tsx` com `<Thumbnail>` do mesmo componente (não adicionar ao `sidebar-navigation.ts`).
7. Teste `lib/creative/__tests__/renderer-isolation.test.ts` (grep: nenhum `remotion` import fora de `remotion/`, `lib/creative/renderers/remotion/`, `components/creative/**` e da rota dev).
8. Fechar com: changes, tests, evidence (PNG + MP4 + tempos + tamanho de install + impacto em `pnpm build`), known limitations (Vercel, Next 16, licença), **Gate 1 result**.

Proibido na Wave 1: banco, Template Registry definitivo, fixture do Portal, alterar `/videos` ou `/imagens`, rotas de render em `app/api`, Lambda.

---

## Anexo A — Respostas explícitas às 16 questões arquiteturais

1. **Onde a layer deve viver?** Schemas em `lib/schemas/creative/`; runtime em `lib/creative/{identity,fonts,assets,templates,resolve,renderers,fixtures}`; componentes em `components/creative/`; entry Remotion em `remotion/`; scripts em `scripts/creative/`; fixtures binárias em `public/creative-fixtures/` (§11). RECOMMENDATION.
2. **Paths dos docs que fazem sentido:** `templates/registry.ts`, `templates/system/editorial-documentary-card/`, `renderers/remotion/`, `fixtures/`, `identity/`, `assets/` (todos sob `lib/creative/`).
3. **Paths que não fazem sentido:** `lib/creative/schemas/` (canônico é `lib/schemas/`); React dentro de `lib/`; `tests/` separado (repo usa `__tests__/` colocalizado e glob `lib/**/*.test.ts`).
4. **Abstrações existentes a reutilizar:** `ProjectIdentitySchema`/normalizer (consumo), padrão `context-compiler`, `LibraryFile` + `lib/storage/s3.ts` (`createPresignedReadUrl`, `uploadLibraryFile`), `resolveMediaSource` (padrão), `ChannelPieceMedia.library_file_id` como destino, `VideoScene` como fonte de importer, `sharp` para inspeção raster, padrão de teste `renderToStaticMarkup`, `MediaPickerDialog` como base de "escolher asset para slot".
5. **Contratos realmente novos:** `CanvasSpec`, `TemplateRef`, `IdentitySnapshotRef`, `AssetRef`, `VisualTokensSnapshot`, `MotionSpec`, `TransitionSpec`, `StaticRenderManifest`, `TimelineManifest`, `TemplateDescriptor`, `TemplateComponentProps`, `ValidationIssue`, `FontRef`.
6. **StaticRenderManifest + sistema atual:** aditivo; nasce de `ChannelPiece`/`EditorialContent`/`fixture`; output futuro → `LibraryFile` → `ChannelPieceMedia`; nunca em `images`; sem tabela no V0.
7. **TimelineManifest + VideoDraft:** coexistem; `VideoScene[]` alimenta um importer → Scene Plan draft → Assembly → Timeline; `video_drafts.scenes` não é promovido diretamente; `video_work_ref` fixture/opcional até VideoWork existir.
8. **Evitar duplicar asset infra:** `AssetRef{type:'library_file'}` resolve pela mesma `createPresignedReadUrl`; upload continua `presign → /api/library-files` ou `/api/channel-piece-media/upload`; fixtures locais só no spike; primitives `system` em código/`public/` até haver decisão de escopo.
9. **Identity → VisualTokensSnapshot:** hoje só por fixture; futuro via zona opcional nova no schema (aditiva, `schema_version` 1 mantido se opcional) + `compile-visual-identity.ts`; `snapshot_ref` deve carregar versão (`updated_at`/hash) porque identity não é versionada.
10. **Registry estático sem banco?** Sim — `Map` em `lib/creative/templates/registry.ts`, registrado em `system/*/index.ts`; docs e repo concordam.
11. **Menor caminho para Remotion isolado:** §10/§17 — `remotion/` entry + scripts Node + `<Thumbnail>` em rota dev; nenhum import em domínio; nenhuma rota de API.
12. **Preview e final com a mesma árvore?** Sim, se o template for React puro com inline styles, `frame` por props e fontes resolvidas — consumido por `@remotion/player` no Next e pelo bundle Remotion no render. Restrições em §9 (R6).
13. **Riscos de build/deploy:** Vercel 50 MB (render impossível), bundle webpack separado, `allowBuilds`, Next 16 não listado, glob Vitest, ausência de CI, `node_modules` ausente no worktree (§13).
14. **Dependências mínimas:** `remotion`, `@remotion/player`, `@remotion/bundler`, `@remotion/renderer` (+ `@remotion/cli` dev); fontes locais OFL; nada de Python/fila/Lambda (§12).
15. **O que NÃO fazer no primeiro spike:** migrations; tocar Identity/ImageDraft/VideoDraft/`/imagens`/`/videos`; rota `/api/render`; Tailwind no template; hardcode Portal (fixtures identificadas); `standard`/variants não implementadas; Library UI; SVG sanitizer; Lambda; persistir manifests; usar tokens de UI do DS como tokens de Project.
16. **Blocker real?** Não para o spike local. Blockers condicionais: render em produção na Vercel (exige Lambda/worker — decisão pós-spike) e licença Remotion (verificar).
