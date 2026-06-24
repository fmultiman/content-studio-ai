# M8.3A — Execution Manifest: Posts → EditorialContent

**Executado em:** 2026-06-24T18:52:08.814Z  
**Migrados:** 0 | **Já migrados (skip):** 3 | **Erros:** 0

---

## Snapshot Antes

| | Valor |
|-|-------|
| editorial_contents | 6 |
| ec_with_legacy_post_id | 3 |
| channel_pieces | 5 |
| posts | 4 |

## Resultados por Post

### P2 — `7eb9ccf4-7989-4f4b-93ba-c10df0345428`

**Nome:** outro teste de post  
**Resultado:** `ALREADY_MIGRATED`  
**EditorialContent:** `0d4ee522-db02-4766-98aa-d02b2faf1ea1`  
**ChannelPiece:** `64e5bbb3-f8cf-46eb-bafa-2d420d03c6bc`  

### P4 — `7aa6b5a4-8fb2-4e22-937e-82a228f87e8b`

**Nome:** teste 04  
**Resultado:** `ALREADY_MIGRATED`  
**EditorialContent:** `d0138557-ad57-4284-bcdc-322c21c8f599`  
**ChannelPiece:** `ba9d1e7d-38c7-4ca0-8251-a72bdaddce64`  

### P3 — `083a69d5-de8f-4525-b1a1-f495b6404e80`

**Nome:** outro teste de story  
**Resultado:** `ALREADY_MIGRATED`  
**EditorialContent:** `bee05422-04e7-4c80-9d82-ba504303e37d`  
**ChannelPiece:** `05772802-06d7-4249-bae8-d8b8e11b7457`  

---

## Snapshot Depois

| | Valor |
|-|-------|
| editorial_contents | 6 |
| ec_with_legacy_post_id | 3 |
| channel_pieces | 5 |
| posts | 4 |

---

## Rollback

**Script:** `scripts/posts_migration_rollback.mjs`  
**Requer:** `--execute` + `POSTS_MIGRATION_ROLLBACK_CONFIRM=M8_3A_ROLLBACK_APPROVED`  
**Manifesto lido:** `docs/migrations/posts-m8-execution-m8-3a.json`

Ordem de remoção: ChannelPiece → EditorialContent
Nunca toca: `posts`, `library_files`, S3.

---

## P1 (pendente)

P1 (`d02a9507-d6c3-4203-9939-4667a4e0f027`) não foi migrado nesta rodada.
Requer M8.4: cópia S3 + criação de library_file + ChannelPieceMedia.