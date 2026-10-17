# Onda 1A-2, Passo S1 — Modelo de leitura da Galeria multimodal

Base: `main` = `ed01cc310a6b4aa84cf48e33316b95a327a77055` (Onda 1A-1 fechada, PR #206).
Escopo deste passo: **somente o modelo de leitura no servidor e `GET /api/gallery/outputs`.** A página `/galeria`, Arquivos, os Creative Editors, a geração/renderização, Review, autosave e modelos **não mudam**. Não há migração, tabela nova de Output, escrita no banco, LibraryFile automático nem URL assinada na resposta.

Decisões aprovadas aplicadas aqui: D1 (filtro por tipo no servidor), D2 (disponibilidade verificada de forma preguiçosa; nenhum prazo de retenção inventado), D3 (cronologia estável, nunca `updated_at`), D4 (vídeos IA avulsos permanecem, sem Session inventada), D6 (sem Production = “sem Production”, sem heurística). D5 (busca limitada aos itens carregados) pertence ao S2.

## Matriz de fontes

| Tipo (`type`) | Identidade canônica | Entra quando | Instante de ordenação (`occurredAt`) | Project | Production | Origem (`provenance`) |
|---|---|---|---|---|---|---|
| `image` | `images.id` | tem algum ativo (`image_url`/`thumbnail_url`/`storage_path`/`thumbnail_path`) | `images.created_at` | `images.project_id` | Attempts (`image_generation_attempts.result_image_id`); só se nenhum Attempt nomeia a imagem, o rascunho legado (`image_drafts.current_image_id`) | `image_session` (Session única + Attempt mais recente), `image_attempt`, `legacy_image_draft` ou `null` (origem desconhecida, imagem preservada) |
| `video_generation` | `video_generations.id` | `status='succeeded'` com objeto armazenado | `created_at` | `project_id` da linha | `production_id` da linha (verificado) | `video_session` se a linha tem `session_id`; senão `video_standalone` |
| `video_render` | `render_executions.id` (`kind='video'`) | `status='completed'` | `completed_at` | `render_executions.project_id` | `video_drafts.production_id` (se o draft ainda está no mesmo Project) | `video_draft` |
| `static_render` | `render_executions.id` (`kind='static_still'`) | `status='completed'` | `completed_at` | `render_executions.project_id` | `channel_pieces → editorial_contents.production_id` (se o conteúdo está no mesmo Project) | `channel_piece` |

Um LibraryFile salvo **não é uma saída**: aparece apenas em `savedLibraryFileIds` (arquivos vivos que referenciam a saída por `source_render_execution_id`, `source_image_id` ou `video_generations.library_file_id`). Vários arquivos de uma mesma execução viram **uma** saída.

## Regras de proveniência (nada é inventado)

`resolveProductionClaims` aceita apenas declarações persistidas e verificadas: a Production precisa existir para o usuário **e** pertencer ao mesmo Project da saída.

| Situação | `productionState` | Production |
|---|---|---|
| uma declaração verificada (mesmo repetida por vários Attempts) | `resolved` | essa |
| nenhuma declaração, ou nenhuma verificável (outro Project, outro usuário, inexistente, saída sem Project) | `unscoped` | `null` |
| declarações verificadas diferentes entre si, ou draft/conteúdo atual em outro Project que a execução | `conflict` | `null` |

Nome, “única Production”, pasta, prompt e data nunca são entradas. Attempts de Sessions diferentes não provam Session única (`provenance: null`). Vídeos IA avulsos nunca recebem link de Session (`sourceHref: null`).

## Contrato da API

`GET /api/gallery/outputs?type=…&projectId=…&limit=…&cursor=…&totals=1`

- **Autenticação/ownership:** 401 sem sessão; toda consulta filtra por `user_id`; o `service role` é usado só para `render_executions` (sem política de SELECT no browser) e sempre filtrado pelo usuário. `projectId` de outro usuário → 404.
- **Filtro por tipo no servidor:** `type` repetido ou separado por vírgula (`image`, `video_generation`, `video_render`, `static_render`); padrão = os quatro. Fontes não selecionadas ficam `skipped`, não são consultadas e não contam como vazias. Tipo inválido → 400.
- **Projeção segura:** colunas explícitas, sem `*`. Nunca são selecionados `image_url`, caminhos de storage, bucket, `claimed_by`, lease, `input_snapshot` (apenas `slide`), `error_detail`, URL de provedor ou URL assinada. O acesso à mídia continua nos endpoints por item, indicados em `access` como **caminhos**: `/api/images/[id]/signed-url`, `/api/video-generations/[id]/playback-url`, `/api/render-executions/[id]/output-url` (com `?disposition=attachment` para download).
- **Paginação por cursor:** `limit` 1–100 (padrão 48). Cada fonte busca `limit + 1` linhas depois da sua própria posição `(instante, id)` e o servidor faz o merge global por `occurredAt` desc e, em empate, `key` desc. Cursor opaco e versionado, preso aos filtros (`type`/`projectId`). **O cursor não é assinado nem autenticado**: é JSON em Base64URL que o cliente guarda como uma *posição* e que qualquer pessoa consegue ler e editar; este passo não adiciona segredo nem criptografia. A segurança não vem de detectar adulteração, e sim de: (1) validação estrita antes de qualquer consulta — tamanho máximo de 2048 caracteres verificado antes de decodificar/parsear, versão, filtros iguais, instante canônico (microssegundos UTC) e UUID; só valores que casam com essas gramáticas fechadas entram em um filtro, então o cursor não carrega sintaxe de consulta; (2) todas as consultas continuam filtradas pelo `user_id` autenticado — um cursor editado e bem formado só escolhe *outra posição dentro das saídas do próprio usuário* (pode pular ou repetir trechos da própria lista), nunca dados de outra pessoa. Entrada malformada, grande demais, de versão diferente, de outro filtro ou com instante não canônico é recusada com 400. Instantes são normalizados para microssegundos UTC (um `Date` do JS empataria linhas que o banco ordena).
- **Consultas auxiliares completas:** as consultas de dados relacionados (Attempts, rascunhos legados, LibraryFiles salvos, VideoDrafts, ChannelPieces, EditorialContents, Productions e Projects) pedem também a contagem exata do **mesmo filtro** e só prosseguem se receberam **todas** as linhas (`linhas recebidas == contagem`). O PostgREST corta respostas silenciosamente no seu limite máximo de linhas; uma consulta cortada, ilegível ou sem contagem faz a fonte afetada falhar (`ATTEMPTS_UNAVAILABLE`, `DRAFTS_UNAVAILABLE`, `SAVED_FILES_UNAVAILABLE`, `CONTEXT_UNAVAILABLE`, `PIECES_UNAVAILABLE`, `CONTENTS_UNAVAILABLE`) em vez de mostrar metadados de arquivos salvos incompletos ou proveniência de imagem imprecisa. `AUX_LOOKUP_LIMIT = 1000` é um teto explícito adicional. As quatro consultas principais já são limitadas a `limit + 1` (≤ 101) e dependem apenas de o limite de linhas do servidor ser maior que 101.
- **Falha por fonte:** `sources.<tipo>` = `{state:'ok',hasMore}` | `{state:'failed',code}` | `{state:'skipped'}`. Cada fonte é atômica: se qualquer consulta dela (inclusive proveniência/Project/Production) falha, a fonte inteira é `failed` — nunca saídas com contexto “inventado como sem Production”. As outras fontes mantêm seus resultados (`partial: true`). Códigos estáveis, sem detalhe do banco. HTTP 503 só se **todas** as fontes selecionadas falharem; sem service role, só as duas fontes de render falham.
- **Cursor e fonte com falha:** o cursor avança, por fonte, apenas até o último item dessa fonte que entrou na página. Fonte que falhou, que não contribuiu ou foi ignorada mantém a posição anterior, e `nextCursor` permanece aberto enquanto existir fonte com falha. Quando a fonte voltar, suas saídas aparecem em páginas seguintes (**podem surgir fora da ordem global**; uma nova carga sem cursor restaura a ordem estrita). `nextCursor: null` só quando todas as fontes estão esgotadas. `items: []` com `nextCursor` presente e `partial: true` significa “só restam fontes com falha”.
- **Totais:** só com `totals=1`. `bySource` traz contagens exatas (`head` + `count: exact`) ou `null`; `global` só existe (`globalExact: true`) quando todas as fontes selecionadas listaram e contaram com sucesso. Caso contrário `global: null`.
- **Resposta:** `{ items, nextCursor, hasMore, partial, limit, sources, totals? }`, `Cache-Control: no-store`.

## Disponibilidade e retenção (D2)

Nada neste passo verifica a existência do arquivo: `availability` é sempre `unverified` e a existência é provada de forma preguiçosa no acesso (S3). Nenhum prazo de retenção foi inventado.

Auditoria operacional somente leitura em 17/10/2026 (apenas `HeadObject` e `GetBucketLifecycleConfiguration`; nenhuma escrita, download, cópia ou exclusão; sem alteração de política):

| Resultado | Quantidade |
|---|---|
| Render concluídos auditados | 83 (25 vídeo, 58 estático) |
| Objeto encontrado | **83** |
| Objeto ausente (404) | 0 |
| Erro de acesso/rede (reportado à parte) | 0 |
| Tamanho divergente do registrado | 0 |
| Controle (chave inexistente) | 404 `NotFound` — com esta credencial “ausente” é distinguível de “sem permissão” |
| Configuração de lifecycle do bucket | nenhuma configurada (`NoSuchLifecycleConfiguration`) |

Leitura: hoje nenhum scratch foi apagado nem expira por regra do bucket; o render mais antigo tem ~25 dias, então isso **não** prova que não haverá expiração futura por outro mecanismo. A decisão de retenção continua do proprietário; a Galeria deve tratar “registro concluído” e “arquivo acessível” como coisas diferentes.

## Limitações conhecidas deste passo

- A página `/galeria` ainda usa as buscas antigas (S2). Este endpoint ainda não tem consumidor.
- ~~Filtro por Production não estava no servidor~~ — entregue no S2 (`docs/productization/structural-wave-1a2-s2-gallery-cutover-v1.md`). A busca por texto segue limitada aos itens carregados (D5).
- Saídas “fora de ordem” podem surgir quando uma fonte se recupera no meio da paginação (documentado acima).
- Imagens: 8 linhas de `images` não têm Attempt nem rascunho; são preservadas como `unscoped`, `provenance: null` (podem incluir imagens não geradas por IA escritas por caminhos legados do navegador — pergunta U1 em aberto).
- Um LibraryFile `origin='studio_render'` sem `source_render_execution_id` (0 linhas hoje) não aparece mais, pois a Galeria nova só lista as quatro fontes. Execuções apagadas (FK `ON DELETE SET NULL`) deixariam o arquivo salvo apenas em Arquivos.
- `images.image_url` vazio (`''`) passa pelo filtro “tem ativo”; o acesso falha de forma graciosa no endpoint por item.
- Sem índices novos: no volume atual (31 imagens, 16 vídeos IA, 83 renders) não é necessário; registrar para escala futura (`images(user_id, created_at, id)`, `render_executions(user_id, kind, status, completed_at)`).

## Validação

Testes em `lib/__tests__/gallery-outputs-rules.test.ts`, `gallery-outputs-data.test.ts` e `gallery-outputs-route.test.ts` (fake de banco que interpreta as consultas PostgREST reais, incluindo os filtros `or(...)` do cursor e a lista de colunas selecionadas). Os resultados da execução (testes direcionados, typecheck, lint, build) ficam registrados na PR.
