# ChannelPiece Media — Plano de Implementação
**Data:** 2026-06-24 (rev. 9 — M6 implementado, aguardando migration 024 + testes)  
**Status:** M1 ✓. M2 ✓. M3 ✓. M4 ✓. fix/source-uniqueness ✓. M5 ✓. **RELEASE M1–M5 EM PRODUÇÃO.** M6 ⏳ (código pronto, migration pendente).

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

**Objetivo:** Associar imagem existente (`images`) ou arquivo (`library_files`) a uma ChannelPiece via picker integrado no editor.

**Branch:** `feat/channel-piece-media-m4-picker` — criado a partir de `feat/channel-piece-media-m3-display`

**Pré-condição:** M3 aprovado.

**Decisões:** CPM-D5, CPM-D6, CPM-D12

### Arquivos criados/modificados

| Arquivo | Ação |
|---------|------|
| `components/publication/media-picker-dialog.tsx` | Criado — Dialog picker com duas abas |
| `components/publication/channel-piece-media-section.tsx` | Modificado — props `editable`, `projectId`, `showRemove` por item |
| `app/(dashboard)/projetos/[id]/conteudos/[editorialContentId]/page.tsx` | Modificado — seção de mídia dentro do Dialog de edição |

### Arquitetura implementada

**`MediaPickerDialog`** — componente standalone com duas abas:
- **"Imagens geradas"** — consulta `images` por `project_id` via Supabase client (mesmo padrão da página Galeria). Dados carregados lazily, cacheados durante a sessão do picker.
- **"Arquivos do projeto"** — consulta `GET /api/library-files?projectId=X` (endpoint existente, soft-delete respeitado).
- Seleção de um item executa `POST /api/channel-piece-media` com role/position auto-computados.
- Guarda double-submit: `isAssigningRef` (useRef síncrono).
- Itens já associados: badge "Adicionada"/"Adicionado" + disabled.

**`ChannelPieceMediaSection`** — props adicionadas:
- `editable?: boolean` (default `false`) — controla visibilidade do botão "Adicionar mídia" e do ícone de lixeira em cada item.
- `projectId?: string` — repassado ao `MediaPickerDialog`.
- Modo **card externo** (`editable=false`): somente leitura, sem lixeira — resumo informativo.
- Modo **editor** (`editable=true`): lista com lixeira, botão "Adicionar mídia", picker embutido.

**Integração no Dialog** — dentro de "Editar versão para canal", após o campo Hashtags:
```tsx
{editingCp && (
  <ChannelPieceMediaSection
    channelPieceId={editingCp.id}
    editable
    projectId={projectId}
  />
)}
```

### Lógica de role e position

| Situação | Role atribuído |
|----------|---------------|
| Nenhuma mídia com `role=primary` | `primary` |
| Já existe `role=primary` | `carousel_item` |

`position = max(current positions) + 1`, ou `0` se lista vazia.

### Labels de origem (UX)

| Fonte técnica | Label exibido |
|---------------|---------------|
| `image_id IS NOT NULL` | Imagem gerada |
| `library_file_id IS NOT NULL` | Arquivo do projeto |

Aba "Imagens geradas" no picker → `images`  
Aba "Arquivos do projeto" no picker → `library_files`

### Prevenção de duplicatas

- **Frontend:** `isDuplicateImage(imageId)` / `isDuplicateFile(fileId)` — item desabilitado com badge.
- **Backend:** não existe constraint `UNIQUE(channel_piece_id, image_id)` — API permite múltiplas associações do mesmo source (decisão intencional, frontend controla). Constraint `uq_cpm_cp_primary` bloqueia segundo `role=primary`.

### Auditoria (35 casos) — 2026-06-23

| Grupo | Casos | Resultado |
|-------|-------|-----------|
| Autenticação → 401 | 1–3 | ✅ 3/3 |
| Dados Galeria/Biblioteca | 4–6 | ✅ 3/3 |
| Role e position (imagem) | 7–13 | ✅ 7/7 |
| Position explícita e ordenação | 14–16 | ✅ 3/3 |
| Duplicata source (API vs frontend) | 17–18 | ✅ 2/2 |
| Cross-project | 19–21 | ✅ 3/3 |
| Validação de input | 22–25 | ✅ 4/4 |
| Library file (source Biblioteca) | 26–29 | ✅ 4/4 |
| DELETE e integridade pós-delete | 30–32 | ✅ 3/3 |
| PATCH e campos imutáveis | 33–35 | ✅ 3/3 |
| **TOTAL** | **1–35** | **✅ 35/35** |

**Fixture M4:** 1 `library_file` de teste criada em PROJECT_A para casos 26–29; removida no cleanup.

### Smoke visual — 2026-06-23 — APROVADO

Validado com 2 fixtures: 1 imagem (Principal/Imagem gerada) + 1 arquivo (carousel_item/Arquivo do projeto) em CP_A1.

Checklist confirmado:

**Card externo:**
- [x] 2 mídias exibidas
- [x] Labels "Principal · Imagem gerada" e "Item de carrossel · Arquivo do projeto"
- [x] Sem lixeira (modo somente leitura)
- [x] Layout compacto mantido

**Editor ("Editar versão para canal"):**
- [x] Seção "Mídia da versão" após Hashtags
- [x] 2 mídias com ícone de lixeira e confirmação de remoção
- [x] Botão "Adicionar mídia" funcional
- [x] Footer sticky mantido; scroll do Dialog não quebrado
- [x] Conteúdo textual preservado ao abrir/fechar picker

**Picker ("Adicionar mídia"):**
- [x] Título "Adicionar mídia"
- [x] Descrição "Escolha uma imagem gerada ou um arquivo existente deste projeto."
- [x] Aba "Imagens geradas" carrega imagens do projeto
- [x] Aba "Arquivos do projeto" carrega arquivo de teste
- [x] Itens já associados desabilitados com badge
- [x] Seleção funciona; double-submit bloqueado

### Cleanup — 2026-06-23

- 3 CPMs de smoke removidos de CP_A1 e CP_A2
- `library_file` de teste `13813102` removido
- IMG_A, PROJECT_A, CP_A1, CP_A2 e library_files do projeto B verificados — intactos
- `channel_piece_media` = 0 em CP_A1 e CP_A2 após cleanup

### Limitações M4

- **Sem constraint DB para source único:** o mesmo `image_id` pode ser associado ao mesmo CP múltiplas vezes via API direta. Frontend bloqueia via `isDuplicateImage`. Constraint de banco requer migration dedicada (não autorizada ainda).
- **Sem presigned URLs no picker:** imagens aparecem como placeholder em dev local (S3 não configurado). Comportamento idêntico ao M3 — correto para ambiente sem S3.
- **Sem reordenação:** posição é auto-incrementada; reordenação é M6.
- **Sem upload direto:** upload de novos arquivos é M5.

### Typecheck + build

`pnpm tsc --noEmit` — apenas TS7006 pré-existente (`rascunhos/page.tsx`).  
`pnpm build` — sucesso.

---

## fix/source-uniqueness — Unicidade de fonte por ChannelPiece

**Branch:** `fix/channel-piece-media-source-uniqueness`  
**Base:** `feat/channel-piece-media-m4-picker` HEAD (`4ce3241`)  
**Data:** 2026-06-23  
**Objetivo:** Garantir que cada `image_id` ou `library_file_id` apareça no máximo uma vez por `channel_piece_id`, tanto a nível de DB quanto de API.

### Motivação

O M4 introduziu prevenção de duplicatas apenas no frontend (advisory check antes do POST). Um race condition entre dois requests concorrentes poderia inserir duas linhas com o mesmo source na mesma CP. A solução definitiva exige constraints a nível de DB.

### Arquivos modificados

| Arquivo | Mudança |
|---------|---------|
| `scripts/023_enforce_channel_piece_media_source_uniqueness.sql` | Novo — dois índices únicos parciais |
| `app/api/channel-piece-media/_helpers.ts` | `mapPgError` — mapeia 23505 de novos índices para 409 amigável |

### Migration 023 — índices únicos parciais

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_cpm_cp_image
  ON channel_piece_media (channel_piece_id, image_id)
  WHERE image_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cpm_cp_library_file
  ON channel_piece_media (channel_piece_id, library_file_id)
  WHERE library_file_id IS NOT NULL;
```

Idempotente. Não altera linhas existentes, constraints ou RLS. Aplicada em produção `nuhdhnasuohizxtmyiju` em 2026-06-23.

### Mapeamento de erro API

`mapPgError` em `_helpers.ts` trata 23505 dos dois novos índices **antes** do fallback genérico:

```typescript
if (message.includes('uq_cpm_cp_image') || message.includes('uq_cpm_cp_library_file')) {
  return { status: 409, error: 'Esta midia ja esta associada a esta versao.' }
}
```

Nome do índice não é exposto ao cliente.

### Auditoria pré-migration

Zero duplicatas encontradas antes da migration:

```sql
-- image_id
SELECT channel_piece_id, image_id, COUNT(*) FROM channel_piece_media
WHERE image_id IS NOT NULL GROUP BY 1, 2 HAVING COUNT(*) > 1;
-- 0 rows

-- library_file_id
SELECT channel_piece_id, library_file_id, COUNT(*) FROM channel_piece_media
WHERE library_file_id IS NOT NULL GROUP BY 1, 2 HAVING COUNT(*) > 1;
-- 0 rows
```

### Matriz de testes — 13 casos (16 assertions) — 2026-06-23 — todos passaram

| # | Caso | Resultado |
|---|------|-----------|
| 1 | Primeira associação de Image à CP → 201 | ✅ PASS |
| 2 | Mesma Image na mesma CP → 409, mensagem amigável | ✅ PASS (3 assertions) |
| 3 | Mesma Image em CP diferente → 201 | ✅ PASS |
| 4 | Dois requests concorrentes: Image + CP → exatamente 1×201 e 1×409 | ✅ PASS |
| 5 | Primeira associação de LibraryFile à CP → 201 | ✅ PASS |
| 6 | Mesmo LibraryFile na mesma CP → 409, mensagem amigável | ✅ PASS (2 assertions) |
| 7 | Mesmo LibraryFile em CP diferente → 201 | ✅ PASS |
| 8 | Dois requests concorrentes: LibraryFile + CP → exatamente 1×201 e 1×409 | ✅ PASS |
| 9 | Image + LibraryFile (fontes distintas) na mesma CP → ambos 201 | ✅ PASS |
| 10 | Posição diferente não contorna unicidade de Image → 409 | ✅ PASS |
| 11 | Role diferente não contorna unicidade de LibraryFile → 409 | ✅ PASS |
| 12 | DELETE + re-associação da mesma Image → 201 | ✅ PASS |
| 13 | IMG_A intacto após todos os testes | ✅ PASS |

### TypeScript + Build

`pnpm exec tsc --noEmit` — erro pré-existente em `app/(dashboard)/imagens/rascunhos/page.tsx:43` (não relacionado a este fix, arquivo não modificado).  
`pnpm build` — sucesso.

---

## M5 — Upload de nova mídia

**Objetivo:** Upload de arquivo direto no contexto de uma ChannelPiece.

**Pré-condição:** M4 aprovado.

**Decisões:** CPM-D17, CPM-D24.

**Entregável:** `POST /api/channel-piece-media/upload` (multipart/form-data). Fluxo server-side:
```
1. Auth + validação (file, mimeType, channelPieceId)
2. Verify CP ownership → derivar projectId via CP → EC chain
3. Upload buffer → S3 (uploadLibraryFile)     [Caso A: falha aqui → sem resíduo]
4. INSERT library_files                        [Caso B: falha → delete S3]
5. INSERT channel_piece_media                  [Caso C: falha → delete LF + S3]
6. Return 201 { channelPieceMedium, libraryFile }
```

**Formatos:** JPEG, PNG, WebP, GIF, MP4, WebM, MOV. Limite: 50 MB.
**Pasta da LF:** `/` (raiz). Usuário pode reorganizar via Arquivos.
**UI:** Terceira aba "Enviar arquivo" no `MediaPickerDialog`; drag-and-drop; anyBusy bloqueia fechar.

**Auditoria M5 — 2026-06-23**

| # | Caso | Resultado |
|---|------|-----------|
| 44/44 | Suite `cpm_m5_tests.mjs` (Groups 1–7) | ✅ PASSOU |

Branch: `feat/channel-piece-media-m5-upload`. Status: **INTEGRADO EM MAIN E DEPLOYADO.**

---

## Release M1–M5 — 2026-06-24

**Merge commit:** `f446cd0` — `feat: integrate ChannelPiece media lifecycle M1-M5`  
**Tag de rollback:** `pre-channel-piece-media-release-2026-06-24` → `c799d10`  
**Branch integrado:** `feat/channel-piece-media-m5-upload` → `main`  
**Deploy:** `content.multihuman.com.br` — status Ready  
**Migrations em produção:** 022 (aplicada 2026-06-23) + 023 (aplicada 2026-06-23)

### Auditoria consolidada pré-merge

| Verificação | Resultado |
|-------------|-----------|
| Schema: tabela, RLS, 4 policies, constraints, índices, trigger | ✅ Confirmado no banco |
| APIs: auth, autorização, cross-project, 409, compensação | ✅ Auditado |
| Storage: uploadLibraryFile, sanitização, compensação Casos A–D | ✅ Auditado |
| Frontend: card read-only, editor editable, picker 3 abas, anyBusy | ✅ Auditado |
| TypeScript: `pnpm tsc --noEmit` | ✅ exit 0 |
| Build: `pnpm build` | ✅ exit 0 |
| Lint: `pnpm lint` | ⚠ ESLint não instalado como dep (pré-existente) |
| Suite M5: `cpm_m5_tests.mjs` | ✅ 44/44 |
| Banco: zero CPMs/LFs de teste, dados preservados | ✅ Confirmado |

### Smoke de release em produção — 2026-06-24

Fixture: `[SMOKE RELEASE CPM M1-M5].jpg` — ChannelPiece `65f49c21` (instagram/reel)

| Verificação | Resultado |
|-------------|-----------|
| Página login 200 (público) | ✅ |
| API sem auth → 401 | ✅ |
| Upload sem auth → 401 | ✅ |
| Sessão via magiclink | ✅ |
| Projeto "Content Agent" preservado | ✅ |
| Production "Teste publicação 01" preservada | ✅ |
| Imagem conceitual `3a49939e` preservada | ✅ |
| GET /api/channel-piece-media → 200 | ✅ |
| Upload → 201 + CPM criado + LF criado | ✅ |
| CPM role = primary / position = 0 | ✅ |
| LF storage_path presente | ✅ |
| LF project_id correto | ✅ |
| CPM aparece no GET com media_kind | ✅ |
| DELETE CPM → 200 | ✅ |
| CPM removido do GET | ✅ |
| library_file preservado após remoção CPM | ✅ |
| LF deletado + S3 object deletado | ✅ |
| Zero resíduos de smoke | ✅ |

### Riscos remanescentes

- **ESLint não instalado:** `pnpm lint` falha por `eslint` ausente nas deps (pré-existente; não introduzido pelo M1–M5).
- **`typescript.ignoreBuildErrors: true` no `next.config.mjs`:** build do Vercel não falha em erros TS. Mitigado: tsc local passou em exit 0.
- **Teste cross-user:** isolamento RLS validado por inspeção de policies e tripla camada (RLS + API + check explícito), não por execução com 2 contas reais. Risco baixo.

---

## M6 — Organização das mídias da Versão para canal

**Objetivo:** Reordenar mídias (botões up/down), alterar role (dropdown), definir primary ("Definir como principal"), e DELETE atômico com compactação de posições.

**Pré-condição:** M5 aprovado.

**Branch:** `feat/channel-piece-media-m6-organization`  
**Status:** Código implementado e commitado (`ce984e4`, `31a0e3b`). Aguardando migration 024 aplicada manualmente + suite de testes.

**Decisões:** CPM-D25, CPM-D26, CPM-D27

### Arquitetura

RPC-based atomicity: duas funções PL/pgSQL em `scripts/024_channel_piece_media_organization.sql`:

- **`organize_channel_piece_media(p_channel_piece_id UUID, p_items JSONB) RETURNS JSONB`**
  - Valida auth.uid(), estrutura dos itens, ownership da CP
  - `FOR UPDATE NOWAIT` em todas as linhas → `55P03` → 409
  - Detecção de stale payload (ID set mismatch) → CPM_CONFLICT → 409
  - Dois fases de primary: demote (WHERE role='primary' AND id NOT IN new_primary), depois promote
  - `SET CONSTRAINTS cpm_unique_position DEFERRED` + loop UPDATE
  - Retorna JSONB array ordenado por position

- **`remove_channel_piece_media(p_id UUID) RETURNS JSONB`**
  - Valida auth.uid(), `FOR UPDATE NOWAIT`
  - DELETE + se era primary e há remanescentes → promove o de menor position
  - `SET CONSTRAINTS cpm_unique_position DEFERRED` + CTE compactação (`ROW_NUMBER() - 1`)
  - Retorna JSONB array remanescente ordenado

Ambas: `LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, auth`  
`REVOKE ALL ON FUNCTION ... FROM PUBLIC; GRANT EXECUTE TO authenticated`

### Arquivos modificados

| Arquivo | Mudança |
|---------|---------|
| `scripts/024_channel_piece_media_organization.sql` | Novo — RPCs + grants |
| `app/api/channel-piece-media/_helpers.ts` | `mapRpcError` adicionado |
| `app/api/channel-piece-media/organize/route.ts` | Novo — `PATCH /api/channel-piece-media/organize` |
| `app/api/channel-piece-media/[id]/route.ts` | DELETE reescrito para usar RPC |
| `components/publication/channel-piece-media-section.tsx` | UI de organização: up/down, role dropdown, primary |

### API

**`PATCH /api/channel-piece-media/organize`**
```
Body: { channelPieceId: string, items: [{ id, position, role }] }
200: { channelPieceMedia: ChannelPieceMediaResolved[] }
400: campos inválidos / duplicatas / zero primaries / role inválida
401: sem sessão
404: CP não encontrada
409: stale payload ou lock conflict
```
Chaves extras no body ou nos items → 400 (projeção segura).

**`DELETE /api/channel-piece-media/[id]`** (atualizado)
```
200: { ok: true, channelPieceMedia: ChannelPieceMediaResolved[] }
401: sem sessão
404: CPM não encontrado
409: lock conflict
```
Retorna lista remanescente atualizada (positions compactadas, primary promovido se necessário).

### Frontend

`channel-piece-media-section.tsx` (modo `editable=true`):

- `MediaItemEditable`: chevron Up/Down (disabled em boundary ou anyBusy), spinner quando `isOrganizing`, DropdownMenu de role (Definir como principal / thumbnail / carousel_item / background / attachment), botão Trash2 com confirmação
- `callOrganize(newArrangement, triggerItemId)` — PATCH /organize com lista completa renumerada, atualiza items do response
- `handleMoveUp/Down` — troca adjacente + renumera posições
- `handleRoleChange` — se newRole=primary, demove current primary para carousel_item
- `anyBusy = isOrganizeInFlight.current || !!deletingId`
- `handleConfirmDelete` usa `channelPieceMedia` do response DELETE (fallback: filter local)

Sem biblioteca DnD pesada. Botões Up/Down para reordenação.

### Auditoria (54 casos) — pendente execução

| Grupo | Casos | Status |
|-------|-------|--------|
| Reorder (1–11) | 11 | ⏳ Aguardando migration 024 |
| Primary (12–18) | 7 | ⏳ Aguardando migration 024 |
| Roles (19–25) | 7 | ⏳ Aguardando migration 024 |
| DELETE (26–31) | 6 | ⏳ Aguardando migration 024 |
| Concorrência (32–38) | 7 | ⏳ Aguardando migration 024 |
| Segurança (39–44) | 6 | ⏳ Aguardando migration 024 |
| Regressão (45–54) | 10 | ⏳ Aguardando migration 024 |
| **TOTAL** | **54** | ⏳ |

Suite: `scripts/cpm_m6_tests.mjs` — requer `pnpm dev` + migration 024 aplicada.

### Typecheck + build

`pnpm typecheck` — ✅ exit 0 (tsconfig.typecheck.json exclui .next)  
`pnpm build` — validar após migration aplicada

### Pendências

1. Aplicar `scripts/024_channel_piece_media_organization.sql` via Supabase SQL Editor (MCP em read-only mode)
2. Executar `node scripts/cpm_m6_tests.mjs` — smoke visual após 54/54
3. Cleanup de fixtures
4. Atualizar HANDOFF com M6
5. Push + aguardar aprovação humana para merge

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
