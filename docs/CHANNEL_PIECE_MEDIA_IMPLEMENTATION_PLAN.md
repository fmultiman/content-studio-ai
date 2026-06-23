# ChannelPiece Media — Plano de Implementação
**Data:** 2026-06-22 (rev. 5 — M3 implementado e auditado 2026-06-23)  
**Status:** M1 ✓. M2 ✓. M3 IMPLEMENTADO E AUDITADO ✓. M4 aguarda autorização explícita.

> Cada incremento é deployável e testável de forma independente.  
> Nenhum incremento quebra o que existe. Posts legados permanecem funcionais até M8.

---

## Pré-condições confirmadas

- [x] Todas as decisões CPM-D1 a CPM-D21 aprovadas
- [x] Migration 021 aplicada em produção (`editorial_contents` e `channel_pieces` existem)
- [x] Questões bloqueantes para M1–M4 respondidas
- [x] Branch `feat/channel-piece-media-m1-schema` criado a partir de `main` (`6e5fefe`)

---

## M1 — Schema, constraints, índices, RLS e tipos

**Objetivo:** Criar a tabela `channel_piece_media` com schema final, RLS completo e índices. Sem API, sem UI.

**Decisões que fundamentam:** CPM-D1, CPM-D2, CPM-D3, CPM-D4, CPM-D9, CPM-D10, CPM-D11, CPM-D16, CPM-D19, CPM-D20

**Arquivo:** `scripts/022_create_channel_piece_media.sql` (289 linhas — ver arquivo para SQL completo)

**Tipos TypeScript:** `lib/types.ts` — `ChannelPieceMediaRole`, `ChannelPieceMedia`, `ChannelPieceMediaResolved`

**Validação de M1 — Auditoria em banco (2026-06-23) — Ambiente: Produção `nuhdhnasuohizxtmyiju`:**

### Schema e objetos — verificados diretamente no banco

| Objeto | Status |
|--------|--------|
| Tabela `channel_piece_media` | ✅ criada |
| RLS ativa | ✅ `relrowsecurity = true` |
| Policy `cpm_select_own` (SELECT) | ✅ instalada |
| Policy `cpm_insert_own` (INSERT, com JOIN 2 níveis project consistency) | ✅ instalada |
| Policy `cpm_update_own` (UPDATE, USING + WITH CHECK) | ✅ instalada |
| Policy `cpm_delete_own` (DELETE) | ✅ instalada |
| Trigger `cpm_updated_at` BEFORE UPDATE | ✅ instalado |
| Constraint `cpm_exactly_one_source` (CHECK XOR) | ✅ ativa |
| Constraint `cpm_unique_position` (UNIQUE DEFERRABLE) | ✅ ativa |
| CHECK `position >= 0` | ✅ ativa |
| CHECK `role IN (...)` | ✅ ativa |
| CHECK `alt_text IS NULL OR char_length <= 1000` | ✅ ativa |
| FK `channel_piece_id → channel_pieces ON DELETE CASCADE` | ✅ |
| FK `image_id → images ON DELETE RESTRICT` | ✅ |
| FK `library_file_id → library_files ON DELETE RESTRICT` | ✅ |
| FK `user_id → auth.users ON DELETE CASCADE` | ✅ |
| Índice `idx_cpm_user_cp` | ✅ |
| Índice parcial `idx_cpm_image_id` (WHERE NOT NULL) | ✅ |
| Índice parcial `idx_cpm_library_file_id` (WHERE NOT NULL) | ✅ |
| Índice único parcial `uq_cpm_cp_primary` (WHERE role = 'primary') | ✅ |

### Matriz de testes — executada via REST API (service_role) + inspeção de policies

| # | Caso | Mecanismo | Resultado |
|---|------|-----------|-----------|
| 1 | CP-A1 + Image-A mesmo projeto, primary, pos=0 | — | ✅ PASS |
| 2 | CP-A1 + LF-A mesmo projeto, thumbnail, pos=1 | — | ✅ PASS |
| 3 | Várias mídias posições diferentes | — | ✅ PASS |
| 4 | roles não-primary repetidas (carousel_item×2) | — | ✅ PASS |
| 5 | alt_text exatamente 1000 chars | CHECK | ✅ PASS |
| 6 | UPDATE alt_text → updated_at alterado | trigger | ✅ PASS |
| 7 | DELETE associação → fonte intacta | FK RESTRICT | ✅ PASS |
| 8 | image_id e library_file_id ambos preenchidos | `cpm_exactly_one_source` | ✅ REJEITADO (23514) |
| 9 | Ambos nulos | `cpm_exactly_one_source` | ✅ REJEITADO (23514) |
| 10 | CP-A1 + Image de Projeto B (mesmo usuário) | RLS INSERT WITH CHECK | ⚠ verificado por inspeção (ver nota) |
| 11 | CP-A1 + LibraryFile de Projeto B | RLS INSERT WITH CHECK | ⚠ verificado por inspeção (ver nota) |
| 12 | Fonte com project_id = NULL | RLS INSERT WITH CHECK | ⚠ verificado por inspeção (ver nota) |
| 13 | Posição duplicada na mesma CP | `cpm_unique_position` | ✅ REJEITADO (23505) |
| 14 | Mesma posição em CPs diferentes | — | ✅ PASS |
| 15 | Posição negativa (-1) | CHECK `position >= 0` | ✅ REJEITADO (23514) |
| 16 | Primeiro `primary` em CP | `uq_cpm_cp_primary` | ✅ PASS |
| 17 | Segundo `primary` na mesma CP | `uq_cpm_cp_primary` | ✅ REJEITADO (23505) |
| 18 | `primary` em CP diferente | — | ✅ PASS |
| 19 | Múltiplos `thumbnail` na mesma CP | — | ✅ PASS (conforme CPM-D22) |
| 20–23 | Cenários cross-user | RLS | ⚠ não testável com 1 conta (ver nota) |
| FK-A | DELETE Image referenciada | ON DELETE RESTRICT | ✅ REJEITADO (23503) |
| FK-B | DELETE LibraryFile referenciada | ON DELETE RESTRICT | ✅ REJEITADO (23503) |
| FK-C | DELETE ChannelPiece → CPM cascade | ON DELETE CASCADE | ✅ CPM deletada, fonte intacta |
| ALT | alt_text 1001 chars | CHECK | ✅ REJEITADO (23514) |
| ROLE | role inválida | CHECK | ✅ REJEITADO (23514) |

**Nota sobre testes ⚠ (RLS cross-project e cross-user):**
O MCP Supabase estava configurado em modo somente leitura (`read-only`). Os testes de RLS não puderam ser executados com token de usuário autenticado — apenas via inspeção das policies instaladas no banco, confirmadas idênticas ao SQL da migration versionada. Testes obrigatórios em M2 com autenticação real (ver CPM-D12 Rev. 3).

### Idempotência
Verificada analiticamente: `CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS`, `DROP TRIGGER IF EXISTS`, `CREATE INDEX IF NOT EXISTS`. Segunda execução no banco existente não causa erro. Limitação documentada: constraints inline não adicionadas retroativamente.

### Cleanup
6 linhas CPM + 2 library_files + 2 editorial_contents temporários deletados. Fontes reais intactas. `cpm_total = 0`.

---

## M2 — APIs CRUD

**Objetivo:** Rotas `GET/POST /api/channel-piece-media` e `GET/PATCH/DELETE /api/channel-piece-media/[id]`.

**Branch:** `feat/channel-piece-media-m2-api` — HEAD `e459de5` (+ commit de docs)  
**Ambiente:** `nuhdhnasuohizxtmyiju.supabase.co` + dev server local `localhost:3000`

**Decisões:** CPM-D7, CPM-D12, CPM-D20

**Arquivos criados:**
- `app/api/channel-piece-media/_helpers.ts` — `resolveMediaSource`, `UUID_RE`, `VALID_ROLES`, `mapPgError`
- `app/api/channel-piece-media/route.ts` — GET (lista com source resolvida) + POST (validação XOR + cross-project)
- `app/api/channel-piece-media/[id]/route.ts` — GET + PATCH (imutabilidade) + DELETE (somente vínculo)

**Auditoria (33 casos) — executada via Node.js HTTP contra dev server local (2026-06-23):**

| Grupo | Casos | Resultado |
|-------|-------|-----------|
| Sem autenticação → 401 | 1–4 | ✅ 4/4 |
| Criação e leitura válidas | 5–13 | ✅ 9/9 |
| Validação payload POST | 14–22 | ✅ 9/9 |
| Validação payload PATCH | 23–25 | ✅ 3/3 |
| ID inválido / não encontrado | 26–28 | ✅ 3/3 |
| Cross-project (CRÍTICO) | 29–31 | ✅ 3/3 |
| Conflitos de constraints | 32–33 | ✅ 2/2 |
| **TOTAL** | **1–33** | **✅ 33/33** |

**Casos críticos cross-project (29–31) — confirmados via API autenticada:**
- Case 29: CP proj-A + Image proj-B → 400 "Imagem pertence a um Projeto diferente"
- Case 30: CP proj-A + LF proj-B → 400 "LibraryFile pertence a um Projeto diferente"
- Case 31: CP proj-A + Image project_id=NULL → 400 "Imagem sem Projeto atribuido"

**Autenticação de testes:** sessão obtida via Supabase Admin API `generate_link` + magic link redirect →
access_token formatado como cookie `sb-<ref>-auth-token` para `@supabase/ssr` 0.10.x.

**Cleanup:** 2 fixtures criadas e removidas. `channel_piece_media` total = 0 após testes.

**Typecheck + build:** `pnpm tsc --noEmit` sem erros novos; `pnpm build` com sucesso (apenas TS7006 pré-existente).

---

## M3 — Leitura e exibição no Workspace

**Objetivo:** Exibir mídias de uma ChannelPiece na tela de detalhe do EditorialContent.

**Branch:** `feat/channel-piece-media-m3-display` — HEAD `3b2b2af`

**Componente criado:** `components/publication/channel-piece-media-section.tsx`

**Estratégia de carregamento:** paralelo por versão — cada `ChannelPieceMediaSection` faz seu próprio fetch independente quando renderizado. Loading local, erro local com retry, sem bloquear a página. Adequado para o volume atual (≤10 CPs, cada uma com ≤10 mídias).

**UX implementada:**
- Seção compacta "Mídia (N)" abaixo do conteúdo de cada CP card
- Linha por item: thumbnail/ícone 40×40 + role badge + origem (Galeria/Biblioteca) + alt text
- Thumbnail via `thumbnail_url || image_url` com fallback para ícone (ImageIcon/Video/Music/FileText)
- Badge "Mídia indisponível" quando `source_deleted = true`
- Estado vazio: "Nenhuma mídia associada. Upload na próxima etapa."
- Estado de erro: mensagem + botão Tentar novamente
- Botão "Remover da versão" por item (ícone Trash2)
- Confirmação explícita: AlertDialog explica que o arquivo original não será excluído
- Guard de duplo clique: `isDeleteInFlight` ref síncrono
- Toast de sucesso e de erro após remoção

**Role labels (PT-BR):**
- primary → Principal
- thumbnail → Thumbnail
- carousel_item → Item de carrossel
- background → Fundo
- attachment → Anexo

**Fix incluído:** `resolveMediaSource` agora usa `presigned ?? public_url` — `createPresignedReadUrl` retorna `null` (não lança) quando S3 não está configurado; o `.catch()` anterior não capturava esse caso e deixava `image_url = null`. Afetava tanto `image_id` quanto `library_file_id`.

**Auditoria (23 casos) — 2026-06-23:**

| Grupo | Casos | Resultado |
|-------|-------|-----------|
| Carregamento via API | 1–10 | ✅ 10/10 |
| Remoção via API | 11–16 | ✅ 6/6 |
| Regressão — features existentes | 17–22 | ✅ 6/6 |
| **TOTAL** | **1–22** | **✅ 22/22** |

(23 verificações totais — caso 13 executado em dois sub-checks)

**Cleanup:** 4 fixtures criadas e removidas. `channel_piece_media` = 0 após testes.

**Typecheck + build:** sem erros novos (apenas TS7006 pré-existente).

---

## M4 — Picker Galeria e Biblioteca

**Objetivo:** Associar imagem existente (`images` aprovadas ou `library_files`) a uma ChannelPiece.

**Pré-condição:** M3 aprovado.

**Decisões:** CPM-D5, CPM-D6, CPM-D12

**UX:**
- "Selecionar da Galeria" → imagens aprovadas do mesmo Projeto
- "Selecionar da Biblioteca" → library_files do mesmo Projeto, filtráveis por kind
- Múltipla seleção para carrossel

---

## M5 — Upload de nova mídia

**Objetivo:** Upload de arquivo direto no contexto de uma ChannelPiece.

**Pré-condição:** M4 aprovado.

**Decisão:** CPM-D17 (upload → LibraryFile → channel_piece_media)

**Fluxo:**
```
1. Usuário seleciona arquivo
2. POST /api/storage/presign-image-upload {folder: 'library', mimeType, filename, prefix: '/conteudos/'}
3. PUT S3 (cliente direto)
4. POST /api/library-files {storagePath, publicUrl, projectId, name, kind}
   → INSERT library_files com project_id do EC
5. POST /api/channel-piece-media {libraryFileId: <id>, channelPieceId, position, role}
   → INSERT channel_piece_media com library_file_id FK
```

**Pasta padrão:** `/conteudos/` (ou subfolder do projeto). Decisão final de pasta em M5.

---

## M6 — Reordenação e capa

**Objetivo:** Drag-and-drop para reordenar mídias; definir capa (`role = 'primary'`).

**Pré-condição:** M5 aprovado.

**API:** endpoint batch `PATCH /api/channel-piece-media/reorder` recebendo `[{id, position}]`.

**Estratégia de reordenação com `cpm_unique_position DEFERRABLE`:**

A constraint `cpm_unique_position` é `DEFERRABLE INITIALLY IMMEDIATE`. O endpoint de reorder deve:
1. Iniciar transação
2. `SET CONSTRAINTS cpm_unique_position DEFERRED`
3. Executar os UPDATEs de posição em qualquer ordem
4. COMMIT — verificação ocorre no final, sem colisões intermediárias

Não usar abordagem de "offset temporário" (+1000) — mais frágil e sujeita a overflow do `SMALLINT` (máx 32767).

**Compactação de posições:** O endpoint de reorder pode normalizar as posições para sequência contínua (0, 1, 2, ...) ou manter os valores fornecidos pelo cliente. Recomendado: aceitar posições arbitrárias do cliente (drag-and-drop pode usar steps de 10 para reduzir reordenações completas).

---

## M7 — Suporte a vídeo

**Objetivo:** Associar `library_files` com `kind = 'video'` a ChannelPieces de formatos de vídeo.

**Pré-condição:** M6 aprovado.

**Decisão:** CPM-D13 — vídeos via `library_file_id`.

---

## M8 — Migração de Posts

**Objetivo:** Migrar dados `posts` para `editorial_contents + channel_pieces + channel_piece_media`.

**Pré-condição:** M7 aprovado. Schema de migração de `post_images` legados apresentado e aprovado separadamente.

**Decisão:** CPM-D18, CPM-D18a

**Posts excluídos da migração automática:**
- `project_id IS NULL` — relatório de pendências; aguardam escolha humana de Projeto

**Schema de migração legada (a ser apresentado antes de M8):**
Os `post_images` com apenas `image_url` sem FK para `images` ou `library_files` violam `cpm_exactly_one_source`. A solução (ex: criar `library_files` temporários a partir de `storage_path` existente, ou manter tabela de compatibilidade isolada) será modelada separadamente sem enfraquecer M1.

**Script de migração:** `scripts/023_migrate_posts.sql` — idempotente com `migrated_post_id` em `editorial_contents`.

---

## M9 — Posts read-only

**Objetivo:** Desabilitar criação/edição de Posts na UI. API GET preservada.

**Pré-condição:** M8 validado.

---

## M10 — Remoção visual de Posts

**Objetivo:** Remover Posts do menu sidebar. Tabela e API permanecem.

**Pré-condição:** M9 monitorado por período definido.

---

## Sumário

| M | Entregável | Decisões base | Pré-cond |
|---|-----------|--------------|---------|
| M1 | Schema + RLS + tipos | D1–D4, D9–D11, D16, D19, D20 | Aprovação |
| M2 | APIs CRUD | D7, D12, D20 | M1 |
| M3 | Leitura + exibição | D8, D9 | M2 |
| M4 | Picker Galeria + Biblioteca | D5, D6, D12 | M3 |
| M5 | Upload → LibraryFile → CPM | D17 | M4 |
| M6 | Reordenação + capa | D8 | M5 |
| M7 | Vídeo via library_files | D13 | M6 |
| M8 | Migração de Posts | D18, D18a | M7 + schema legado aprovado |
| M9 | Posts read-only | D21 | M8 |
| M10 | Remoção visual Posts | D21 | M9 |

---

## Próxima fase (após M10)

```
Content Studio — Production-first UX
```

Pré-requisitos conforme `HANDOFF_PUBLICATION_PHASE.md`:
1. ✅ ChannelPiece com suporte de mídia (este plano)
2. ✅ Posts aposentados (M10)
3. Reorganização da página do Projeto — Production como unidade central
