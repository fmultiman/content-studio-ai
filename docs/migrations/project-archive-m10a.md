# M10-A — Production de Arquivo: Alquimia Cibernética
**Executado em:** 2026-06-25 · 01:19 UTC  
**Branch:** `feat/project-archive-production-m10a`  
**Manifesto JSON:** `docs/migrations/project-archive-m10a.json`

---

## Objetivo

Criar a Production **"Arquivo — Alquimia Cibernética"** e atribuir a ela todos os
ImageDrafts e VideoDrafts com conteúdo real do Projeto Alquimia Cibernética que
existiam antes da implantação do fluxo de Productions.

Esses registros foram criados via fluxos que bypassam Production (aba Imagens /
aba Vídeos na página do Projeto) e ficaram com `production_id = NULL` desde sua
criação (abr/2026).

---

## Resultado

| Dimensão | Valor |
|----------|-------|
| Production criada | `76120099-e0f0-4b86-ae79-6e13d93f9d75` |
| Título | "Arquivo — Alquimia Cibernética" |
| Tipo | `editorial` |
| Projeto | Alquimia Cibernética (`0b04df8b-dfd3-45c5-b7b7-8fe7b95e8187`) |
| ImageDrafts atribuídos | 4 |
| VideoDrafts atribuídos | 2 |
| Testes preservados (production_id=NULL) | 3 |

---

## ImageDrafts Atribuídos

| id | user_input | tem imagem |
|----|-----------|-----------|
| `c44bf448-350d-4a3f-833b-8d00f5a9f0b0` | "Um símbolo mágico" | ✅ |
| `97508404-c5a9-4d30-ac0a-ac5b7ae0706d` | "Uma floresta vista do alto com pequenas luzes..." | ✅ |
| `e624d457-b632-45f6-902e-d2598d84f6d9` | "Criar um objeto mágico" | ✅ |
| `0eb2a983-4354-451a-8038-fd3f502c2413` | "Uma imagem sobre Alquimia Cibernética" | ✅ |

---

## VideoDrafts Atribuídos

| id | name | num_scenes |
|----|------|-----------|
| `f1029001-2adf-491f-8063-1c2c9c12ab85` | "aluimia01" | 2 |
| `d46d2259-83d8-4633-a040-92a3a64316d7` | "teste3" | 2 |

---

## Registros de Teste Preservados (production_id = NULL)

Esses registros foram explicitamente excluídos da atribuição. São preservados sem
`production_id` e sem alteração de nenhum outro campo.

| id | tipo | motivo |
|----|------|--------|
| `d52b83b6-cf1c-4d83-9491-df0d6408c933` | ImageDraft | "uma montanha antiga" — sem image_url |
| `8c5bbdb7-e864-4cfe-8745-63e1030be9cd` | ImageDraft | "consciência e tecnologia..." — sem image_url |
| `0bc4324c-94f0-41d7-af50-93827ee4da13` | VideoDraft | "testevideo" — apenas 1 cena |

---

## Estado do Banco Antes → Depois

| Tabela | Sem production_id (antes) | Sem production_id (depois) |
|--------|--------------------------|---------------------------|
| `image_drafts` (Alquimia) | 6 | 2 (testes preservados) |
| `video_drafts` (Alquimia) | 3 | 1 (teste preservado) |

---

## Rollback

**Script:** `scripts/project_archive_production_m10a_rollback.mjs`

```bash
PROJECT_ARCHIVE_ROLLBACK_CONFIRM=M10A_ROLLBACK_APPROVED \
node scripts/project_archive_production_m10a_rollback.mjs --execute
```

O rollback:
1. Restaura `production_id = NULL` nos 6 drafts atribuídos
2. Exclui a Production **somente se**: foi criada pelo M10-A + está vazia + sem registros extras
3. **Nunca altera:** images, library_files, S3, ou registros de teste

---

## O que NÃO foi alterado

- Registros de teste (`d52b83b6`, `8c5bbdb7`, `0bc4324c`) — `production_id` permanece NULL
- Tabela `images` — sem campo `production_id`, não modificada
- Tabela `library_files` — sem campo `production_id`, não modificada
- Objetos S3 — não foram tocados
- Campos dos drafts além de `production_id` — não foram modificados
- Production existente "teste" (`c859d21f`) — mantida como está
- APIs de criação de image_drafts e video_drafts — não modificadas
- Abas Imagens e Vídeos na página do Projeto — não removidas
