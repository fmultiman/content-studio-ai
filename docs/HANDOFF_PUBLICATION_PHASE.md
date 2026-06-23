# Handoff — Fase de Publicações (P1–P6)
**Data:** 2026-06-22  
**Branch final:** `feat/publication-p6-post-video-flow`  
**Release publicado em main em 2026-06-22. Smoke test autenticado concluído. Fluxo funcional.**

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

### Bug pré-existente (não relacionado a publicações)

- `app/(dashboard)/imagens/rascunhos/page.tsx:43` — TS7006: parâmetro `d` sem tipo implícito `any`. Presente desde antes de P1; fora de escopo.

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
