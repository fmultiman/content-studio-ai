# M8.1 — Dry-Run Report: Posts → EditorialContent
**Gerado em:** 2026-06-24T17:39:27.423Z  
**Status geral:** READY  
**Posts:** 4 | **Blockers:** 0 | **Warnings:** 0

---

## Resumo

| Categoria | Qtd |
|-----------|-----|
| AUTO_MIGRÁVEL | 2 |
| MIGRÁVEL COM IMPORTAÇÃO DE MÍDIA | 1 |
| EXIGE ATRIBUIÇÃO DE PROJETO | 1 |
| Já migrados (skip) | 0 |
| Total blockers | 0 |
| Total warnings | 0 |

**Decisões aplicadas:** H1=d0d008c3-321b-46fe-8225-2f1a68e833ec · H2=import_media=true · H3=migrate_all=true · H4=status=draft

---

## Plano por Post

| Post | Projeto | Production | Canal | Formato | EC proposto | CP proposta | Mídias | Ações | Blockers | Status |
|------|---------|------------|-------|---------|-------------|-------------|--------|-------|----------|--------|
| Teste Post Smoke Test  | d0d008c3 | 492af729 | instagram | feed | ec:d02a9507-d6c3-4203-9939-4667a4e0f027 | cp:d02a9507-d6c3-4203-9939-4667a4e0f027 | 1 (import LF) | CopiarS3 + ImportLF + CPM | — | **READY** |
| outro teste de post | d0d008c3 | 492af729 | youtube | post | ec:7eb9ccf4-7989-4f4b-93ba-c10df0345428 | cp:7eb9ccf4-7989-4f4b-93ba-c10df0345428 | 0 | Direto | — | **READY** |
| outro teste de story | d0d008c3 | 492af729 | instagram | story | ec:083a69d5-de8f-4525-b1a1-f495b6404e80 | cp:083a69d5-de8f-4525-b1a1-f495b6404e80 | 0 | Direto | — | **READY** |
| teste 04 | d0d008c3 | 492af729 | youtube | video_description | ec:7aa6b5a4-8fb2-4e22-937e-82a228f87e8b | cp:7aa6b5a4-8fb2-4e22-937e-82a228f87e8b | 0 | Direto | — | **READY** |

---

## Post: Teste Post Smoke Test 01 (d02a9507-d6c3-4203-9939-4667a4e0f027)

**Classificação:** MIGRÁVEL COM IMPORTAÇÃO DE MÍDIA, SMOKE/TESTE  
**Fingerprint:** `3e8a92a61914904a087d9eecf48bb894c069313d87fd01dd0d37bf3921e43a68`  
**updated_at:** 2026-06-23T01:08:39.376895+00:00  
**Origem alterada:** false  
**Já migrado:** false  
**Status dry-run:** **READY**

**EditorialContent proposto:**
```
  symbolic_id:   ec:d02a9507-d6c3-4203-9939-4667a4e0f027
  title:         "Teste Post Smoke Test 01"
  status:        draft
  project_id:    d0d008c3-321b-46fe-8225-2f1a68e833ec
  production_id: 492af729-cb06-4e0e-8a2c-e83fada37fb1
  body:          "POst para apresentar o novo frontend…"
  ai_context:    "contexto"
  legacy_post_id: d02a9507-d6c3-4203-9939-4667a4e0f027
```

**ChannelPiece proposta:**
```
  symbolic_id: cp:d02a9507-d6c3-4203-9939-4667a4e0f027
  channel:     instagram
  format:      feed
  status:      draft
  body:        "🖥️✨ **Apresentamos o Futuro do Content Agent!** ✨🖥️

Estam…"
```
*CP status = draft: registros de teste (H4). Equivalência: posts.status="saved" → "approved" para conteúdo real; "draft" para teste.*

**Plano de mídia (P1):**

| Campo | Valor |
|-------|-------|
| Ação | IMPORT_LIBRARY_FILE_VIA_S3_COPY |
| Origem (bucket) | content-studio |
| Origem (key) | `users/35428fd4-4784-4934-9af9-82a606aad77e/posts/3f142fc2-df7f-4e39-ae04-ca63832f690d/Content-Agent-Studio-Future-Vision-Concept.png` |
| Origem existe? | true |
| Origem Content-Type | image/png |
| Origem tamanho | 1293601 bytes |
| Origem ETag | 7997848a1fcbfd6193dc2f867d65a4b1 |
| Destino (key) | `users/35428fd4-4784-4934-9af9-82a606aad77e/library/posts-migration-m8/d02a9507-d6c3-4203-9939-4667a4e0f027/Content-Agent-Studio-Future-Vision-Concept.png` |
| Destino existe? | false |
| public_url destino | https://s3.multihuman.com.br/content-studio/users/35428fd4-4784-4934-9af9-82a606aad77e/library/posts-migration-m8/d02a9507-d6c3-4203-9939-4667a4e0f027/Content-Agent-Studio-Future-Vision-Concept.png |
| kind | image |
| mime_type | image/png |
| file_size | 1293601 |
| LF simbólico | lf:d02a9507-d6c3-4203-9939-4667a4e0f027:0 |
| CPM simbólico | cpm:d02a9507-d6c3-4203-9939-4667a4e0f027:0 |
| role | primary |
| position | 0 |

Políticas de rollback de mídia:
- Se destino já existe: FAIL — exige resolução manual antes de prosseguir
- Se cópia OK mas LF INSERT falha: ROLLBACK cópia (DELETE dstKey) — nunca criar LF sem objeto
- Se LF OK mas CPM falha: ROLLBACK LF (DELETE library_file) e cópia S3 — manter atomicidade

## Post: outro teste de post (7eb9ccf4-7989-4f4b-93ba-c10df0345428)

**Classificação:** AUTO_MIGRÁVEL, SMOKE/TESTE  
**Fingerprint:** `6d3cbc65c625aa64d4eb8621c09f91492433cc2f33c09cdb88586254833f7a58`  
**updated_at:** 2026-06-23T01:09:29.849458+00:00  
**Origem alterada:** false  
**Já migrado:** false  
**Status dry-run:** **READY**

**EditorialContent proposto:**
```
  symbolic_id:   ec:7eb9ccf4-7989-4f4b-93ba-c10df0345428
  title:         "outro teste de post"
  status:        draft
  project_id:    d0d008c3-321b-46fe-8225-2f1a68e833ec
  production_id: 492af729-cb06-4e0e-8a2c-e83fada37fb1
  body:          "Teste de post de Youtube…"
  ai_context:    "COntexto correto"
  legacy_post_id: 7eb9ccf4-7989-4f4b-93ba-c10df0345428
```

**ChannelPiece proposta:**
```
  symbolic_id: cp:7eb9ccf4-7989-4f4b-93ba-c10df0345428
  channel:     youtube
  format:      post
  status:      draft
  body:        null
```
*CP status = draft: registros de teste (H4). Equivalência: posts.status="saved" → "approved" para conteúdo real; "draft" para teste.*

## Post: outro teste de story (083a69d5-de8f-4525-b1a1-f495b6404e80)

**Classificação:** EXIGE ATRIBUIÇÃO DE PROJETO, SMOKE/TESTE  
**Fingerprint:** `0a0b81fa695db6b841c750a8ace982b42d5281b299fbd4f31fdd8eba3b2080d1`  
**updated_at:** 2026-06-23T01:11:35.379153+00:00  
**Origem alterada:** false  
**Já migrado:** false  
**Status dry-run:** **READY**

> **H1 aplicada:** project_id original = null → atribuído `d0d008c3-321b-46fe-8225-2f1a68e833ec` (source: human_approved, confiança: confirmed)

**EditorialContent proposto:**
```
  symbolic_id:   ec:083a69d5-de8f-4525-b1a1-f495b6404e80
  title:         "outro teste de story"
  status:        draft
  project_id:    d0d008c3-321b-46fe-8225-2f1a68e833ec
  production_id: 492af729-cb06-4e0e-8a2c-e83fada37fb1
  body:          "teste de story…"
  ai_context:    "contexto do teste de story"
  legacy_post_id: 083a69d5-de8f-4525-b1a1-f495b6404e80
```

**ChannelPiece proposta:**
```
  symbolic_id: cp:083a69d5-de8f-4525-b1a1-f495b6404e80
  channel:     instagram
  format:      story
  status:      draft
  body:        null
```
*CP status = draft: registros de teste (H4). Equivalência: posts.status="saved" → "approved" para conteúdo real; "draft" para teste.*

## Post: teste 04 (7aa6b5a4-8fb2-4e22-937e-82a228f87e8b)

**Classificação:** AUTO_MIGRÁVEL, SMOKE/TESTE  
**Fingerprint:** `8edbcebf2a97381d07b8e662450de1a4415152ac66b1c8fc1e512be42895dd31`  
**updated_at:** 2026-06-23T01:14:17.513889+00:00  
**Origem alterada:** false  
**Já migrado:** false  
**Status dry-run:** **READY**

**EditorialContent proposto:**
```
  symbolic_id:   ec:7aa6b5a4-8fb2-4e22-937e-82a228f87e8b
  title:         "teste 04"
  status:        draft
  project_id:    d0d008c3-321b-46fe-8225-2f1a68e833ec
  production_id: 492af729-cb06-4e0e-8a2c-e83fada37fb1
  body:          "teste  04…"
  ai_context:    null
  legacy_post_id: 7aa6b5a4-8fb2-4e22-937e-82a228f87e8b
```

**ChannelPiece proposta:**
```
  symbolic_id: cp:7aa6b5a4-8fb2-4e22-937e-82a228f87e8b
  channel:     youtube
  format:      video_description
  status:      draft
  body:        null
```
*CP status = draft: registros de teste (H4). Equivalência: posts.status="saved" → "approved" para conteúdo real; "draft" para teste.*

---

## Rastreabilidade recomendada

**Coluna:** `editorial_contents.legacy_post_id UUID NULL`

**Tipo UUID em vez de TEXT:** `posts.id` é UUID — manter o mesmo tipo preserva
  integridade semântica e permite comparação eficiente sem cast.

**Índice:**
```sql
CREATE UNIQUE INDEX idx_ec_legacy_post_id
  ON editorial_contents (legacy_post_id)
  WHERE legacy_post_id IS NOT NULL;
```

**`legacy_source` é desnecessário nesta migration:** só existe uma fonte legada.
  Generalização prematura. Adicionar apenas se surgir segunda fonte.

---

## Idempotência

**Chave:** `editorial_contents.legacy_post_id = posts.id`

**Algoritmo da execução real:**
1. Para cada `posts.id` no lote: `SELECT id FROM editorial_contents WHERE legacy_post_id = $1`
2. Se retornar registro: **pular** — já migrado, registrar skip
3. Se retornar múltiplos: **FAIL** — inconsistência, exige intervenção manual
4. Se não retornar: prosseguir com INSERT

**Para mídia importada:** verificar se `library_files.storage_path = dest_key` já existe.
  Se sim e LF.user_id bate: assumir idempotente. Se não bate: FAIL.

---

## Rollback completo

```sql
BEGIN;

  -- 1. Remover CPMs criados pela migração
  DELETE FROM channel_piece_media
  WHERE channel_piece_id IN (
    SELECT id FROM channel_pieces
    WHERE editorial_content_id IN (
      SELECT id FROM editorial_contents WHERE legacy_post_id IS NOT NULL
    )
  );

  -- 2. Remover CPs criadas pela migração
  DELETE FROM channel_pieces
  WHERE editorial_content_id IN (
    SELECT id FROM editorial_contents WHERE legacy_post_id IS NOT NULL
  );

  -- 3. Remover ECs criados pela migração
  DELETE FROM editorial_contents WHERE legacy_post_id IS NOT NULL;

  -- 4. Remover LFs importados pela migração (apenas os do M8)
  DELETE FROM library_files
  WHERE storage_path LIKE 'users/%/library/posts-migration-m8/%';

COMMIT;

-- 5. S3: deletar objetos em users/*/library/posts-migration-m8/* (fora de transação)
-- Nunca deletar users/*/posts/* (objetos originais)
-- Nunca deletar posts.* (tabela source)
```

---

## Aprovação individual

Cada Post deve ser aprovado individualmente antes de prosseguir com M8.2+.

| Post | Name | Fingerprint | Status | Decisão |
|------|------|-------------|--------|---------|
| d02a9507 | Teste Post Smoke Test 01 | `3e8a92a61914...` | ✅ READY | **APPROVE / REJECT** |
| 7eb9ccf4 | outro teste de post | `6d3cbc65c625...` | ✅ READY | **APPROVE / REJECT** |
| 083a69d5 | outro teste de story | `0a0b81fa695d...` | ✅ READY | **APPROVE / REJECT** |
| 7aa6b5a4 | teste 04 | `8edbcebf2a97...` | ✅ READY | **APPROVE / REJECT** |

**Nota:** APPROVE/REJECT acima são campos a preencher pelo responsável. O dry-run não aprova automaticamente.

---

*Gerado por scripts/posts_migration_dry_run.mjs — M8.1 Dry-Run — 2026-06-24*