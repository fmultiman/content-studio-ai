# M8.4 — Execution Manifest: P1 Media Migration

**Executado em:** 2026-06-24T19:22:58.494Z  
**Branch:** `feat/posts-migration-m8-4-p1-media`  
**Base commit:** `6f8af41`  
**Resultado:** `ALREADY_MIGRATED`

---

## Post P1

| Campo | Valor |
|-------|-------|
| post_id | `d02a9507-d6c3-4203-9939-4667a4e0f027` |
| nome | Teste Post Smoke Test 01 |
| fingerprint aprovado | `3e8a92a61914904a087d9eecf48bb894c069313d87fd01dd0d37bf3921e43a68` |
| fingerprint observado | `3e8a92a61914904a087d9eecf48bb894c069313d87fd01dd0d37bf3921e43a68` |
| match | ✅ |

## S3

### Origem

| Campo | Valor |
|-------|-------|
| bucket | `content-studio` |
| key | `users/35428fd4-4784-4934-9af9-82a606aad77e/posts/3f142fc2-df7f-4e39-ae04-ca63832f690d/Content-Agent-Studio-Future-Vision-Concept.png` |
| tamanho esperado | 1293601 |
| tamanho observado | — |
| MIME esperado | image/png |
| ETag esperado | `7997848a1fcbfd6193dc2f867d65a4b1` |
| ETag observado | `—` |
| intacto após migração | — |

### Destino

| Campo | Valor |
|-------|-------|
| bucket | `content-studio` |
| key | `users/35428fd4-4784-4934-9af9-82a606aad77e/library/posts-migration-m8/d02a9507-d6c3-4203-9939-4667a4e0f027/Content-Agent-Studio-Future-Vision-Concept.png` |
| colisão | CLEAR |
| tamanho verificado | — |

## IDs criados

| Entidade | ID |
|----------|-----|
| editorial_content | `16a0bfea-b558-4f26-91ec-2e163d84f9b0` |
| channel_piece | `2a48076c-3aff-4c53-beaf-cd84e028cffd` |
| library_file | `f190c6ad-8ad1-490c-aeaa-3898b69bb0aa` |
| channel_piece_media | `d71eed1d-068b-47ed-aae1-278ca6922cf8` |

## Snapshots

### Antes

| Tabela | Count |
|--------|-------|
| editorial_contents (total) | 7 |
| editorial_contents (com legacy) | 4 |
| channel_pieces | 6 |
| library_files | 4 |
| channel_piece_media | 1 |
| posts | 4 |

### Depois

| Tabela | Count |
|--------|-------|
| editorial_contents (total) | 7 |
| editorial_contents (com legacy) | 4 |
| channel_pieces | 6 |
| library_files | 4 |
| channel_piece_media | 1 |
| posts | 4 |

## Rollback

**Script:** `scripts/posts_migration_m84_rollback.mjs`  
**Confirmação:** `POSTS_MIGRATION_M84_ROLLBACK_CONFIRM=M8_4_ROLLBACK_APPROVED`  
**Ordem:** channel_piece_media → channel_pieces → library_files → editorial_contents → s3_dest  
**S3 dest (apagar):** `users/35428fd4-4784-4934-9af9-82a606aad77e/library/posts-migration-m8/d02a9507-d6c3-4203-9939-4667a4e0f027/Content-Agent-Studio-Future-Vision-Concept.png`  
**S3 source (NUNCA apagar):** `users/35428fd4-4784-4934-9af9-82a606aad77e/posts/3f142fc2-df7f-4e39-ae04-ca63832f690d/Content-Agent-Studio-Future-Vision-Concept.png`

**posts_modified:** false