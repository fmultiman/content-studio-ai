# Posts — Mapeamento de Migração (M8)
**Data:** 2026-06-24  
**Branch:** `discovery/posts-to-editorial-content-m8`  
**Status:** Planejamento — nenhum dado criado.  
**Escopo:** Matriz campo a campo, destino por Post, decisões pendentes, candidatos a agrupamento.

---

## 1. Matriz de Equivalência Campo a Campo

| Campo do `Post` | Entidade alvo | Campo alvo | Transformação | Equivalência | Risco | Decisão humana? |
|-----------------|---------------|-----------|---------------|-------------|-------|-----------------|
| `id` | — | N/A | Novo UUID gerado | Nenhuma — IDs não são reutilizados | Baixo | Não — rastreado via `legacy_post_id` |
| `user_id` | `EditorialContent` + `ChannelPiece` | `user_id` | Cópia direta | Total | Nenhum | Não |
| `project_id` | `EditorialContent` | `project_id` | Cópia direta (se não NULL) | Total | Alto quando NULL — NOT NULL constraint | **Sim para P3** |
| `production_id` | `EditorialContent` | `production_id` | Cópia direta | Total | Nenhum | Não |
| `name` | `EditorialContent` | `title` | Renomear campo | Total | Nenhum | Não |
| `description` | `EditorialContent` | `body` | Renomear campo | Total | Nenhum | Não |
| `ai_context` | `EditorialContent` | `ai_context` | Cópia direta | Total | Nenhum | Não |
| `status: 'draft'` | `EditorialContent` | `status: 'draft'` | Mapeamento direto | Total | Nenhum | Não |
| `status: 'saved'` | `EditorialContent` + `ChannelPiece` | `status: 'ready'` (EC) + `status: 'approved'` (CP) | `saved` → EC `ready` + CP `approved` | Parcial — semântica mais precisa | Baixo | Não |
| `channel: 'instagram_post'` | `ChannelPiece` | `channel: 'instagram'` + `format: 'feed'` | Separar em dois campos via tabela de mapeamento | Total (com tabela) | Baixo | Não |
| `channel: 'instagram_story'` | `ChannelPiece` | `channel: 'instagram'` + `format: 'story'` | Idem | Total | Baixo | Não |
| `channel: 'youtube_post'` | `ChannelPiece` | `channel: 'youtube'` + `format: 'post'` | Idem | Total | Baixo | Não |
| `channel: 'youtube_shorts'` | `ChannelPiece` | `channel: 'youtube'` + `format: 'short'` | Idem | Total | Baixo | Não |
| `channel: 'youtube_video'` | `ChannelPiece` | `channel: 'youtube'` + `format: 'video_description'` | Idem | Total | Baixo | Não |
| `feed_text` | `ChannelPiece` | `body` | Renomear campo | Total | Nenhum | Não |
| `image_url` | `ChannelPieceMedia` | `image_id` ou `library_file_id` | Exige resolução: FK para `images` ou `library_files` | Parcial — sem FK direta | **Alto** | **Sim — para cada URL** |
| `thumbnail_url` | `ChannelPieceMedia` | `role: 'thumbnail'` | Parte do mesmo CPM ou CPM separado | Parcial | Médio | Sim |
| `post_images` (JSONB array) | `ChannelPieceMedia` | N registros | Cada `PostImage` → 1 `ChannelPieceMedia` (se mídia resolvível) | Parcial | Alto — sem FK | Sim para cada item |
| `storage_provider` | `library_files` | `storage_path` (campo de LF) | Migrar para `library_files` ao importar mídia | Ausente em CPM | Médio | Sim |
| `storage_path` | `library_files` | `storage_path` | Importar | Ausente em CPM | Médio | Sim |
| `thumbnail_path` | Descartar ou LF separado | — | Thumbnail gerado pelo upload antigo | Ausente | Baixo | Opcional |
| `file_size` | `library_files` | `file_size` | Importar para LF | Total (em LF) | Nenhum | Não |
| `mime_type` | `library_files` | `mime_type` | Importar para LF | Total (em LF) | Nenhum | Não |
| `created_at` | `EditorialContent` | `created_at` | Preservar — INSERT com valor explícito | Total | Nenhum | Não |
| `updated_at` | `EditorialContent` | `updated_at` | Preservar — INSERT com valor explícito | Total | Nenhum | Não |
| `cta` | `ChannelPiece` | `cta` | Campo não existe em `posts` | **Ausente em Post** | Nenhum | Não — NULL por padrão |
| `hashtags` | `ChannelPiece` | `hashtags` | Campo não existe em `posts` | **Ausente em Post** | Nenhum | Não — NULL por padrão |
| `ChannelPiece.title` | `ChannelPiece` | `title` | Override opcional — NULL se EC.title serve | Total | Nenhum | Não — NULL por padrão |

### 1.1 Tabela de mapeamento `PublicationType` → `channel + format`

| `posts.channel` | `channel_pieces.channel` | `channel_pieces.format` |
|----------------|--------------------------|------------------------|
| `instagram_post` | `instagram` | `feed` |
| `instagram_story` | `instagram` | `story` |
| `youtube_post` | `youtube` | `post` |
| `youtube_shorts` | `youtube` | `short` |
| `youtube_video` | `youtube` | `video_description` |

Definido em `PUBLICATION_DOMAIN_DECISIONS.md` Seção 8.1 (PUB-D16).

---

## 2. Destino Proposto por Post

### Post P1 — `d02a9507` — "Teste Post Smoke Test 01"

**Classificação:** `MIGRÁVEL COM IMPORTAÇÃO DE MÍDIA` + `SMOKE/TESTE`

#### EditorialContent proposto

| Campo | Valor |
|-------|-------|
| `title` | "Teste Post Smoke Test 01" |
| `body` | "POst para apresentar o novo frontend" |
| `ai_context` | "contexto" |
| `status` | `ready` (de `saved`) |
| `project_id` | `d0d008c3` |
| `production_id` | `492af729` |
| `created_at` | `2026-06-23 00:39:43 UTC` (preservar) |
| `updated_at` | `2026-06-23 01:08:39 UTC` (preservar) |
| `user_id` | `35428fd4` |
| metadata | `legacy_post_id: d02a9507-d6c3-4203-9939-4667a4e0f027` |

#### ChannelPiece proposto

| Campo | Valor |
|-------|-------|
| `channel` | `instagram` |
| `format` | `feed` |
| `body` | (texto do `feed_text` — 1.2 KB de legenda Instagram gerada por IA) |
| `cta` | NULL |
| `hashtags` | NULL (hashtags estão embebidas no `feed_text` — não separadas) |
| `status` | `approved` (de `saved`) |
| `title` | NULL (herda do EditorialContent) |

#### ChannelPieceMedia proposto

| Posição | Source | Role | Observação |
|---------|--------|------|-----------|
| 0 | `library_file_id` = ??? | `primary` | **BLOQUEADO** — precisa importar `Content-Agent-Studio-Future-Vision-Concept.png` para `library_files` primeiro. Storage path: `users/35428fd4.../posts/3f142fc2.../Content-Agent-Studio-Future-Vision-Concept.png` |

**Bloqueador:** importação de mídia para `library_files` antes de criar o CPM.

---

### Post P2 — `7eb9ccf4` — "outro teste de post"

**Classificação:** `AUTO_MIGRÁVEL` + `SMOKE/TESTE`

#### EditorialContent proposto

| Campo | Valor |
|-------|-------|
| `title` | "outro teste de post" |
| `body` | "Teste de post de Youtube" |
| `ai_context` | "COntexto correto" |
| `status` | `ready` |
| `project_id` | `d0d008c3` |
| `production_id` | `492af729` |
| `created_at` | `2026-06-23 01:09:28 UTC` |
| `updated_at` | `2026-06-23 01:09:29 UTC` |
| `user_id` | `35428fd4` |
| metadata | `legacy_post_id: 7eb9ccf4-7989-4f4b-93ba-c10df0345428` |

#### ChannelPiece proposto

| Campo | Valor |
|-------|-------|
| `channel` | `youtube` |
| `format` | `post` |
| `body` | NULL (sem `feed_text`) |
| `cta` | NULL |
| `hashtags` | NULL |
| `status` | `approved` |
| `title` | NULL |

#### ChannelPieceMedia proposto

Nenhum — sem mídia.

**Status:** AUTO_MIGRÁVEL — sem bloqueadores.

---

### Post P3 — `083a69d5` — "outro teste de story"

**Classificação:** `EXIGE ATRIBUIÇÃO DE PROJETO` + `SMOKE/TESTE`

#### EditorialContent proposto

| Campo | Valor |
|-------|-------|
| `title` | "outro teste de story" |
| `body` | "teste de story" |
| `ai_context` | "contexto do teste de story" |
| `status` | `ready` |
| `project_id` | **??? — BLOQUEADO** — `posts.project_id = NULL`. Projeto inferível: `d0d008c3` (production.project_id). Confiança: ALTA. Requer confirmação humana. |
| `production_id` | `492af729` |
| `created_at` | `2026-06-23 01:11:34 UTC` |
| `updated_at` | `2026-06-23 01:11:35 UTC` |
| `user_id` | `35428fd4` |
| metadata | `legacy_post_id: 083a69d5-de8f-4525-b1a1-f495b6404e80` |

#### ChannelPiece proposto

| Campo | Valor |
|-------|-------|
| `channel` | `instagram` |
| `format` | `story` |
| `body` | NULL |
| `cta` | NULL |
| `hashtags` | NULL |
| `status` | `approved` |

#### ChannelPieceMedia proposto

Nenhum — sem mídia.

**Decisão humana necessária:** confirmar `project_id = d0d008c3` antes de migrar.

---

### Post P4 — `7aa6b5a4` — "teste 04"

**Classificação:** `AUTO_MIGRÁVEL` + `SMOKE/TESTE`

#### EditorialContent proposto

| Campo | Valor |
|-------|-------|
| `title` | "teste 04" |
| `body` | "teste  04" |
| `ai_context` | NULL |
| `status` | `ready` |
| `project_id` | `d0d008c3` |
| `production_id` | `492af729` |
| `created_at` | `2026-06-23 01:14:16 UTC` |
| `updated_at` | `2026-06-23 01:14:17 UTC` |
| `user_id` | `35428fd4` |
| metadata | `legacy_post_id: 7aa6b5a4-8fb2-4e22-937e-82a228f87e8b` |

#### ChannelPiece proposto

| Campo | Valor |
|-------|-------|
| `channel` | `youtube` |
| `format` | `video_description` |
| `body` | NULL |
| `cta` | NULL |
| `hashtags` | NULL |
| `status` | `approved` |

#### ChannelPieceMedia proposto

Nenhum — sem mídia.

**Status:** AUTO_MIGRÁVEL — sem bloqueadores.

---

## 3. Candidatos a Agrupamento em EditorialContent

A regra padrão é **1 Post → 1 EditorialContent + 1 ChannelPiece** (PUB-D13).

### 3.1 Análise de agrupamento

Todos os 4 Posts estão vinculados à mesma Production (`492af729`). Poderiam ser agrupados em menos EditorialContents com múltiplas ChannelPieces, se representassem adaptações do mesmo conteúdo editorial para canais diferentes.

**Análise dos critérios:**

| Critério | Avaliação |
|----------|-----------|
| Mesmo texto-base | ❌ — cada post tem description diferente e sem relação semântica |
| Mesma mídia | ❌ — apenas P1 tem mídia |
| Canais diferentes do mesmo conteúdo | ❌ — não há evidência de que "Teste Post Smoke Test 01" e "outro teste de post" são o mesmo conteúdo |
| Mesmo período | ✅ — todos criados no mesmo dia (de smoke test) |
| Mesma Production | ✅ — todos na mesma production |

**Conclusão:** Nenhum agrupamento recomendado. Os 4 posts são testes independentes com propósitos distintos. A regra 1:1 se aplica.

### 3.2 Candidatos a agrupamento real (pós-migração)

Dado que todos são registros de teste, a questão de agrupamento real só se torna relevante quando posts de conteúdo genuíno existirem. Critérios a aplicar no futuro:

- `description` textualmente similar (cosine similarity > 0.85)
- Mesmo `production_id`
- Criados com intervalo < 72h
- Canais distintos

---

## 4. Decisões Humanas Pendentes

| # | Decisão | Post(s) | Impacto | Recomendação |
|---|---------|---------|---------|-------------|
| H1 | Confirmar `project_id = d0d008c3` para P3 | P3 (`083a69d5`) | Desbloqueia migração de P3 | Confirmar — evidência forte via production |
| H2 | Decidir sobre importação da mídia PNG de P1 | P1 (`d02a9507`) | Desbloqueia ChannelPieceMedia de P1 | Importar para `library_files` com `kind='image'` |
| H3 | Decidir se todos os Posts devem ser migrados ou descartados | Todos (4) | Todos são de teste — pode ser válido marcar como "NÃO DEVE SER MIGRADO" | Consultar usuário responsável |
| H4 | Confirmar status do EditorialContent pós-migração | Todos | `saved` → `ready`? `ready` → `approved`? | Recomendado: EC→`ready`, CP→`approved` |

---

*Documento produzido em discovery M8 — 2026-06-24. Nenhum dado criado.*
