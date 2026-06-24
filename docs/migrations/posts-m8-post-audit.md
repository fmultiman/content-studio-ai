# M8.5A — Post-Migration Audit Report

**Data:** 2026-06-24T19:42:09.932Z  
**Branch:** `feat/posts-migration-m8-5a-audit`  
**Resultado:** `PASS`  
**Checks:** 139 total | ✓ 139 PASS | ⚠ 0 WARN | ✗ 0 FAIL

---

## Matriz P1–P4

| Post | EC | CP | Canal | Formato | Mídia | Status |
|------|----|----|-------|---------|-------|--------|
| P1 | `16a0bfea…` | `2a48076c…` | instagram | feed | LF+CPM | **PASS** |
| P2 | `0d4ee522…` | `64e5bbb3…` | youtube | post | — | **PASS** |
| P3 | `bee05422…` | `05772802…` | instagram | story | — | **PASS** |
| P4 | `d0138557…` | `ba9d1e7d…` | youtube | video_description | — | **PASS** |

---

## Verificações globais (B)

| ID | Status | Verificação |
|----|--------|-------------|
| B01 | ✅ | posts count = 4 (expected 4) |
| B02 | ✅ | editorial_contents com legacy_post_id = 4 (expected 4) |
| B03 | ✅ | legacy_post_id únicos = 4 (expected 4, no duplicates) |
| B04 | ✅ | todos os 4 post IDs esperados presentes |
| B05 | ✅ | todos os 4 EC IDs esperados presentes |
| B06 | ✅ | ECs inesperados com legacy_post_id = 0 |
| B07 | ✅ | CPs órfãos (vinculados a EC fora do set) = 0 |
| B08 | ✅ | CPMs vinculados aos CPs da migração = 1 (expected 1 — só P1) |
| B09 | ✅ | library_files com path posts-migration-m8 = 1 (expected 1 — só P1) |

---

## Verificações por post

### P1 — PASS

| ID | Status | Verificação |
|----|--------|-------------|
| P1-C01 | ✅ | post exists |
| P1-C02 | ✅ | post.name "Teste Post Smoke Test 01" == expected "Teste Post Smoke Test 01" |
| P1-C03 | ✅ | post.channel "instagram_post" == expected "instagram_post" |
| P1-C04 | ✅ | post.project_id "d0d008c3-321b-46fe-8225-2f1a68e833ec" == expected "d0d008c3-321b-46fe-8225-2f1a68e833ec" |
| P1-C05 | ✅ | post.updated_at matches baseline (not written) |
| P1-C06 | ✅ | fingerprint 3e8a92a61914… == approved 3e8a92a61914… |
| P1-C07 | ✅ | EC 16a0bfea-b558-4f26-91ec-2e163d84f9b0 exists |
| P1-C08 | ✅ | EC.legacy_post_id "d02a9507-d6c3-4203-9939-4667a4e0f027" == post.id |
| P1-C09 | ✅ | EC.project_id "d0d008c3-321b-46fe-8225-2f1a68e833ec" == expected "d0d008c3-321b-46fe-8225-2f1a68e833ec" |
| P1-C10 | ✅ | EC.status = "draft" (expected: draft) |
| P1-C11 | ✅ | EC.title = post.name "Teste Post Smoke Test 01…" [DIRECT MAP] |
| P1-C12 | ✅ | EC.body vs post.description: match [DIRECT MAP] |
| P1-C13 | ✅ | EC.ai_context matches post.ai_context [DIRECT MAP] |
| P1-C14 | ✅ | CP 2a48076c-3aff-4c53-beaf-cd84e028cffd exists |
| P1-C15 | ✅ | CP.editorial_content_id == EC.id |
| P1-C16 | ✅ | CP.channel = "instagram" (expected: "instagram") [CHANNEL_MAP] |
| P1-C17 | ✅ | CP.format = "feed" (expected: "feed") [CHANNEL_MAP] |
| P1-C18 | ✅ | CP.status = "draft" (expected: draft) |
| P1-C19 | ✅ | CP.body vs post.feed_text: match [DIRECT MAP] (length: 867) |
| P1-C20 | ✅ | no duplicate EC for post: 0 extra ECs found |
| P1-M01 | ✅ | LF f190c6ad-8ad1-490c-aeaa-3898b69bb0aa exists |
| P1-M02 | ✅ | LF.storage_path == expected dest key |
| P1-M03 | ✅ | LF.user_id correct |
| P1-M04 | ✅ | LF.kind = "image" (expected: image) |
| P1-M05 | ✅ | LF.mime_type = "image/png" (expected: image/png) |
| P1-M06 | ✅ | LF.file_size = 1293601 (expected: 1293601) |
| P1-M07 | ✅ | LF.thumbnail_url = null ✓ (decision: thumbnail null) |
| P1-M08 | ✅ | CPM d71eed1d-068b-47ed-aae1-278ca6922cf8 exists |
| P1-M09 | ✅ | CPM.channel_piece_id == CP.id |
| P1-M10 | ✅ | CPM.library_file_id == LF.id |
| P1-M11 | ✅ | CPM.role = "primary" (expected: primary) |
| P1-M12 | ✅ | CPM.position = 0 (expected: 0) |
| P1-M13 | ✅ | CPM.image_id = null (only library_file_id set — correct) |
| P1-M14 | ✅ | exactly 1 LF in migration namespace for P1 |
| P1-M15 | ✅ | exactly 1 CPM for P1 CP |
| P1-S01 | ✅ | S3 source exists: Content-Agent-Studio-Future-Vision-Concept.png |
| P1-S02 | ✅ | S3 source size = 1293601 (expected: 1293601) |
| P1-S03 | ✅ | S3 source MIME = "image/png" (expected: image/png) |
| P1-S04 | ✅ | S3 source ETag = "7997848a1fcbfd6193dc2f867d65a4b1" (expected: 7997848a1fcbfd6193dc2f867d65a4b1) |
| P1-S05 | ✅ | S3 dest exists: posts-migration-m8/d02a9507-d6c3-4203-9939-4667a4e0f027/Content-Agent-Studio-Future-Vision-Concept.png |
| P1-S06 | ✅ | S3 dest size = 1293601 (expected: 1293601) |
| P1-S07 | ✅ | S3 dest MIME = "image/png" (expected: image/png) |
| P1-S08 | ✅ | S3 dest ETag = "7997848a1fcbfd6193dc2f867d65a4b1" (matches source ETag — content equivalent) |
| P1-S09 | ✅ | source key != dest key (source not overwritten) |

### P2 — PASS

| ID | Status | Verificação |
|----|--------|-------------|
| P2-C01 | ✅ | post exists |
| P2-C02 | ✅ | post.name "outro teste de post" == expected "outro teste de post" |
| P2-C03 | ✅ | post.channel "youtube_post" == expected "youtube_post" |
| P2-C04 | ✅ | post.project_id "d0d008c3-321b-46fe-8225-2f1a68e833ec" == expected "d0d008c3-321b-46fe-8225-2f1a68e833ec" |
| P2-C05 | ✅ | post.updated_at matches baseline (not written) |
| P2-C06 | ✅ | fingerprint 6d3cbc65c625… == approved 6d3cbc65c625… |
| P2-C07 | ✅ | EC 0d4ee522-db02-4766-98aa-d02b2faf1ea1 exists |
| P2-C08 | ✅ | EC.legacy_post_id "7eb9ccf4-7989-4f4b-93ba-c10df0345428" == post.id |
| P2-C09 | ✅ | EC.project_id "d0d008c3-321b-46fe-8225-2f1a68e833ec" == expected "d0d008c3-321b-46fe-8225-2f1a68e833ec" |
| P2-C10 | ✅ | EC.status = "draft" (expected: draft) |
| P2-C11 | ✅ | EC.title = post.name "outro teste de post…" [DIRECT MAP] |
| P2-C12 | ✅ | EC.body vs post.description: match [DIRECT MAP] |
| P2-C13 | ✅ | EC.ai_context matches post.ai_context [DIRECT MAP] |
| P2-C14 | ✅ | CP 64e5bbb3-f8cf-46eb-bafa-2d420d03c6bc exists |
| P2-C15 | ✅ | CP.editorial_content_id == EC.id |
| P2-C16 | ✅ | CP.channel = "youtube" (expected: "youtube") [CHANNEL_MAP] |
| P2-C17 | ✅ | CP.format = "post" (expected: "post") [CHANNEL_MAP] |
| P2-C18 | ✅ | CP.status = "draft" (expected: draft) |
| P2-C19 | ✅ | CP.body vs post.feed_text: match [DIRECT MAP] (length: 0) |
| P2-C20 | ✅ | no duplicate EC for post: 0 extra ECs found |
| P2-M00 | ✅ | no media expected (P2 phase: M8.3A) — CPMs for EC: 0 ✓ |

### P3 — PASS

| ID | Status | Verificação |
|----|--------|-------------|
| P3-C01 | ✅ | post exists |
| P3-C02 | ✅ | post.name "outro teste de story" == expected "outro teste de story" |
| P3-C03 | ✅ | post.channel "instagram_story" == expected "instagram_story" |
| P3-C04 | ✅ | P3/H1: post.project_id = NULL (preserved, NOT written) — OK |
| P3-C05 | ✅ | post.updated_at matches baseline (not written) |
| P3-C06 | ✅ | fingerprint 0a0b81fa695d… == approved 0a0b81fa695d… |
| P3-C07 | ✅ | EC bee05422-04e7-4c80-9d82-ba504303e37d exists |
| P3-C08 | ✅ | EC.legacy_post_id "083a69d5-de8f-4525-b1a1-f495b6404e80" == post.id |
| P3-C09 | ✅ | EC.project_id "d0d008c3-321b-46fe-8225-2f1a68e833ec" == expected "d0d008c3-321b-46fe-8225-2f1a68e833ec" |
| P3-C10 | ✅ | EC.status = "draft" (expected: draft) |
| P3-C11 | ✅ | EC.title = post.name "outro teste de story…" [DIRECT MAP] |
| P3-C12 | ✅ | EC.body vs post.description: match [DIRECT MAP] |
| P3-C13 | ✅ | EC.ai_context matches post.ai_context [DIRECT MAP] |
| P3-C14 | ✅ | CP 05772802-06d7-4249-bae8-d8b8e11b7457 exists |
| P3-C15 | ✅ | CP.editorial_content_id == EC.id |
| P3-C16 | ✅ | CP.channel = "instagram" (expected: "instagram") [CHANNEL_MAP] |
| P3-C17 | ✅ | CP.format = "story" (expected: "story") [CHANNEL_MAP] |
| P3-C18 | ✅ | CP.status = "draft" (expected: draft) |
| P3-C19 | ✅ | CP.body vs post.feed_text: match [DIRECT MAP] (length: 0) |
| P3-C20 | ✅ | no duplicate EC for post: 0 extra ECs found |
| P3-M00 | ✅ | no media expected (P3 phase: M8.3A) — CPMs for EC: 0 ✓ |
| P3-H01 | ✅ | H1: post.project_id = NULL (legado preservado — PASS, NOT a divergence) |
| P3-H02 | ✅ | H1: EC.project_id = d0d008c3 (decisão H1 aplicada corretamente) |
| P3-H03 | ✅ | H1: post.project_id != EC.project_id (expected divergence — PASS H1 APPLIED) |

### P4 — PASS

| ID | Status | Verificação |
|----|--------|-------------|
| P4-C01 | ✅ | post exists |
| P4-C02 | ✅ | post.name "teste 04" == expected "teste 04" |
| P4-C03 | ✅ | post.channel "youtube_video" == expected "youtube_video" |
| P4-C04 | ✅ | post.project_id "d0d008c3-321b-46fe-8225-2f1a68e833ec" == expected "d0d008c3-321b-46fe-8225-2f1a68e833ec" |
| P4-C05 | ✅ | post.updated_at matches baseline (not written) |
| P4-C06 | ✅ | fingerprint 8edbcebf2a97… == approved 8edbcebf2a97… |
| P4-C07 | ✅ | EC d0138557-ad57-4284-bcdc-322c21c8f599 exists |
| P4-C08 | ✅ | EC.legacy_post_id "7aa6b5a4-8fb2-4e22-937e-82a228f87e8b" == post.id |
| P4-C09 | ✅ | EC.project_id "d0d008c3-321b-46fe-8225-2f1a68e833ec" == expected "d0d008c3-321b-46fe-8225-2f1a68e833ec" |
| P4-C10 | ✅ | EC.status = "draft" (expected: draft) |
| P4-C11 | ✅ | EC.title = post.name "teste 04…" [DIRECT MAP] |
| P4-C12 | ✅ | EC.body vs post.description: match [DIRECT MAP] |
| P4-C13 | ✅ | EC.ai_context matches post.ai_context [DIRECT MAP] |
| P4-C14 | ✅ | CP ba9d1e7d-38c7-4ca0-8251-a72bdaddce64 exists |
| P4-C15 | ✅ | CP.editorial_content_id == EC.id |
| P4-C16 | ✅ | CP.channel = "youtube" (expected: "youtube") [CHANNEL_MAP] |
| P4-C17 | ✅ | CP.format = "video_description" (expected: "video_description") [CHANNEL_MAP] |
| P4-C18 | ✅ | CP.status = "draft" (expected: draft) |
| P4-C19 | ✅ | CP.body vs post.feed_text: match [DIRECT MAP] (length: 0) |
| P4-C20 | ✅ | no duplicate EC for post: 0 extra ECs found |
| P4-M00 | ✅ | no media expected (P4 phase: M8.3A) — CPMs for EC: 0 ✓ |

---

## Manifests (D)

| ID | Status | Verificação |
|----|--------|-------------|
| D01 | ✅ | manifesto M8.3A carregado: posts-m8-execution-m8-3a.json |
| D02 | ✅ | manifesto M8.4 carregado: posts-m8-execution-m8-4.json |
| D-P1-EC-M84 | ✅ | M8.4 manifest EC == expected EC ID |
| D-P1-CP-M84 | ✅ | M8.4 manifest CP == expected CP ID |
| D-P1-LF-M84 | ✅ | M8.4 manifest LF == expected LF ID |
| D-P1-CPM-M84 | ✅ | M8.4 manifest CPM == expected CPM ID |
| D-P1-DEST | ✅ | M8.4 manifest S3 dest key == expected |
| D-P1-FP | ✅ | M8.4 manifest fingerprint matches approved |

---

## Rollback (E)

**Status:** ROLLBACK AVAILABLE — NOT EXECUTED

| ID | Status | Verificação |
|----|--------|-------------|
| E01 | ✅ | M8.3A rollback script exists |
| E02 | ✅ | M8.4 rollback script exists |
| E03 | ✅ | M8.3A rollback: requires explicit confirmation |
| E04 | ✅ | M8.3A rollback: validates EC.legacy_post_id before delete |
| E05 | ✅ | M8.3A rollback: does not delete posts |
| E06 | ✅ | M8.4 rollback: requires explicit confirmation |
| E07 | ✅ | M8.4 rollback: guards against deleting source S3 object |
| E08 | ✅ | M8.4 rollback: validates EC.legacy_post_id == P1 before delete |
| E09 | ✅ | M8.4 rollback: validates LF.storage_path before delete |
| E10 | ✅ | M8.4 rollback: correct FK-safe deletion order |
| E11 | ✅ | M8.4 rollback: source never-delete protection |
| E12 | ✅ | M8.4 rollback: does not delete posts (no posts DELETE call) |

---

## Inspeção Visual (F)

**Status:** VISUAL REVIEW REQUIRED — authenticated browser session needed

| Post | URL |
|------|-----|
| P1 | `https://content.multihuman.com.br/projetos/d0d008c3-321b-46fe-8225-2f1a68e833ec/conteudos/16a0bfea-b558-4f26-91ec-2e163d84f9b0` |
| P2 | `https://content.multihuman.com.br/projetos/d0d008c3-321b-46fe-8225-2f1a68e833ec/conteudos/0d4ee522-db02-4766-98aa-d02b2faf1ea1` |
| P3 | `https://content.multihuman.com.br/projetos/d0d008c3-321b-46fe-8225-2f1a68e833ec/conteudos/bee05422-04e7-4c80-9d82-ba504303e37d` |
| P4 | `https://content.multihuman.com.br/projetos/d0d008c3-321b-46fe-8225-2f1a68e833ec/conteudos/d0138557-ad57-4284-bcdc-322c21c8f599` |

---

## Recomendação

**M8.5A POST-MIGRATION AUDIT APROVADO — READY FOR LEGACY MARKING**

Pendência obrigatória antes da marcação do legado:
- [ ] Revisão visual humana (inspeção autenticada de cada EC via URL acima)