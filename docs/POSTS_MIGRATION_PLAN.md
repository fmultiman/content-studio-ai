# Posts — Plano de Migração (M8)
**Data:** 2026-06-24  
**Branch discovery:** `discovery/posts-to-editorial-content-m8`  
**Branch schema:** `feat/posts-migration-m8-schema` — integrado em main (`1b7be2b`)  
**Branch executor M8.3A:** `feat/posts-migration-m8-executor`  
**Branch executor M8.4:** `feat/posts-migration-m8-4-p1-media`  
**Branch auditoria M8.5A:** `feat/posts-migration-m8-5a-audit`  
**Branch legacy marking M8.5B:** `feat/posts-migration-m8-5b-legacy-marking`  
**Status:** M8.5B PRONTO PARA RELEASE — 4/4 posts marcados. POST legado bloqueado (410). Testes autenticados 10/10 PASS. validate OK.  
**Escopo:** Fases, dry-run, idempotência, rollback, validação, critérios de go/no-go.

---

## 1. Visão Geral

A migration M8 converte os 4 Posts legados em EditorialContents + ChannelPieces no novo domínio.

```
Post (legado)
└─► EditorialContent (novo)
    └─► ChannelPiece (novo)
        └─► ChannelPieceMedia (novo, somente P1 — após importação de mídia)
```

**Regra base:** 1 Post → 1 EditorialContent + 1 ChannelPiece (PUB-D13).

---

## 1.1 M8.1 — Dry-Run — 2026-06-24 — APROVADO

**Script:** `scripts/posts_migration_dry_run.mjs`  
**Output:** `docs/migrations/posts-m8-dry-run.json`, `docs/migrations/posts-m8-dry-run.md`  
**Resultado:** 4/4 READY — 0 blockers — 0 warnings

| Post | Fingerprint | S3 origem | Destino colisão | Status |
|------|-------------|-----------|-----------------|--------|
| P1 (`d02a9507`) | `3e8a92a619...` | ✅ exists, 1.293.601 bytes, image/png, ETag `7997848a1f` | ✅ sem colisão | **READY** |
| P2 (`7eb9ccf4`) | (no JSON) | — sem mídia — | — | **READY** |
| P3 (`083a69d5`) | (no JSON) | — sem mídia — | — | **READY** |
| P4 (`7aa6b5a4`) | (no JSON) | — sem mídia — | — | **READY** |

**H1–H4 aplicadas no dry-run:**
- H1: P3 `project_id = d0d008c3` (human_approved, confidence: confirmed)
- H2: importação PNG de P1 aprovada — destino `users/.../library/posts-migration-m8/<post_id>/...`
- H3: migrar todos os 4 Posts
- H4: `EditorialContent.status = draft`, `ChannelPiece.status = draft`

**Rastreabilidade confirmada:** `legacy_post_id UUID NULL` + `UNIQUE WHERE legacy_post_id IS NOT NULL`  
**`legacy_source` coluna:** desnecessária — apenas uma fonte legada.

**Aprovação individual:**

| Post | Name | Status dry-run | Decisão |
|------|------|---------------|---------|
| P1 | Teste Post Smoke Test 01 | ✅ READY | ✅ APROVADO 2026-06-24 |
| P2 | outro teste de post | ✅ READY | ✅ APROVADO 2026-06-24 |
| P3 | outro teste de story | ✅ READY | ✅ APROVADO COM H1 2026-06-24 |
| P4 | teste 04 | ✅ READY | ✅ APROVADO 2026-06-24 |

---

## 1.2 M8.2 — Schema `legacy_post_id` — 2026-06-24 — APLICADO

**Branch:** `feat/posts-migration-m8-schema`  
**Migration:** `scripts/025_add_editorial_content_legacy_post_id.sql`  
**Aplicada em produção:** 2026-06-24

**Alterações:**

```sql
ALTER TABLE editorial_contents
ADD COLUMN IF NOT EXISTS legacy_post_id UUID NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ec_legacy_post_id
  ON editorial_contents (legacy_post_id)
  WHERE legacy_post_id IS NOT NULL;
```

**Schema antes:** 10 colunas — sem `legacy_post_id`  
**Schema depois:** 11 colunas — `legacy_post_id UUID NULL DEFAULT NULL`  
**Índice:** `uq_ec_legacy_post_id` — `UNIQUE BTREE (legacy_post_id) WHERE (legacy_post_id IS NOT NULL)`

**Invariantes garantidas pelo índice:**
- Múltiplos `legacy_post_id = NULL` permitidos (novos ECs sem origem legada)
- Um UUID não-nulo pode aparecer em no máximo uma linha
- UUID duplicado não-nulo é rejeitado com `unique_violation`
- UUIDs distintos não-nulos são permitidos sem restrição
- Zero linhas existentes alteradas (3 rows, todas `legacy_post_id = NULL` após migration)

**Tipo TypeScript:** `lib/types.ts` — `EditorialContent.legacy_post_id: string | null` adicionado

**Dry-run pós-schema:** 4/4 READY — coluna detectada (`✓ EXISTE`) — 0 blockers

**Validações:**
- typecheck: ✅ 0 erros
- lint: ✅ 51 warnings / 0 erros (baseline)
- build: ✅ exit 0
- dry-run: ✅ 4/4 READY

**Rollback (se necessário):**
```sql
DROP INDEX IF EXISTS uq_ec_legacy_post_id;
ALTER TABLE editorial_contents DROP COLUMN IF EXISTS legacy_post_id;
```

---

## 1.6 M8.5B — Legacy Marking — 2026-06-24

**Branch:** `feat/posts-migration-m8-5b-legacy-marking`  
**Scripts:** `scripts/posts_migration_m85b_mark.mjs`, `scripts/posts_migration_m85b_rollback.mjs`  
**Testes:** `scripts/posts_m85b_tests.mjs`  
**Migration:** `scripts/026_add_posts_migrated_at.sql`

**Decisão de schema:** `migrated_at TIMESTAMPTZ NULL` adicionado a `posts`. Campo `migrated_editorial_content_id` descartado — EC lookup via `editorial_contents.legacy_post_id` (já indexado) é suficiente. API enriquece GET com `migrated_ec_id` + `migrated_ec_project_id` via join no servidor.

**Proteção API:**
- GET: permitido; resposta enriquecida com campos de navegação para posts migrados
- PATCH: HTTP 409 `POST_MIGRATED` se `migrated_at IS NOT NULL`
- DELETE: HTTP 409 `POST_MIGRATED` se algum ID estiver migrado
- POST (criação): HTTP 401 sem sessão; HTTP 410 `LEGACY_POST_CREATION_DISABLED` com sessão — criação legada encerrada em API e UI

**Contrato HTTP de criação (M8.5B fix):**
```
POST /api/posts — sem sessão   → 401
POST /api/posts — autenticado  → 410 { code: "LEGACY_POST_CREATION_DISABLED", error: "A criação de Posts legados foi encerrada. Use Conteúdos." }
```

**Testes autenticados (sessão real via admin generateLink):**

| Teste | Resultado |
|-------|-----------|
| T08a GET sem sessão → 401 | ✅ PASS |
| T08b PATCH sem sessão → 401 | ✅ PASS |
| T08c DELETE sem sessão → 401 | ✅ PASS |
| T08d POST sem sessão → 401 | ✅ PASS |
| T05 GET autenticado P1 migrado → 200 + migrated_ec_id | ✅ PASS |
| T06 PATCH autenticado P1 migrado → 409 POST_MIGRATED | ✅ PASS |
| T07 DELETE autenticado P1 migrado → 409 POST_MIGRATED | ✅ PASS |
| POST autenticado → 410 LEGACY_POST_CREATION_DISABLED | ✅ PASS |
| Contagem posts pós-testes = 4 | ✅ PASS |
| P1–P4 status=saved, migrated_at intacto | ✅ PASS |

**UI (modo legado):**
- Badge âmbar "Migrado" no item da lista
- Link "Ver Conteúdo Editorial" no item e no editor
- Editor somente leitura (readOnly + disabled) quando `migrated_at IS NOT NULL`
- Auto-save desativado para posts migrados
- Botões Salvar/Excluir ocultos no editor de post migrado

**Resultado:**

| Métrica | Valor |
|---------|-------|
| Posts marcados | 4/4 |
| migrated_at | 2026-06-24T20:59:57.181+00:00 |
| Idempotência (2ª run) | ALREADY_MARKED 4/4 ✅ |
| Testes (suite base) | 15/15 PASS ✅ |
| Testes autenticados | 10/10 PASS ✅ |
| API GET | 200 + migrated_ec_id enriquecido ✅ |
| API PATCH/DELETE migrado | HTTP 409 POST_MIGRATED ✅ |
| API POST criação (sem sessão) | HTTP 401 ✅ |
| API POST criação (autenticado) | HTTP 410 LEGACY_POST_CREATION_DISABLED ✅ |
| UI | Badge Migrado + link EC + read-only + "Novo Post" desabilitado ✅ |
| typecheck | 0 erros ✅ |
| lint | 0 erros, 51 warnings ✅ |
| build | exit 0 ✅ |
| validate | exit 0 ✅ |

**Rollback M8.5B (se necessário):**
```bash
POSTS_MIGRATION_M85B_ROLLBACK_CONFIRM=M8_5B_ROLLBACK_APPROVED \
node scripts/posts_migration_m85b_rollback.mjs --execute
```

---

## 1.5 M8.5A — Post-Migration Audit — 2026-06-24 — PASS

**Branch:** `feat/posts-migration-m8-5a-audit`  
**Script:** `scripts/posts_migration_post_audit.mjs` (read-only)  
**Artefatos:** `docs/migrations/posts-m8-post-audit.json`, `docs/migrations/posts-m8-post-audit.md`

**Resultado: 139/139 PASS — DETERMINÍSTICO** (2 execuções idênticas)

| Seção | Checks | Resultado |
|-------|--------|-----------|
| B — Global | 9 | ✅ PASS |
| C — P1 (M8.4) | 29+9 S3+15 media | ✅ PASS |
| C — P2 (M8.3A) | 22 | ✅ PASS |
| C — P3/H1 (M8.3A) | 22+3 H1 | ✅ PASS |
| C — P4 (M8.3A) | 22 | ✅ PASS |
| D — Manifests | 8 | ✅ PASS |
| E — Rollback inspection | 12 | ✅ PASS |

**Destaques:**
- 4 fingerprints: aprovados = observados ✅
- P3/H1: `post.project_id=NULL` preservado, `EC.project_id=d0d008c3` (H1 APPLIED — classificado como PASS, não divergência)
- S3 source ETag = S3 dest ETag = `7997848a1fcbfd6193dc2f867d65a4b1` (conteúdo idêntico)
- Nenhum EC/CP/LF/CPM órfão detectado
- Nenhuma duplicação detectada
- Rollback disponível — NOT EXECUTED
- Inspeção visual: REQUIRED (URLs em `docs/migrations/posts-m8-post-audit.md`)

**Critério de marcação de posts:** ATENDIDO tecnicamente. Pendente apenas revisão visual humana autenticada.

---

## 1.4 M8.4 — Executor: P1 com mídia — 2026-06-24 — EXECUTADO

**Branch:** `feat/posts-migration-m8-4-p1-media`  
**Script:** `scripts/posts_migration_m84_execute.mjs`  
**Rollback script:** `scripts/posts_migration_m84_rollback.mjs`  
**Manifesto:** `docs/migrations/posts-m8-execution-m8-4.json`, `docs/migrations/posts-m8-execution-m8-4.md`  
**Tag pré-migração:** `pre-posts-migration-m8-2026-06-24` → `1b7be2b` (herdada do M8.3A)

**IDs criados:**

| Entidade | ID |
|----------|----|
| EC | `16a0bfea-b558-4f26-91ec-2e163d84f9b0` |
| CP | `2a48076c-3aff-4c53-beaf-cd84e028cffd` |
| LF | `f190c6ad-8ad1-490c-aeaa-3898b69bb0aa` |
| CPM | `d71eed1d-068b-47ed-aae1-278ca6922cf8` |

**Detalhes do canal:** EC `legacy_post_id=d02a9507` | CP `instagram/feed` | status `draft`

**S3:**

| | Valor |
|-|-------|
| bucket | `content-studio` |
| source key | `users/35428fd4.../posts/3f142fc2.../Content-Agent-Studio-Future-Vision-Concept.png` |
| dest key | `users/35428fd4.../library/posts-migration-m8/d02a9507.../Content-Agent-Studio-Future-Vision-Concept.png` |
| operação | COPY (source preservado) |
| tamanho dest | 1.293.601 bytes ✅ |
| ETag source | `7997848a1fcbfd6193dc2f867d65a4b1` |
| colisão | CLEAR (nenhuma) |

**Decisão thumbnail:** `thumbnail_url = null`. O `library_files.thumbnail_url` é nullable. Thumbnail original (`posts/{image_uuid}/...`) preservada intacta no namespace `posts/`. Nenhum objeto novo gerado para thumbnail.

**Snapshot antes:** EC=6 (legacy=3), CP=5, LF=3, CPM=0, posts=4  
**Snapshot depois:** EC=7 (legacy=4), CP=6, LF=4, CPM=1, posts=4

**Verificações (18/18 ✅):** fingerprint, updated_at baseline, ec_exists, ec_legacy_post_id_ok, ec_project_id_ok, ec_status_draft, cp_exists, cp_linked_to_ec, cp_channel_ok, cp_format_ok, cp_status_draft, lf_exists, lf_storage_path_ok, lf_kind_image, lf_file_size_ok, cpm_exists, cpm_linked_to_cp, cpm_linked_to_lf, cpm_role_primary, cpm_position_zero, post P1 intacto, S3 source intacto.

**Idempotência:** re-execução → `ALREADY_MIGRATED` ✅. Zero escrita. Zero S3. CPM detectado por `(channel_piece_id, library_file_id)`.

**Rollback (se necessário):**
```bash
POSTS_MIGRATION_M84_ROLLBACK_CONFIRM=M8_4_ROLLBACK_APPROVED \
node scripts/posts_migration_m84_rollback.mjs --execute
```
Remove em ordem: CPM → CP → LF → EC → S3 dest. Nunca toca posts, S3 source ou P2/P3/P4.

**Resultado:** Todos os 4 Posts migrados. P1 com mídia. M8.3A (P2/P4/P3) e M8.4 (P1) concluídos.

---

## 1.3 M8.3A — Executor: P2, P4, P3 — 2026-06-24 — EXECUTADO

**Branch:** `feat/posts-migration-m8-executor`  
**Script:** `scripts/posts_migration_execute.mjs`  
**Rollback script:** `scripts/posts_migration_rollback.mjs`  
**Manifesto:** `docs/migrations/posts-m8-execution-m8-3a.json`, `docs/migrations/posts-m8-execution-m8-3a.md`  
**Tag pré-migração:** `pre-posts-migration-m8-2026-06-24` → `1b7be2b`

**Allowlist:** P2, P4, P3. P1 reservado para M8.4.

**IDs criados:**

| Post | EC | CP | channel | format |
|------|----|----|---------|----|
| P2 `7eb9ccf4` | `0d4ee522-db02-4766-98aa-d02b2faf1ea1` | `64e5bbb3-f8cf-46eb-bafa-2d420d03c6bc` | youtube | post |
| P3 `083a69d5` | `bee05422-04e7-4c80-9d82-ba504303e37d` | `05772802-06d7-4249-bae8-d8b8e11b7457` | instagram | story |
| P4 `7aa6b5a4` | `d0138557-ad57-4284-bcdc-322c21c8f599` | `ba9d1e7d-38c7-4ca0-8251-a72bdaddce64` | youtube | video_description |

**Snapshot antes:** EC=3 (legacy=0), CP=2, posts=4  
**Snapshot depois:** EC=6 (legacy=3), CP=5, posts=4

**Verificações:**
- Fingerprints pré-execução: 3/3 ✅
- EC.legacy_post_id = posts.id: 3/3 ✅
- EC.project_id = d0d008c3: 3/3 ✅ (P3 recebeu H1)
- EC.status = draft: 3/3 ✅
- CP.linked_to_ec: 3/3 ✅
- CP.status = draft: 3/3 ✅
- cpm_count = 0: 3/3 ✅
- posts intactos (status=saved, updated_at inalterado): ✅
- P3.posts.project_id = null (não alterado): ✅
- S3: zero operações ✅
- Idempotência: re-execução retornou 3/3 ALREADY_MIGRATED ✅

**Validações técnicas:**
- typecheck: ✅ 0 erros
- lint: ✅ 51 warnings / 0 erros (baseline)
- build: ✅ exit 0

**Rollback (se necessário):**
```bash
POSTS_MIGRATION_ROLLBACK_CONFIRM=M8_3A_ROLLBACK_APPROVED \
node scripts/posts_migration_rollback.mjs --execute
```

**P1 pendente:** reservado para M8.4 (cópia S3 + library_file + ChannelPieceMedia).

---

## 2. Pré-condições para Autorizar a Migração

| Condição | Status atual | Ação necessária |
|----------|-------------|----------------|
| 100% dos Posts inventariados | ✅ 4/4 | — |
| 100% das mídias classificadas | ✅ 1 mídia, classificada | — |
| Projeto definido para todos os migráveis | ✅ P3 `project_id = d0d008c3` (H1 aprovada) | — |
| Production definida | ✅ todos têm `production_id` | — |
| Canal e formato válidos para todos | ✅ todos mapeados | — |
| Mídia P1 resolvida | ✅ PNG em S3 confirmado, importação aprovada (H2) | Executar em M8.4 |
| Rollback definido | ✅ (seção 7) | — |
| Idempotência definida | ✅ (seção 5) | — |
| Dry-run executado e aprovado | ✅ 4/4 READY (M8.1) | — |
| Schema `legacy_post_id` aplicado | ✅ migration 025 (M8.2) | — |
| Tag de rollback operacional | ✅ `pre-posts-migration-m8-2026-06-24` → `1b7be2b` | — |
| Decisões H1–H4 respondidas | ✅ todas aprovadas 2026-06-24 | — |

**M8.3A executado em produção 2026-06-24.**

---

## 3. Preservação de Rastreabilidade

### 3.1 Recomendação

**Opção adotada:** coluna `legacy_post_id TEXT` em `editorial_contents`.

Avaliação das opções:

| Opção | Prós | Contras | Decisão |
|-------|------|---------|---------|
| `legacy_post_id TEXT` em `editorial_contents` | Simples, consultável com SQL, visível em qualquer SELECT | Requer migration de schema | **ADOTADA** |
| Campo `metadata JSONB` em `editorial_contents` | Flexível, sem migration nova | `metadata` não existe hoje; JSONB pior para indexação | Alternativa |
| Tabela `migration_map` separada | Isolamento, suporta múltiplos sistemas legados | Overhead para 4 registros | Desnecessário nesta escala |
| Somente em script e relatório | Sem alteração de schema | Irrecuperável se script perdido; não idempotente | Rejeitada |

### 3.2 Schema da coluna (M8.2)

```sql
ALTER TABLE editorial_contents
  ADD COLUMN IF NOT EXISTS legacy_post_id TEXT;

CREATE INDEX IF NOT EXISTS idx_ec_legacy_post_id
  ON editorial_contents(legacy_post_id)
  WHERE legacy_post_id IS NOT NULL;
```

A coluna é NULL para EditorialContents criados naturalmente. Preenchida apenas pela migration.

---

## 4. Fases de Execução

### M8.1 — Dry-run e mapa de migração ← **AUTORIZADA (esta etapa)**

- Executar dry-run sem escrita
- Gerar JSON com proposta por Post
- Revisar saída com usuário responsável
- Responder decisões H1–H4

### M8.2 — Schema mínimo de rastreabilidade

- `ALTER TABLE editorial_contents ADD COLUMN IF NOT EXISTS legacy_post_id TEXT`
- Criar índice
- `pnpm validate` deve passar
- Commit + push

### M8.3 — Migrar AUTO_MIGRÁVEIS (P2 e P4)

- Migrar Posts P2 e P4 (sem mídia, com project_id)
- Verificar idempotência: se `legacy_post_id` já existe, pular
- Validar registro a registro via SQL

### M8.4 — Importar mídia de P1 e migrar

- Criar `library_file` para PNG de P1 (`users/35428fd4.../posts/3f142fc2.../...png`)
- Migrar P1 com `ChannelPieceMedia.source = library_file_id`
- Verificar arquivo físico acessível antes de criar LF

### M8.5 — Resolver P3 (project_id NULL)

- Após confirmação H1: `project_id = d0d008c3`
- Migrar P3
- Validar registro

### M8.6 — Marcar Posts como migrados (read-only sinalizado)

- **Não deletar** a tabela `posts` ainda
- Adicionar campo `migrated_at TIMESTAMPTZ` a `posts` (opcional — para rastreabilidade)
- UI de "Posts legados" pode mostrar badge "Migrado"
- Nenhum novo Post deve ser criado após M8.6

### M9 — Aposentadoria operacional

- Remover botão "Novo Post" na UI
- Remover aba "Posts legados" da Production (substituir por EditorialContents)
- Remover link de "Posts legados" em `/conteudos`
- Manter API `/api/posts` em modo somente leitura (GET apenas)

### M10 — Remoção futura (pós-validação prolongada)

- Somente após N semanas/meses confirmando que nenhum fluxo depende da tabela
- `DROP TABLE posts` (migration de remoção)
- Remover `app/api/posts/`, `app/(dashboard)/posts/`, tipos `Post`, `PostImage`, `PublicationType`
- Remover `folder: 'posts'` do storage
- Remover rota `/posts` do middleware

---

## 5. Idempotência

### 5.1 Chave de idempotência

```
legacy_source = 'posts'
legacy_id     = posts.id
```

Verificação antes de cada INSERT:

```sql
SELECT id FROM editorial_contents
WHERE legacy_post_id = '<posts.id>'
LIMIT 1;
```

Se retornar registro: **pular** — já migrado. Não alterar.

### 5.2 Propriedades

| Propriedade | Implementação |
|-------------|--------------|
| Dry-run sem escrita | `DRY_RUN=true` no script — somente SELECT |
| Executar uma vez | Chave `legacy_post_id` garante unicidade |
| Reexecutar sem duplicar | Verificação prévia por `legacy_post_id` |
| Interromper e retomar | Cada Post é uma transação independente |
| Validar registro por registro | Consulta pós-INSERT verifica IDs criados |

---

## 6. Especificação do Dry-Run (M8.1)

O script de dry-run deve:
1. Ler todos os registros de `posts`
2. Para cada Post, computar o destino sem escrever
3. Verificar se `legacy_post_id` já existe
4. Verificar se `project_id` é válido
5. Verificar se canal é mapeável
6. Verificar se mídia é resolvível
7. Emitir saída JSON por Post

### 6.1 Schema de saída

```json
{
  "dry_run": true,
  "generated_at": "2026-06-24T...",
  "total_posts": 4,
  "summary": {
    "auto_migravel": 2,
    "requer_importacao_midia": 1,
    "exige_atribuicao_projeto": 1,
    "blockers_count": 2
  },
  "posts": [
    {
      "post_id": "d02a9507-d6c3-4203-9939-4667a4e0f027",
      "classification": "MIGRÁVEL COM IMPORTAÇÃO DE MÍDIA",
      "already_migrated": false,
      "proposed_editorial_content": {
        "title": "Teste Post Smoke Test 01",
        "body": "POst para apresentar o novo frontend",
        "ai_context": "contexto",
        "status": "ready",
        "project_id": "d0d008c3-321b-46fe-8225-2f1a68e833ec",
        "production_id": "492af729-cb06-4e0e-8a2c-e83fada37fb1",
        "legacy_post_id": "d02a9507-d6c3-4203-9939-4667a4e0f027"
      },
      "proposed_channel_piece": {
        "channel": "instagram",
        "format": "feed",
        "body": "(feed_text completo — omitido no dry-run)",
        "status": "approved"
      },
      "proposed_media": [
        {
          "action": "IMPORT_LIBRARY_FILE",
          "storage_path": "users/35428fd4-4784-4934-9af9-82a606aad77e/posts/3f142fc2-df7f-4e39-ae04-ca63832f690d/Content-Agent-Studio-Future-Vision-Concept.png",
          "mime_type": "image/png",
          "file_size": 1293601,
          "role": "primary",
          "position": 0
        }
      ],
      "warnings": [
        "Mídia não rastreada em library_files — importação necessária antes de criar ChannelPieceMedia"
      ],
      "blockers": [
        "library_file_id desconhecido — importar mídia primeiro (H2)"
      ]
    },
    {
      "post_id": "7eb9ccf4-7989-4f4b-93ba-c10df0345428",
      "classification": "AUTO_MIGRÁVEL",
      "already_migrated": false,
      "proposed_editorial_content": {
        "title": "outro teste de post",
        "body": "Teste de post de Youtube",
        "ai_context": "COntexto correto",
        "status": "ready",
        "project_id": "d0d008c3-321b-46fe-8225-2f1a68e833ec",
        "production_id": "492af729-cb06-4e0e-8a2c-e83fada37fb1",
        "legacy_post_id": "7eb9ccf4-7989-4f4b-93ba-c10df0345428"
      },
      "proposed_channel_piece": {
        "channel": "youtube",
        "format": "post",
        "body": null,
        "status": "approved"
      },
      "proposed_media": [],
      "warnings": [],
      "blockers": []
    },
    {
      "post_id": "083a69d5-de8f-4525-b1a1-f495b6404e80",
      "classification": "EXIGE ATRIBUIÇÃO DE PROJETO",
      "already_migrated": false,
      "proposed_editorial_content": {
        "title": "outro teste de story",
        "body": "teste de story",
        "ai_context": "contexto do teste de story",
        "status": "ready",
        "project_id": null,
        "production_id": "492af729-cb06-4e0e-8a2c-e83fada37fb1",
        "legacy_post_id": "083a69d5-de8f-4525-b1a1-f495b6404e80"
      },
      "proposed_channel_piece": {
        "channel": "instagram",
        "format": "story",
        "body": null,
        "status": "approved"
      },
      "proposed_media": [],
      "warnings": [
        "project_id = NULL — inferido como d0d008c3 via production.project_id (confiança ALTA)"
      ],
      "blockers": [
        "project_id NULL — requer confirmação humana (H1) antes de migrar"
      ]
    },
    {
      "post_id": "7aa6b5a4-8fb2-4e22-937e-82a228f87e8b",
      "classification": "AUTO_MIGRÁVEL",
      "already_migrated": false,
      "proposed_editorial_content": {
        "title": "teste 04",
        "body": "teste  04",
        "ai_context": null,
        "status": "ready",
        "project_id": "d0d008c3-321b-46fe-8225-2f1a68e833ec",
        "production_id": "492af729-cb06-4e0e-8a2c-e83fada37fb1",
        "legacy_post_id": "7aa6b5a4-8fb2-4e22-937e-82a228f87e8b"
      },
      "proposed_channel_piece": {
        "channel": "youtube",
        "format": "video_description",
        "body": null,
        "status": "approved"
      },
      "proposed_media": [],
      "warnings": [],
      "blockers": []
    }
  ]
}
```

### 6.2 Contagens e checksums do dry-run

O script deve emitir:

```
Total de Posts lidos:    4
Auto_migráveis:          2
Requer importação mídia: 1
Exige atribuição projeto: 1
Já migrados (skip):      0
Blockers totais:         2
```

---

## 7. Rollback

### 7.1 Princípios

- Rollback apaga **somente** os registros criados pela migration
- Nunca apaga a tabela `posts` (fonte original intocada)
- Nunca apaga mídia física no S3 se era preexistente
- Nunca apaga `library_files` criados antes da migration (só os importados pela migration)
- Permite rollback parcial por Post

### 7.2 Procedimento por camada

```sql
-- 1. Coletar IDs criados pela migration (via legacy_post_id)
SELECT id FROM editorial_contents WHERE legacy_post_id IS NOT NULL;

-- 2. Coletar ChannelPieces filhos
SELECT id FROM channel_pieces
WHERE editorial_content_id IN (
  SELECT id FROM editorial_contents WHERE legacy_post_id IS NOT NULL
);

-- 3. Coletar ChannelPieceMedia filhos
SELECT id FROM channel_piece_media
WHERE channel_piece_id IN (
  SELECT id FROM channel_pieces
  WHERE editorial_content_id IN (
    SELECT id FROM editorial_contents WHERE legacy_post_id IS NOT NULL
  )
);

-- 4. Coletar LibraryFiles importados pela migration
-- (identificados por campo migration_source = 'posts_migration_m8' ou similar)
SELECT id FROM library_files WHERE name ILIKE '%migration-m8%'; -- ou via metadata

-- ROLLBACK REAL (executar em transação):
BEGIN;
  DELETE FROM channel_piece_media
  WHERE channel_piece_id IN (
    SELECT id FROM channel_pieces
    WHERE editorial_content_id IN (
      SELECT id FROM editorial_contents WHERE legacy_post_id IS NOT NULL
    )
  );

  DELETE FROM channel_pieces
  WHERE editorial_content_id IN (
    SELECT id FROM editorial_contents WHERE legacy_post_id IS NOT NULL
  );

  DELETE FROM editorial_contents WHERE legacy_post_id IS NOT NULL;

  -- Se importou library_files pela migration:
  -- DELETE FROM library_files WHERE id IN ('<ids-importados>');
COMMIT;
```

### 7.3 Verificação pós-rollback

```sql
SELECT COUNT(*) FROM editorial_contents WHERE legacy_post_id IS NOT NULL; -- deve ser 0
SELECT COUNT(*) FROM posts; -- deve ser 4 (intactos)
```

---

## 8. Estratégia de Mídia Legada (P1)

A imagem de P1 está em `users/35428fd4.../posts/3f142fc2.../Content-Agent-Studio-Future-Vision-Concept.png`.  
Não existe em `images` nem `library_files`. Três opções:

### Opção A — Importar para `library_files` (RECOMENDADA)

**Como:** INSERT em `library_files` com:
- `storage_path`: caminho S3 existente (não mover o arquivo)
- `kind`: `image`
- `mime_type`: `image/png`
- `file_size`: `1293601`
- `name`: `Content-Agent-Studio-Future-Vision-Concept.png`
- `user_id`: `35428fd4`

**Vantagens:** rastreabilidade completa, compatível com `ChannelPieceMedia`, não requer mover arquivo.  
**Riscos:** o `storage_path` aponta para pasta `posts/` — semanticamente incorreto mas funcionalmente OK. Pode ser movido para `library/` em M10 se necessário.

### Opção B — Manter URL em estrutura temporária

**Como:** armazenar `image_url` no EditorialContent sem CPM.  
**Vantagens:** sem importação.  
**Riscos:** `EditorialContent` não tem campo `image_url`. Exigiria adição de campo temporário. Dívida técnica. **Não recomendada.**

### Opção C — Bloquear migração de P1 até decisão

**Como:** migrar P2, P3, P4; deixar P1 com blocker registrado.  
**Vantagens:** simplicidade no início.  
**Riscos:** mídia fica órfã indefinidamente. Aceitável para records de teste.

**Recomendação:** Opção A para P1 (simples, sem mover arquivo, rastreável). Decisão H2.

---

## 9. Validação Técnica

Após cada fase (M8.2 a M8.6):

```bash
pnpm typecheck   # 0 erros
pnpm lint        # 0 erros / ≤ 51 warnings
pnpm build       # sem falha
pnpm validate    # todos passam
```

Baseline atual: `typecheck 0 erros`, `lint 51 warnings/0 erros`, `build aprovado`.

---

## 10. Critérios de Go/No-Go

### Go (migração autorizada) quando:

```
✅ 100% dos Posts inventariados (4/4)
✅ 100% das mídias classificadas (1/1)
✅ Decisão H1 respondida (project_id de P3)
✅ Decisão H2 respondida (mídia de P1)
✅ Decisão H3 respondida (migrar ou descartar os posts de teste)
✅ Decisão H4 respondida (status dos ECs pós-migração)
✅ legacy_post_id coluna criada (M8.2)
✅ Dry-run executado e aprovado (M8.1)
✅ Tag de rollback pré-M8 criada
✅ pnpm validate aprovado
```

### No-Go quando:

```
❌ Qualquer Post sem projeto definido (sem H1 respondida)
❌ Mídia P1 não resolvida e P1 incluído no lote
❌ Dry-run com blockers não resolvidos
❌ pnpm validate falhando
❌ library_files com estrutura de chave incompatível
```

---

## 11. Decisões Humanas Pendentes (resumo)

| # | Questão | Opções | Impacto |
|---|---------|--------|---------|
| H1 | Confirmar `project_id = d0d008c3` para P3 | Confirmar / Rejeitar (não migrar P3) | Desbloqueia P3 |
| H2 | Importar PNG de P1 para `library_files`? | Opção A (importar) / Opção C (bloquear P1) | Desbloqueia P1 |
| H3 | Migrar os 4 posts de teste ou descartá-los? | Migrar todos / Migrar parcialmente / Não migrar (descartar) | Define lote da M8.3 |
| H4 | Status do EditorialContent pós-migração | `ready` (recomendado) / `draft` / `archived` | Define estado inicial |

---

*Documento produzido em discovery M8 — 2026-06-24. Nenhum dado criado. Nenhuma migration executada.*
