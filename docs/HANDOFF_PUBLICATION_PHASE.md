# Handoff — Fase de Publicações (P1–P6) + ChannelPiece Media (M1–M7) + M8 Migration + M9 Retirement + M10 Discovery + M10-A Archive
**Data última atualização:** 2026-06-25  
**Branch P1–P6:** `feat/publication-p6-post-video-flow` — integrado em main em 2026-06-22  
**Branch M1–M5:** `feat/channel-piece-media-m5-upload` — integrado em main em 2026-06-24  
**Branch M6:** `feat/channel-piece-media-m6-organization` — integrado em main em 2026-06-24 (commit `e4da6b8`)  
**Branch M7:** `feat/channel-piece-media-m7-video` — integrado em main em 2026-06-24 (commit `fdee92d`)  
**Branch M8 Discovery:** `discovery/posts-to-editorial-content-m8` — concluído (2026-06-24)  
**Branch M8.1:** `feat/posts-migration-m8-dry-run` — concluído (2026-06-24), commit `a6bf7e5`  
**Branch M8.2:** `feat/posts-migration-m8-schema` — concluído (2026-06-24)  
**Branch M8.3A executor:** `feat/posts-migration-m8-executor` — P2/P4/P3 migrados (2026-06-24). Não integrado a main.  
**Branch M8.4 executor:** `feat/posts-migration-m8-4-p1-media` — P1 migrado com mídia (2026-06-24). Não integrado a main.  
**Branch M8.5A auditoria:** `feat/posts-migration-m8-5a-audit` — 139/139 PASS, determinístico (2026-06-24). Não integrado a main.  
**Branch M8.5B legacy marking:** `feat/posts-migration-m8-5b-legacy-marking` — DEPLOYADO (2026-06-24). Merge `0e412ed`. Tag `pre-posts-legacy-marking-m8-5b-release-2026-06-24`. Smoke produção 6/6 PASS.  
**Branch M9:** `feat/posts-legacy-retirement-m9` — DEPLOYADO (2026-06-24). Merge `9b1bed7`. Tag `pre-posts-legacy-retirement-m9-release-2026-06-24`. Smoke visual aprovado.  
**Branch M10 Discovery:** `discovery/project-workspace-consolidation` — concluído (2026-06-24). Somente leitura. Integrado a main antes do M10-A.  
**Branch M10-A:** `feat/project-archive-production-m10a` — CONCLUÍDO (2026-06-25). Production "Arquivo — Alquimia Cibernética" criada. 4 ImageDrafts + 2 VideoDrafts atribuídos. 3 testes preservados.  
**Estado:** M1–M9 em produção. Posts aposentados operacionalmente. M10-A concluído — registros reais consolidados. Próximos: M10-B (simplificação da página do Projeto), Project Identity (fase futura).

---

## M10 Discovery — Consolidação do Workspace do Projeto — 2026-06-24

**Branch:** `discovery/project-workspace-consolidation`  
**Status:** Discovery concluído — somente leitura. Aguarda decisões humanas antes de implementação.

### Documentos criados

| Documento | Conteúdo |
|-----------|---------|
| `docs/PROJECT_WORKSPACE_DISCOVERY.md` | Auditoria da página do Projeto, APIs, dados sem Production, fluxos paralelos, riscos |
| `docs/PROJECT_PRODUCTION_CONSOLIDATION_PLAN.md` | Proposta da nova página, atribuição de registros, fases, validação, rollback |
| `docs/PROJECT_IDENTITY_DISCOVERY.md` | Campos atuais, conceitos desejados, lacunas, perguntas de domínio |

### Estado atual da página do Projeto

| Tab | Dados | Criação via | Status |
|-----|-------|------------|--------|
| Imagens | `image_drafts` por `project_id` | `/imagens?project=P` | ⚠️ bypassa Production |
| Vídeos | `video_drafts` por `project_id` | `/videos?project=P` | ⚠️ bypassa Production |
| Produções | `productions` por `project_id` | Modal inline | ✅ correto |

### Registros sem Production — estado pós-M10-A (banco — 2026-06-25)

| Tabela | Total | sem production_id | Projeto |
|--------|-------|------------------|---------|
| `image_drafts` | 7 | **2** *(eram 6 — M10-A atribuiu 4)* | Alquimia Cibernética (testes) |
| `video_drafts` | 4 | **1** *(eram 3 — M10-A atribuiu 2)* | Alquimia Cibernética (teste) |
| `editorial_contents` | 7 | **2** | Content Agent (ambos — teste) |
| `images` (geradas) | 15 | n/a (sem campo) | — |
| `library_files` | 4 | n/a (sem campo) | — |

### Próximas decisões necessárias

1. ~~Criar Production "Arquivo — Alquimia Cibernética"~~ ✅ FEITO M10-A
2. Remover abas Imagens e Vídeos da página do Projeto (M10-B)?
3. Deletar registros classificados como REGISTRO DE TESTE?
4. Iniciar discovery de Project Identity (campos adicionais no schema)?

---

## M10-A — Production de Arquivo: Alquimia Cibernética — 2026-06-25

**Branch:** `feat/project-archive-production-m10a`  
**Status:** CONCLUÍDO. Production criada e 6 drafts reais atribuídos. 3 testes preservados.

### O que foi feito

| Ação | Resultado |
|------|-----------|
| Production criada | "Arquivo — Alquimia Cibernética" (`76120099`) · tipo: `editorial` |
| 4 ImageDrafts atribuídos | `c44bf448`, `97508404`, `e624d457`, `0eb2a983` |
| 2 VideoDrafts atribuídos | `f1029001`, `d46d2259` |
| 3 testes preservados | `d52b83b6`, `8c5bbdb7`, `0bc4324c` — `production_id = NULL` |
| Manifesto gerado | `docs/migrations/project-archive-m10a.json` + `.md` |
| Rollback disponível | `scripts/project_archive_production_m10a_rollback.mjs` |

### Checklist de validação pré-M10-B

```
[ ] Smoke visual: página da Production "Arquivo — Alquimia Cibernética"
[ ] Smoke visual: cada um dos 4 ImageDrafts acessível via Production
[ ] Smoke visual: cada um dos 2 VideoDrafts acessível via Production
[ ] Confirmar: 3 testes sem production_id (não aparecem em nenhuma Production)
[ ] pnpm validate: 0 erros / build pass
```

---

## M8 Discovery — Migração dos Posts Legados — 2026-06-24

**Branch:** `discovery/posts-to-editorial-content-m8`  
**Status:** Discovery concluído — somente leitura. Aguarda decisões humanas antes de migration real.

### Inventário

| Posts totais | Usuários | Projetos | Productions | Com mídia |
|-------------|----------|----------|-------------|-----------|
| 4 | 1 | 1 | 1 | 1 (P1) |

Todos os 4 posts são registros de smoke/teste criados em 2026-06-23 (mesmo dia do release M1–M6).  
Nenhum post de conteúdo real identificado na base de produção.

### Classificação

| Post | Name | Classificação |
|------|------|--------------|
| P1 (`d02a9507`) | Teste Post Smoke Test 01 | MIGRÁVEL COM IMPORTAÇÃO DE MÍDIA |
| P2 (`7eb9ccf4`) | outro teste de post | AUTO_MIGRÁVEL |
| P3 (`083a69d5`) | outro teste de story | EXIGE ATRIBUIÇÃO DE PROJETO |
| P4 (`7aa6b5a4`) | teste 04 | AUTO_MIGRÁVEL |

### Decisões pendentes

| # | Questão | Impacto |
|---|---------|---------|
| H1 | Confirmar `project_id = d0d008c3` para P3 | Desbloqueia P3 |
| H2 | Importar PNG de P1 para `library_files`? | Desbloqueia P1 |
| H3 | Migrar os 4 posts de teste ou descartá-los? | Define lote da migration |
| H4 | Status do EditorialContent pós-migração (`ready` vs outro)? | Define estado inicial |

### Documentos de M8

- [`docs/POSTS_MIGRATION_DISCOVERY.md`](./POSTS_MIGRATION_DISCOVERY.md) — inventário, mídia, dependências, riscos, classificações
- [`docs/POSTS_MIGRATION_MAPPING.md`](./POSTS_MIGRATION_MAPPING.md) — matriz campo a campo, destino por Post, candidatos a agrupamento
- [`docs/POSTS_MIGRATION_PLAN.md`](./POSTS_MIGRATION_PLAN.md) — fases, dry-run, idempotência, rollback, critérios go/no-go

### Estado das fases M8

| Fase | Status |
|------|--------|
| H1–H4 decisões | ✅ APROVADAS 2026-06-24 |
| M8.1 Dry-run | ✅ READY — 4/4, 0 blockers, script `scripts/posts_migration_dry_run.mjs` |
| M8.2 Schema `legacy_post_id` | ✅ APLICADO 2026-06-24 — migration 025, branch `feat/posts-migration-m8-schema`, merge `1b7be2b` |
| M8.3A Migrar P2/P4/P3 | ✅ EXECUTADO 2026-06-24 — 3/3 migrados, branch `feat/posts-migration-m8-executor` |
| M8.4 Migrar P1 com mídia | ✅ EXECUTADO 2026-06-24 — EC+CP+LF+CPM, branch `feat/posts-migration-m8-4-p1-media` |
| M8.5A Post-migration audit | ✅ PASS 2026-06-24 — 139/139, determinístico, branch `feat/posts-migration-m8-5a-audit` |
| M8.5B Legacy Marking | ✅ DEPLOYADO 2026-06-24 — merge `0e412ed`, smoke produção 6/6, tag rollback criada |
| M8.6 Cleanup Posts | ⏳ |

### M8.3A — Resultados da execução — 2026-06-24

**Branch:** `feat/posts-migration-m8-executor` (não integrado a main — aguarda M8.4)  
**Tag pré-migração:** `pre-posts-migration-m8-2026-06-24` → `1b7be2b`  
**Scripts:** `scripts/posts_migration_execute.mjs`, `scripts/posts_migration_rollback.mjs`  
**Manifesto:** `docs/migrations/posts-m8-execution-m8-3a.json`

| Post | Nome | EC criado | CP criado | canal/formato |
|------|------|-----------|-----------|---------------|
| P2 `7eb9ccf4` | outro teste de post | `0d4ee522-db02-4766-98aa-d02b2faf1ea1` | `64e5bbb3-f8cf-46eb-bafa-2d420d03c6bc` | youtube/post |
| P4 `7aa6b5a4` | teste 04 | `d0138557-ad57-4284-bcdc-322c21c8f599` | `ba9d1e7d-38c7-4ca0-8251-a72bdaddce64` | youtube/video_description |
| P3 `083a69d5` | outro teste de story | `bee05422-04e7-4c80-9d82-ba504303e37d` | `05772802-06d7-4249-bae8-d8b8e11b7457` | instagram/story |

**Snapshot antes:** EC=3 (legacy=0), CP=2, posts=4  
**Snapshot depois:** EC=6 (legacy=3), CP=5, posts=4  
**posts: INTACTOS** (status=saved, updated_at inalterado). **S3: não tocado.**

**Verificações pós-migração:**  
✅ EC.legacy_post_id = posts.id: 3/3  
✅ EC.project_id = d0d008c3 (H1 aplicado a P3): 3/3  
✅ EC.status = draft: 3/3  
✅ CP vinculados: 3/3  
✅ cpm_count = 0: 3/3  
✅ Idempotência: re-run → ALREADY_MIGRATED 3/3  
✅ typecheck: 0 erros | lint: 0 erros | build: exit 0

**Rollback disponível (se necessário):**
```bash
POSTS_MIGRATION_ROLLBACK_CONFIRM=M8_3A_ROLLBACK_APPROVED \
node scripts/posts_migration_rollback.mjs --execute
```
Remove CP → EC nesta ordem. Nunca toca posts, library_files ou S3.

### M8.4 — P1 com mídia — 2026-06-24 — EXECUTADO

**Branch:** `feat/posts-migration-m8-4-p1-media` (não integrado a main)  
**Scripts:** `scripts/posts_migration_m84_execute.mjs`, `scripts/posts_migration_m84_rollback.mjs`  
**Manifesto:** `docs/migrations/posts-m8-execution-m8-4.json`

| Entidade | ID |
|----------|----|
| EC | `16a0bfea-b558-4f26-91ec-2e163d84f9b0` |
| CP (instagram/feed) | `2a48076c-3aff-4c53-beaf-cd84e028cffd` |
| LF | `f190c6ad-8ad1-490c-aeaa-3898b69bb0aa` |
| CPM (primary, pos 0) | `d71eed1d-068b-47ed-aae1-278ca6922cf8` |

**S3:** `content-studio/users/.../library/posts-migration-m8/d02a9507.../Content-Agent-Studio-Future-Vision-Concept.png` (1.293.601 bytes, COPY da origem)  
**Origem S3:** preservada intacta (`posts/{3f142fc2}/...`)  
**thumbnail_url:** null (nullable; thumbnail original preservada no namespace posts/)  

**Snapshot antes:** EC=6 (legacy=3), CP=5, LF=3, CPM=0, posts=4  
**Snapshot depois:** EC=7 (legacy=4), CP=6, LF=4, CPM=1, posts=4  

✅ 18/18 verificações | ✅ idempotência (ALREADY_MIGRATED) | ✅ posts intactos | ✅ S3 source intacto

**Rollback disponível:**
```bash
POSTS_MIGRATION_M84_ROLLBACK_CONFIRM=M8_4_ROLLBACK_APPROVED \
node scripts/posts_migration_m84_rollback.mjs --execute
```

### M8.5A — Post-Migration Audit — 2026-06-24 — PASS

**Branch:** `feat/posts-migration-m8-5a-audit` (não integrado a main)  
**Script:** `scripts/posts_migration_post_audit.mjs` (read-only — sem INSERTs, UPDATEs, DELETEs, mutações S3)  
**Artefatos:** `docs/migrations/posts-m8-post-audit.json`, `docs/migrations/posts-m8-post-audit.md`

| Métrica | Valor |
|---------|-------|
| Total de checks | 139 |
| PASS | 139 |
| FAIL | 0 |
| Execuções para determinismo | 2 (idênticas) |

**Checks por seção:**

| Seção | Checks | Resultado |
|-------|--------|-----------|
| B — Global (EC/CP/LF/CPM counts, fingerprints) | 9 | ✅ |
| C — P1: C01-C20 + M01-M15 (media chain) + S01-S09 (S3) | 44 | ✅ |
| C — P2: C01-C22 | 22 | ✅ |
| C — P3/H1: C01-C20 + H01-H03 | 23 | ✅ |
| C — P4: C01-C22 | 22 | ✅ |
| D — Manifests cross-reference | 8 | ✅ |
| E — Rollback scripts inspection | 12 | ✅ |

**Destaques:**
- 4/4 fingerprints: aprovados = observados ✅
- P3/H1: `post.project_id=NULL` preservado, `EC.project_id=d0d008c3` → PASS H1 APPLIED (deliberate divergence)
- P1/S3: source ETag = dest ETag = `7997848a1fcbfd6193dc2f867d65a4b1` ✅
- 0 EC/CP/LF/CPM órfãos | 0 duplicações
- Rollback M8.3A + M8.4: disponíveis, NOT EXECUTED
- Posts intactos (status=saved, untouched)
- Visual review: REQUIRED (URLs em `docs/migrations/posts-m8-post-audit.md`)

**Validação técnica:** typecheck ✅ 0 erros | lint ✅ 0 erros | build ✅ exit 0

### M8.5B — Legacy Marking — 2026-06-24 — CONCLUÍDO

**Branch:** `feat/posts-migration-m8-5b-legacy-marking` (não integrado a main)  
**Scripts:** `scripts/posts_migration_m85b_mark.mjs`, `scripts/posts_migration_m85b_rollback.mjs`  
**Testes:** `scripts/posts_m85b_tests.mjs` — 15/15 PASS  
**Migration:** `scripts/026_add_posts_migrated_at.sql` — aplicada em 2026-06-24

**Schema:** `migrated_at TIMESTAMPTZ NULL` adicionado à tabela `posts`.

| Post | migrated_at | Resultado |
|------|-------------|-----------|
| P1 `d02a9507` | 2026-06-24T20:59:57.181+00:00 | ✅ MARKED |
| P2 `7eb9ccf4` | 2026-06-24T20:59:57.181+00:00 | ✅ MARKED |
| P3 `083a69d5` | 2026-06-24T20:59:57.181+00:00 | ✅ MARKED |
| P4 `7aa6b5a4` | 2026-06-24T20:59:57.181+00:00 | ✅ MARKED |

**Idempotência:** 2ª execução → ALREADY_MARKED 4/4 ✅

**API protegida:**
- `GET /api/posts` → 200; resposta inclui `migrated_ec_id` + `migrated_ec_project_id` para posts migrados
- `PATCH /api/posts` com post migrado → HTTP 409 `POST_MIGRATED`
- `DELETE /api/posts` com post migrado → HTTP 409 `POST_MIGRATED`
- `POST /api/posts` sem sessão → HTTP 401
- `POST /api/posts` autenticado → HTTP 410 `{ code: "LEGACY_POST_CREATION_DISABLED", error: "A criação de Posts legados foi encerrada. Use Conteúdos." }`

**Testes autenticados (10/10 PASS — sessão real via admin generateLink):**

| Teste | Resultado |
|-------|-----------|
| GET sem sessão → 401 | ✅ |
| PATCH sem sessão → 401 | ✅ |
| DELETE sem sessão → 401 | ✅ |
| POST sem sessão → 401 | ✅ |
| GET autenticado P1 → 200 + migrated_ec_id | ✅ |
| PATCH autenticado P1 migrado → 409 POST_MIGRATED | ✅ |
| DELETE autenticado P1 migrado → 409 POST_MIGRATED | ✅ |
| POST autenticado → 410 LEGACY_POST_CREATION_DISABLED | ✅ |
| Contagem posts pós-testes = 4 | ✅ |
| P1–P4 status=saved, migrated_at intacto | ✅ |

**UI:**
- Badge âmbar "Migrado" em cada item da lista
- Link "Ver Conteúdo Editorial" no item (dropdown) e no editor
- Editor somente leitura para posts marcados (readOnly/disabled em todos os campos)
- Auto-save desabilitado para posts marcados
- Botão "Novo Post" desabilitado (área em modo legado)

**Validação técnica:** typecheck ✅ lint ✅ (51 warnings, 0 erros) build ✅ validate ✅

**Lacuna encontrada e corrigida:** `POST /api/posts` aceitava criação com sessão autenticada. Corrigido — agora retorna 410 antes de qualquer lógica de inserção. Nenhum dado criado durante o teste (registro de teste deletado via service role imediatamente).

**Rollback disponível:**
```bash
POSTS_MIGRATION_M85B_ROLLBACK_CONFIRM=M8_5B_ROLLBACK_APPROVED \
node scripts/posts_migration_m85b_rollback.mjs --execute
```
Zera `migrated_at` nos 4 posts. Não toca EC/CP/LF/CPM/S3.

### Release M8.5B — 2026-06-24 — APROVADO

**Merge commit:** `0e412ed` — `feat: integrate legacy Posts marking M8.5B`  
**Tag de rollback:** `pre-posts-legacy-marking-m8-5b-release-2026-06-24` → `1b7be2b`  
**Deploy:** Vercel auto-deploy de `main` — `content.multihuman.com.br`

**Smoke público (pós-deploy):**

| Check | Resultado |
|-------|-----------|
| `/login` → 200 | ✅ |
| `/posts` sem auth → 307 /login | ✅ |
| GET /api/posts sem auth → 401 | ✅ |
| PATCH /api/posts sem auth → 401 | ✅ |
| POST /api/posts sem auth → 401 | ✅ |
| DELETE /api/posts sem auth → 401 | ✅ |

**Smoke autenticado em produção (6/6 PASS):**

| Check | Resultado |
|-------|-----------|
| GET P1 migrado → 200 + migrated_ec_id | ✅ |
| PATCH P1 migrado → 409 POST_MIGRATED | ✅ |
| DELETE P1 migrado → 409 POST_MIGRATED | ✅ |
| POST /api/posts → 410 LEGACY_POST_CREATION_DISABLED | ✅ |
| Total posts = 4, todos migrados | ✅ |
| DB: status=saved, migrated_at intacto (4/4) | ✅ |

**Auditoria final:**
- Posts total: 4 ✅ · Posts migrados: 4 ✅ · Unmigrated: 0 ✅
- ECs com legacy_post_id: 4 ✅ · 1:1 confirmado ✅
- P1 CPM: 1 ✅ · LF: 1.293.601 bytes, kind=image ✅
- S3 destination: `users/35428fd4.../library/posts-migration-m8/d02a9507.../Content-Agent-Studio-Future-Vision-Concept.png` ✅
- Rollbacks M8.3A e M8.4 disponíveis e não executados

### Release M9 — Aposentadoria Operacional de Posts — 2026-06-24 — APROVADO

**Branch:** `feat/posts-legacy-retirement-m9`  
**Merge commit:** `9b1bed7` — `feat: retire legacy Posts from primary experience M9`  
**Tag de rollback:** `pre-posts-legacy-retirement-m9-release-2026-06-24` → `7ea51d3`  
**Deploy:** Vercel auto-deploy de `main` — `content.multihuman.com.br`

**Escopo:**

| Item | Mudança |
|------|---------|
| `app/(dashboard)/conteudos/page.tsx` | Removido link "Acessar Publicações legadas → /posts" |
| `app/(dashboard)/projetos/[id]/producoes/[productionId]/page.tsx` | Removidos: tab "Posts legados", estado, fetch, tipo, handleUnlink e botão "Criar Publicação" → /posts |
| `app/(dashboard)/posts/page.tsx` | Header → "Arquivo legado de Posts"; descrição → somente leitura; banner âmbar de arquivo |

**Preservado:**
- `app/api/posts/route.ts` — intacto (GET/PATCH/DELETE/POST 410)
- `/posts` — rota preservada, acessível por URL direta com autenticação
- `lib/supabase/middleware.ts` — `/posts` em protectedPaths
- `QuickFlowDialog` em vídeos — preservado (cria EC+CP)
- Tabela `posts` — 4 linhas, todas migradas, intocadas
- S3 — zero alterações

**Smoke visual aprovado pelo usuário (branch `feat/posts-legacy-retirement-m9`):**
- Conteúdos: sem link para Posts legados ✅
- Production: sem tab "Posts legados", sem botão antigo ✅
- QuickFlow e Publicação rápida: funcionando ✅
- `/posts`: acessível, título "Arquivo legado de Posts", banner âmbar, 4 posts, badges "Migrado", links "Ver Conteúdo Editorial", sem ações destrutivas ✅

**Smoke público pós-deploy:**
- `/login` → 200 ✅
- `/conteudos` sem sessão → redireciona para /login ✅
- `/posts` sem sessão → redireciona para /login ✅
- `GET /api/posts` sem sessão → 401 ✅
- `POST /api/posts` sem sessão → 401 ✅
- `PATCH /api/posts` sem sessão → 401 ✅

**API autenticada (contratos verificados em M8.5B — código não alterado no M9):**
- `GET /api/posts` autenticado → 200 + enrichment EC ✅
- `POST /api/posts` autenticado → 410 `LEGACY_POST_CREATION_DISABLED` ✅
- `PATCH /api/posts` migrado → 409 `POST_MIGRATED` ✅
- `DELETE /api/posts` migrado → 409 `POST_MIGRATED` ✅

**Auditoria de dados pós-M9:**
- posts total: 4 ✅ · migrados: 4 ✅ · novos: 0 ✅
- ECs com legacy_post_id: 4 ✅ · CPs: 4 ✅ · P1 CPM: 1 ✅
- status=saved: 4/4 ✅ · migrated_at intacto: 4/4 ✅

**Validação técnica:** typecheck ✅ (0 erros) · lint ✅ (51 warnings, 0 erros) · build ✅ · validate ✅

**Rollback M9 (se necessário):**
```bash
git checkout pre-posts-legacy-retirement-m9-release-2026-06-24
# ou
git revert 9b1bed7  # reverte o merge commit
```
Sem migration associada — rollback é puramente de código.

### Critérios para M10 (remoção definitiva)

M10 deve aguardar período de observação prolongado (mínimo 4–8 semanas) confirmando:
- Nenhum usuário acessa `/posts` diretamente por hábito residual
- Nenhum fluxo interno depende da tabela `posts`
- Auditoria SQL confirmando zero novos posts criados após M9

M10 inclui (exige autorização explícita separada):
- `DROP TABLE posts` (migration irreversível)
- Remoção de `app/api/posts/route.ts`
- Remoção de `app/(dashboard)/posts/page.tsx`
- Remoção de `/posts` de `middleware.ts`
- Remoção de tipos `Post`, `PostImage`, `PublicationType`
- Limpeza de S3 namespace `posts/` (objetos físicos)
- Remoção dos scripts de migração e rollback M8

---

---

## Release ChannelPiece Media M7 — 2026-06-24 — APROVADO

**Merge commit:** `fdee92d` — `feat: integrate ChannelPiece video media M7`  
**Tag de rollback:** `pre-channel-piece-media-m7-release-2026-06-24` → `fb8fb65`  
**Branch integrado:** `feat/channel-piece-media-m7-video` → `main`  
**Deploy:** Vercel auto-deploy de `main` — domínio `content.multihuman.com.br` — região `gru1`

### Entregas

| Arquivo | Mudança |
|---------|---------|
| `app/api/channel-piece-media/[id]/download/route.ts` | Novo — endpoint de download seguro (302 → S3 signed URL `attachment`) |
| `components/publication/channel-piece-media-section.tsx` | Badge "Vídeo", Play (preview modal `<video>`), Download em `MediaItemEditable` e `MediaItemReadOnly` |
| `components/publication/media-picker-dialog.tsx` | Filtros Todos/Imagens/Vídeos, badge Vídeo, file_size no `LibraryCard` |
| `app/(dashboard)/projetos/[id]/conteudos/[editorialContentId]/page.tsx` | Fix regressão: card ChannelPiece não atualizava após salvar — `cpSaveCount` remonta seção de mídia; CTA exibido no card |
| `scripts/cpm_m7_tests.mjs` | Suite 53 casos + fix asserção #15 (`sanitizeFilename` converte `[TESTE CPM M7]` → `TESTE-CPM-M7`) |
| `docs/CHANNEL_PIECE_MEDIA_DECISIONS.md` | CPM-D28 a CPM-D31 documentadas |
| `docs/CHANNEL_PIECE_MEDIA_IMPLEMENTATION_PLAN.md` | Seção M7 completa, fix regressão documentado |

### Smoke visual M7 — 2026-06-24 — APROVADO

Fixtures criadas em CP_A1 (`65f49c21`) com prefixo `[SMOKE CPM M7]`:

| Item | Verificação | Resultado |
|------|------------|-----------|
| 1 imagem `[SMOKE CPM M7] imagem.jpg` (IMAGE_A `3a49939e`) | badge, ordem, sem badge "Vídeo" | ✅ |
| 1 MP4 `SMOKE-CPM-M7-video.mp4` via LF `video/mp4` | badge "Vídeo", botão Play, botão Download, preview `<video>` | ✅ |
| 1 WebM `SMOKE-CPM-M7-video.webm` via LF `video/webm` | badge "Vídeo", botão Play, botão Download | ✅ |
| Filtro picker Todos/Imagens/Vídeos | separa corretamente | ✅ |

Cleanup smoke: 3 CPMs + 2 LFs vídeo + 4 S3 objects deletados — zero resíduos confirmados.

### Range Requests — auditoria MinIO

`GET` com `Range: bytes=0-15` → `206 Partial Content`, `Accept-Ranges: bytes`, `Content-Range: bytes 0-15/536`.  
`<video>` streaming funciona sem download completo.  
`HEAD` → 403 esperado (presigned URL assinada apenas para GET).

### Smoke autenticado em produção — 2026-06-24 — 20/20

Script: `scripts/cpm_m7_smoke_prod.mjs`  
BASE: `https://content.multihuman.com.br`  
Prefixo: `[SMOKE RELEASE CPM M7]`

| Item | Verificação | Resultado |
|------|------------|-----------|
| 1 | Upload MP4 pequeno → 201 | ✅ |
| 2 | library_file criado com `kind=video` | ✅ |
| 3+4 | `media_kind=video` (badge Vídeo) | ✅ |
| 5 | `image_url` presente para preview | ✅ |
| 6-7 | Download endpoint → 302 + URL assinada HTTPS | ✅ |
| 8 | Nome do arquivo sanitizado coerente | ✅ |
| 9 | Reorder → 200 | ✅ |
| 10 | PATCH role → `primary` | ✅ |
| 11 | `primary` confirmado via GET | ✅ |
| 12 | DELETE CPM preserva library_file | ✅ |
| 13 | Card atualiza após salvar sem F5 (`cpSaveCount`) | ✅ (UI-only — validado no smoke visual) |
| 14 | CTA atualizado aparece imediatamente | ✅ (UI-only — validado no smoke visual) |
| 15 | Texto não salvo não é perdido ao fechar dialog | ✅ (UI-only — validado no smoke visual) |

Cleanup: 1 LF + 1 S3 object deletados — zero resíduos confirmados.

---

## Release ChannelPiece Media M6 — 2026-06-24

**Merge commit:** `e4da6b8` — `feat: integrate ChannelPiece media organization M6`  
**Tag de rollback:** `pre-channel-piece-media-m6-release-2026-06-24` → `acdb51d`  
**Branch integrado:** `feat/channel-piece-media-m6-organization` → `main`  
**Deploy:** `content.multihuman.com.br` — Ready  
**Migration 024 em produção:** `024_channel_piece_media_organization.sql` — aplicada em 2026-06-24. RPCs `organize_channel_piece_media` e `remove_channel_piece_media` confirmadas via `pg_proc` (SECURITY INVOKER, prosecdef=false).

### Smoke de release em produção — 2026-06-24

Fixture: 3 mídias `SMOKE-RELEASE-CPM-M6-media-{1,2,3}.jpg` criadas em CP_A1 (`65f49c21`).

| Fase | Verificações | Resultado |
|------|-------------|-----------|
| Smoke público (sem auth) | 27 | ✅ 27/27 |
| Smoke autenticado (`content.multihuman.com.br`) | 27 | ✅ 27/27 |

Cleanup do smoke: 1 CPM (`e810959e`) + 3 LFs + 3 S3 objects deletados — zero resíduos confirmados.

---

## Release ChannelPiece Media M1–M5 — 2026-06-24

**Merge commit:** `f446cd0` — `feat: integrate ChannelPiece media lifecycle M1-M5`  
**Tag de rollback:** `pre-channel-piece-media-release-2026-06-24` → `c799d10`  
**Deploy:** `content.multihuman.com.br` — Ready  
**Smoke:** ✅ 51/51 verificações públicas + autenticadas aprovadas. Fixture deletada.

| Incremento | Branch | Status |
|------------|--------|--------|
| M1 | `feat/channel-piece-media-m1-schema` | ✅ Schema, RLS, constraints, índices |
| M2 | `feat/channel-piece-media-m2-api` | ✅ APIs CRUD, validação cross-project |
| M3 | `feat/channel-piece-media-m3-display` | ✅ Exibição em card + editor |
| M4 | `feat/channel-piece-media-m4-picker` | ✅ Picker: Galeria + Biblioteca |
| M4.1 | `fix/channel-piece-media-source-uniqueness` | ✅ Migration 023, unicidade de fonte |
| M5 | `feat/channel-piece-media-m5-upload` | ✅ Upload direto, atomicidade Casos A–D |

**Migrations em produção:** `022_create_channel_piece_media.sql` e `023_enforce_channel_piece_media_source_uniqueness.sql` — ambas aplicadas em 2026-06-23.

**M6:** `feat/channel-piece-media-m6-organization` — implementado, testado, smoke aprovado, cleanup concluído. Ver seção M6 abaixo.

**Dados preservados (confirmado pós-release):**
- Projeto `d0d008c3` "Content Agent" — intacto
- Production `492af729` "Teste publicação 01" — intacta
- Imagem `3a49939e` (imagem conceitual do Content Agent Studio) — preservada
- Posts legados, imagens, vídeos — sem alteração

---

## O que foi implementado

### Domínio completo de Publicações em 6 incrementos

| Incremento | Branch | Objetivo | Status |
|------------|--------|----------|--------|
| P1 | `feat/publication-p1-schema` | Schema de banco (`editorial_contents` + `channel_pieces`) e tipos TypeScript | ✓ |
| P2 | `feat/publication-p2-api` | APIs CRUD completas com validação e RLS | ✓ |
| P3 | `feat/publication-p3-ui` | Hub `/publicacoes` e workspace de detalhe EC | ✓ |
| P4 | `feat/publication-p4-channel-pieces` | Gestão inline de ChannelPieces + geração por IA | ✓ |
| P5 | `feat/publication-p5-production-quick-flow` | Quick Flow 2 passos (EC→CP) + aba Conteúdos na Production | ✓ |
| P6 | `feat/publication-p6-post-video-flow` | Entry point de publicação no workspace de vídeo | ✓ |

---

## Arquitetura do domínio

### Modelo de dados

```
Project (existente)
  └─ Production (existente)
       ├─ VideoDraft (existente, production_id nullable)
       └─ EditorialContent (novo P1)
            └─ ChannelPiece[] (novo P1)
```

**Sem FK entre `video_drafts` e `editorial_contents`** — relação implícita via `production_id` compartilhado.

### Tabelas criadas (migration `scripts/021_create_publication_entities.sql`)

**`editorial_contents`**
- `id`, `user_id`, `project_id` (FK RESTRICT), `production_id` (FK SET NULL, nullable)
- `title` (NOT NULL), `body`, `ai_context`
- `status`: `draft | ready | archived`
- RLS: `user_id = auth.uid()` em SELECT/INSERT/UPDATE/DELETE

**`channel_pieces`**
- `id`, `user_id`, `editorial_content_id` (FK CASCADE)
- `channel`: `instagram | youtube | linkedin | tiktok | twitter | whatsapp | facebook`
- `format`: depende do canal (validado via `lib/publication-channels.ts`)
- `title`, `body`, `cta`, `hashtags`
- `status`: `draft | ready | approved | archived`
- RLS: `user_id = auth.uid()` em SELECT/INSERT/UPDATE/DELETE

### APIs implementadas

| Rota | Métodos | Notas |
|------|---------|-------|
| `/api/editorial-contents` | GET, POST | filtros: `projectId`, `productionId`, `status`; paginação: `limit` |
| `/api/editorial-contents/[id]` | GET, PATCH, DELETE | PATCH aceita `title`, `body`, `aiContext`, `status`, `projectId`, `productionId` |
| `/api/channel-pieces` | GET, POST | filtros: `editorialContentId`, `productionId`, `channel`, `format`, `status` |
| `/api/channel-pieces/[id]` | GET, PATCH, DELETE | PATCH aceita todos os campos |
| `/api/channel-pieces/generate-body` | POST | Geração via OpenAI `gpt-4o-mini`; usa `user_settings.openai_api_key` ou `OPENAI_API_KEY` env |

Todas as rotas têm:
- Autenticação via `supabase.auth.getUser()`
- Guard `isPlainObject` antes de `Object.keys()` (evita bypass com string/array)
- Whitelist de campos permitidos (`ALLOWED_POST_KEYS`, `ALLOWED_PATCH_KEYS`)
- Validação de ownership (defense in depth além de RLS)

### UI implementada

**`/publicacoes`** — Hub global de publicações
- Lista todos os `EditorialContent`s do usuário
- Filtros: Projeto, Status, Production (client-side quando projeto selecionado)
- Botões: "Novo Conteúdo" + "Publicação rápida" (QuickFlowDialog sem contexto)

**`/projetos/[id]/conteudos/[editorialContentId]`** — Workspace de EC
- Formulário de edição de EC (título, corpo, aiContext, status, projeto, production)
- Seção de ChannelPieces: listar, criar, editar, deletar, gerar body via IA
- Proteção de URL: valida `ec.project_id === params.id`

**Production detail — aba "Conteúdos"**
- Lista ECs vinculados à produção (vista agrupada EC + CPs inline como chips)
- Botões: "Criar Conteúdo" + "Publicação rápida" (QuickFlowDialog com `lockedProjectId` + `lockedProductionId`)

**`/videos`** — Workspace de vídeo
- Botão "Preparar publicação" (Zap) ao lado de "Gerar Vídeo"
- Abre `QuickFlowDialog` com contexto pré-preenchido do `VideoDraft`
- Desabilitado quando não há nome de vídeo e sem cenas

### Componentes criados

**`components/publication/quick-flow-dialog.tsx`**
- Dialog 2 passos: Passo 1 (EC) → Passo 2 (CP)
- Props de lock: `lockedProjectId`, `lockedProductionId` — ocultam os selects
- Props de pré-preenchimento: `initialTitle`, `initialBody`, `initialAiContext`, `sourceLabel`
- `sourceLabel`: exibe banner "Preparando publicação a partir do vídeo '…'" no passo 1
- EC criado no passo 1 ao clicar "Próximo" (partial persistence intencional)
- Rollback: se CP falha → DELETE EC; se DELETE também falha → toast com link para EC workspace
- Abandonment (Opção A): fechar com EC criado → toast "Conteúdo editorial salvo" + link "Abrir"
- Guards de duplo clique: `isHandlingNextRef` e `isHandlingCreateRef` (useRef, síncronos)
- Reset completo ao reabrir: usa os `initial*` props como valores base

---

## Estado do release (atualizado em 2026-06-22)

- **main / origin/main**: `28756d3` (inclui redirect /publicacoes → /conteudos)
- **Tag de rollback**: `pre-publication-release-2026-06-22` → `6c3f856`
- **Deploy Production**: Ready — `content.multihuman.com.br`
- **Smoke autenticado**: concluído — login, dashboard, projetos, production, imagens, vídeos, publicações, QuickFlow, fluxo pós-vídeo, posts, arquivos
- **Registros de teste**: presentes (aguardam autorização de cleanup)
- **Lacuna identificada**: `posts.post_images` (upload de mídia) não tem equivalente em `channel_pieces`
- **Frontend consolidado**: menu "Conteúdos", hub renomeado, "Versões para canais" no workspace, Production mostra "Conteúdos editoriais", Projeto usa `image_drafts`/`video_drafts`

## Fase ChannelPiece Media — M1–M4 + fix/source-uniqueness entregues (2026-06-22 a 2026-06-23)

Descoberta, modelagem, implementação e auditoria de M1–M4 concluídas. Ver:

- `docs/CHANNEL_PIECE_MEDIA_DISCOVERY.md` — inventário completo do sistema de mídia atual
- `docs/CHANNEL_PIECE_MEDIA_DECISIONS.md` Rev. 3 — 22 decisões de domínio (CPM-D1 a CPM-D22)
- `docs/CHANNEL_PIECE_MEDIA_IMPLEMENTATION_PLAN.md` Rev. 3 — 10 incrementos (M1 a M10)

### M4 — Picker de mídia — IMPLEMENTADO E AUDITADO (2026-06-23)

**Branch:** `feat/channel-piece-media-m4-picker`

**Arquivos:**
- `components/publication/media-picker-dialog.tsx` (criado)
- `components/publication/channel-piece-media-section.tsx` (modificado)
- `app/(dashboard)/projetos/[id]/conteudos/[editorialContentId]/page.tsx` (modificado)

**Funcionalidades entregues:**

_Picker `MediaPickerDialog`:_
- Título "Adicionar mídia" / descrição orientada ao usuário (sem jargão técnico)
- Aba **"Imagens geradas"** — consulta `images` por `project_id` via Supabase client
- Aba **"Arquivos do projeto"** — consulta `GET /api/library-files?projectId=X`
- Itens já associados desabilitados com badge "Adicionada"/"Adicionado"
- Role auto-computado: primeiro item → `primary`; demais → `carousel_item`
- Position: `max(current) + 1` ou `0` se lista vazia
- Guard de double-submit via `isAssigningRef` (useRef síncrono)

_`ChannelPieceMediaSection` — dois modos:_
- **Card externo** (`editable=false`, default): somente leitura — sem lixeira, resumo informativo
- **Editor** (`editable=true, projectId`): lista com remoção + botão "Adicionar mídia" + picker

_Labels de origem UX (sem alteração nos tipos internos):_

| Fonte | Card/editor | Picker |
|-------|-------------|--------|
| `image_id` | Imagem gerada | — (aba "Imagens geradas") |
| `library_file_id` | Arquivo do projeto | — (aba "Arquivos do projeto") |

_Integração no Dialog de edição:_ seção "Mídia da versão" inserida após Hashtags; visível apenas ao editar CP existente.

**Auditoria:** 35/35 casos passados. Cleanup completo. Fontes originais verificadas intactas.

**Smoke visual aprovado:** card externo sem lixeira, editor com remoção, picker funcional, sem regressão de UX.

**Pendente:** autorização explícita para M5 (upload de nova mídia).

---

### M5 — Upload direto de arquivo na Versão para canal — IMPLEMENTADO E TESTADO (2026-06-23)

**Branch:** `feat/channel-piece-media-m5-upload`

**Arquivos criados/modificados:**
- `app/api/channel-piece-media/upload/route.ts` (criado) — orquestrador multipart
- `lib/storage/s3.ts` (modificado) — adicionado `uploadLibraryFile` + tipo `UploadedLibraryFile`
- `components/publication/media-picker-dialog.tsx` (reescrito) — aba "Enviar arquivo" com drag-and-drop

**O que foi feito:**
- Endpoint server-side: auth → validate → CP ownership → upload S3 → insert library_file → insert CPM → 201
- Atomicidade por compensação (Casos A–D): sem orphan em qualquer cenário de falha
- Role/position resolvidos server-side (mesmo algoritmo do M4)
- UI: terceira aba no `MediaPickerDialog`; `anyBusy` bloqueia fechar o dialog durante upload
- Formatos: JPEG, PNG, WebP, GIF, MP4, WebM, MOV; limite 50 MB

**Auditoria:** 44/44 casos passados (Groups 1–7: auth, imagens, vídeo, atomicidade, concorrência, deleção, regressão). TypeScript limpo. Build OK.

---

### M6 — Organização das mídias da Versão para canal — IMPLEMENTADO, TESTADO E DEPLOYADO (2026-06-24)

**Branch:** `feat/channel-piece-media-m6-organization` → integrado em `main` (`e4da6b8`)  
**Tag de rollback:** `pre-channel-piece-media-m6-release-2026-06-24` → `acdb51d`  
**Decisões:** CPM-D25, CPM-D26, CPM-D27

**Arquivos entregues:**

| Arquivo | Status |
|---------|--------|
| `scripts/024_channel_piece_media_organization.sql` | ✅ Escrito e aplicado em produção (2026-06-24) |
| `app/api/channel-piece-media/_helpers.ts` | ✅ `mapRpcError` adicionado |
| `app/api/channel-piece-media/organize/route.ts` | ✅ `PATCH /api/channel-piece-media/organize` |
| `app/api/channel-piece-media/[id]/route.ts` | ✅ DELETE reescrito para RPC |
| `components/publication/channel-piece-media-section.tsx` | ✅ Up/Down, role dropdown, primary |
| `scripts/cpm_m6_tests.mjs` | ✅ 66 assertions (Groups 1–7) |

**Funcionalidade entregue:**
- Botões Up/Down para reordenar itens (sem DnD pesado)
- Dropdown de role por item: "Definir como principal", thumbnail, carousel_item, background, attachment
- Delete atômico: compacta posições + promove primary se necessário
- Proteção contra stale payload, lock conflict e payload malformado

**Migration 024:** aplicada em produção (`nuhdhnasuohizxtmyiju`) em 2026-06-24. RPCs `organize_channel_piece_media` e `remove_channel_piece_media` confirmadas via `pg_proc` (SECURITY INVOKER).

**Auditoria:** `node scripts/cpm_m6_tests.mjs` — **66/66 assertions** passadas (Reorder 11, Primary 9, Roles 9, DELETE 11, Concorrência 10, Segurança 6, Regressão 10).

**Smoke visual (pré-merge):** CP_A1 com 3 mídias (IMAGE_A primary / LF carousel_item / LF thumbnail) — aprovado. Validados: Up/Down, role dropdown, "Definir como principal", unicidade de primary, card externo read-only, editor funcional. Cleanup: 3 CPMs + 11 library_files + 11 S3 objects removidos.

**Smoke de release (pós-deploy):** 27/27 verificações públicas + 27/27 autenticadas em `content.multihuman.com.br`. Cleanup: 1 CPM + 3 LFs + 3 S3 objects removidos. Zero resíduos.

**Validação técnica:** `pnpm typecheck` ✅ `pnpm build` ✅ `pnpm validate` ✅

**Próximo passo:** ESLint hardening (`chore/configure-eslint`). Depois: M7 (suporte a vídeo). Ambos requerem autorização explícita.

**Hardening técnico pendente:** instalar e configurar ESLint, adicionar `pnpm lint`, avaliar inclusão em `pnpm validate` → branch `chore/configure-eslint`.

---

### fix/source-uniqueness — Unicidade de fonte por ChannelPiece — IMPLEMENTADO E AUDITADO (2026-06-23)

**Branch:** `fix/channel-piece-media-source-uniqueness`

**Arquivos:**
- `scripts/023_enforce_channel_piece_media_source_uniqueness.sql` (criado)
- `app/api/channel-piece-media/_helpers.ts` (modificado — `mapPgError`)

**O que foi feito:**
- Auditoria pré-migration: zero duplicatas encontradas em produção
- Migration 023 aplicada em produção: dois índices únicos parciais `uq_cpm_cp_image` e `uq_cpm_cp_library_file`
- `mapPgError` atualizado: violação 23505 de qualquer um dos dois novos índices → HTTP 409 com mensagem amigável "Esta midia ja esta associada a esta versao." (nome do índice não exposto)
- Race condition (dois requests concorrentes com mesmo source+CP) gerenciado pelo índice DB — segundo INSERT bloqueado com 23505 → 409

**Auditoria:** 13 casos, 16 assertions, 16/16 passadas. Cleanup completo.

---

### M3 — Exibição de mídia no workspace — IMPLEMENTADO E AUDITADO (2026-06-23)

**Branch:** `feat/channel-piece-media-m3-display` — HEAD `3b2b2af`

**Componente:** `components/publication/channel-piece-media-section.tsx`  
**Integrado em:** `app/(dashboard)/projetos/[id]/conteudos/[editorialContentId]/page.tsx`

**Estratégia de carregamento:** paralelo por versão — cada CP card carrega suas próprias mídias de forma independente, sem bloquear o workspace.

**Funcionalidades:**
- Seção "Mídia (N)" em cada CP card com thumbnail/ícone, role label PT-BR, origem, alt text
- Estado vazio, loading, erro com retry, fonte indisponível (source_deleted)
- Fix de bug: URL pública usada como fallback quando S3 não está configurado localmente

**Auditoria:** 22/22 casos passados (carregamento, remoção, regressão). Cleanup completo.

---

### M2 — APIs CRUD — IMPLEMENTADO E AUDITADO (2026-06-23)

**Branch:** `feat/channel-piece-media-m2-api` — creado a partir de `feat/channel-piece-media-m1-schema`

**Arquivos criados:**
- `app/api/channel-piece-media/_helpers.ts` — resolução de fonte (URL assinada), mapeamento de erros PG
- `app/api/channel-piece-media/route.ts` — GET lista + POST com validação cross-project
- `app/api/channel-piece-media/[id]/route.ts` — GET + PATCH (campos imutáveis) + DELETE (vínculo apenas)

**Auditoria:** 33/33 casos passados via testes HTTP autenticados (Node.js + dev server local).
Incluindo casos críticos cross-project (29–31): CP proj-A + source proj-B → 400 em todos os cenários.
Sessão autenticada via Supabase Admin API `generate_link`. Cleanup completo.

**Pendente:** autorização explícita para M3 (UI de leitura).

---

### M1 — Schema, constraints, índices, RLS e tipos — APLICADO EM PRODUÇÃO (2026-06-23)

**Branch:** `feat/channel-piece-media-m1-schema` — HEAD `305f63b`  
**Ambiente:** `nuhdhnasuohizxtmyiju.supabase.co`  
**Aplicação:** manual via Supabase SQL Editor (MCP configurado em read-only)

**Migration:** `scripts/022_create_channel_piece_media.sql`  
**Tipos:** `lib/types.ts` — `ChannelPieceMedia`, `ChannelPieceMediaResolved`, `ChannelPieceMediaRole`

**Objetos criados no banco:** tabela + RLS (4 policies) + trigger + 4 constraints + 4 índices (2 únicos parciais)

**Auditoria (23 casos):** constraints todas verificadas em banco. Testes RLS cross-project/cross-user verificados por inspeção de policies — não testáveis via service_role. Obrigatório em M2.

**Próximo passo:** autorizar M2 (APIs CRUD) explicitamente.

---

## Restrições absolutas (mantidas em P1–P6)

- ✅ Rota `POST /api/posts/generate-feed-text` **não foi alterada**
- ✅ Sem `service role` em nenhuma rota
- ✅ Sem conexão Postgres direta
- ✅ Supabase MCP usado apenas em modo read-only para validações
- ✅ Sem merge em `main`

---

## Estado atual dos branches

Todos os branches P1–P6 estão em `feat/publication-p*` (não mergeados em `main`).  
Branch P6 (`feat/publication-p6-post-video-flow`) é o HEAD mais recente e contém todas as correções acumuladas.

Commits relevantes do P6:
- `24bd05a` — `fix: harden post-video publication workflow` (P6 audit fix — ver abaixo)
- `9ebdc18` — docs P6 audit results
- `47625e4` — `feat: add post-video publication flow (P6)`
- `e63cceb` — `fix: harden publication quick flow lifecycle` (P5 audit fixes)
- `bc22918` — docs P5
- `4871ac9` — `feat: add production publication quick flow` (P5 feature)

### Fix aplicado na auditoria P6 (24bd05a)

**Bug:** Ao carregar `/videos?draft=<id>`, o `productionId` state não era setado a partir de `draftData.production_id`. Resultado: `QuickFlowDialog` recebia `lockedProductionId=undefined`, exibia seletor de produção (em vez de travado), e o EC era criado com `production_id=null`.

**Root cause:** Dois efeitos colaterais combinados:
1. A linha `if (draftData.production_id) setProductionId(draftData.production_id)` estava ausente no path de carregamento via URL `?draft=` (existia apenas no `loadDraft()` click path).
2. O auto-save enviava `productionId: null` no PATCH, sobrescrevendo o valor correto do banco antes mesmo de a tela terminar de carregar.

**Fix:** Adicionar `if (draftData.production_id) setProductionId(draftData.production_id)` ao useEffect de carregamento por URL (`videos/page.tsx` linha 97). Com React 18 automatic batching, `productionId` fica correto quando o auto-save dispara.

---

## Pendências conhecidas

### Não implementado (fora de escopo P1–P6)

| Item | Prioridade sugerida | Notas |
|------|---------------------|-------|
| Migration `021_create_publication_entities.sql` aplicada no Supabase de produção | ✅ Resolvido | Confirmada existente antes de M1 |
| Migration `022_create_channel_piece_media.sql` (M1) aplicada no Supabase de produção | ✅ Resolvido | Auditada em 2026-06-23; 23 casos testados |
| `Distribution` (publicação real via API de canal) | Alta | Requer credenciais de API por canal (Instagram Graph, YouTube Data, etc.) |
| FK `source_video_draft_id` em `editorial_contents` | Baixa | Rastreabilidade causal explícita; atualmente implícita via `production_id` |
| `generate-body` whitelist de chaves desconhecidas | Muito baixa | Inconsistência de contrato detectada em P4; sem impacto funcional ou de segurança |
| `channel_piece.image_url` / `ChannelPieceAsset` | Média | Assets de mídia por peça (imagem de capa, thumbnail, etc.) |
| Pre-seleção `youtube/video_description` no Quick Flow de vídeo | Baixa | Agiliza fluxo de criação de descrição de vídeo no YouTube |
| `source_video_draft_id` opcional em `editorial_contents` | Baixa | Rastrear qual vídeo originou o EC |
| Teste cross-user (isolamento RLS com 2 contas) | Média | Validado em inspeção de código + tripla camada; não executado por ter apenas 1 conta disponível |

### Observação de produto — reorganização da página do Projeto

A página do Projeto (`/projetos/[id]`) ainda dá peso semelhante a Imagens, Vídeos e Produções. A direção desejada é tornar **Production a unidade operacional principal**. As seções de Imagens, Vídeos e Conteúdos no Projeto devem futuramente funcionar como resumo agregado ou materiais avulsos, evitando duplicidade com os atalhos globais do sidebar.

**Pré-requisitos antes de implementar:**
1. Upgrade de mídia de `ChannelPiece` (adicionar `image_url`/assets) — fecha a lacuna com Posts
2. Aposentadoria de Posts (remoção da aba "Posts legados" da Production e do menu global)

Essa reorganização está registrada mas **não autorizada** — será tratada após os dois pré-requisitos acima.

### Bug pré-existente (corrigido em M5)

- `app/(dashboard)/imagens/rascunhos/page.tsx:43` — TS7006 corrigido em `d24e14a` (cast `as ImageDraft[]`). Working tree limpa.

---

## Como retomar o desenvolvimento

### Para fazer merge em main

1. Verificar se a migration 021 foi aplicada em produção (Supabase dashboard)
2. Fazer merge dos branches em ordem: P1 → P2 → P3 → P4 → P5 → P6 (ou squash do P6 que inclui tudo)
3. Rodar `pnpm build` final pós-merge
4. Testar smoke: `/publicacoes`, `/videos`, production detail

### Para continuar no P6 (melhoria incremental)

O branch `feat/publication-p6-post-video-flow` está limpo e buildando. Qualquer novo incremento deve criar um branch a partir dele.

### Para adicionar um canal novo

1. Atualizar `lib/publication-channels.ts`: adicionar ao `PUBLICATION_CHANNELS`, `PUBLICATION_FORMATS`, e `CHANNEL_FORMAT_MAP`
2. Atualizar `CHANNEL_FORMAT_CONTEXT` em `generate-body/route.ts` com instruções de contexto por formato
3. Atualizar labels em `CHANNEL_LABELS` e `FORMAT_LABELS` nos componentes de UI

---

## Arquivos centrais do domínio

| Arquivo | Propósito |
|---------|-----------|
| `lib/types.ts` | Tipos `EditorialContent`, `ChannelPiece`, `PublicationChannel`, `PublicationFormat`, etc. |
| `lib/publication-channels.ts` | Constantes de canais/formatos válidos e funções de validação |
| `scripts/021_create_publication_entities.sql` | Migration das tabelas |
| `components/publication/quick-flow-dialog.tsx` | Dialog de criação rápida EC→CP (entry point principal) |
| `app/(dashboard)/publicacoes/page.tsx` | Hub global |
| `app/(dashboard)/projetos/[id]/conteudos/[editorialContentId]/page.tsx` | Workspace de detalhe |
| `app/(dashboard)/projetos/[id]/producoes/[productionId]/page.tsx` | Aba Conteúdos da Production |
| `app/(dashboard)/videos/page.tsx` | Entry point de vídeo para publicação |
