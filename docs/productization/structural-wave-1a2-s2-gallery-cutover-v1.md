# Onda 1A-2, Passo S2 — Filtro de Production no servidor e corte da Galeria

Base: `main` = `59094a066a8ad959fb21ebcbc6cf0756169d1a50` (Onda 1A-1 e Onda 1A-2/S1 fechadas, PRs #206 e #207).
Escopo: **S2A** (filtro de Production em `GET /api/gallery/outputs`) e **S2B** (a página `/galeria` passa a ler somente desse endpoint). Sem migração, sem tabela de Output, sem escrita no banco, sem salvamento em Arquivos, sem mudança em Creative Editors, Review, autosave, modelos ou provedores. A verificação de existência dos objetos (HeadObject) é o **S3** e não faz parte desta PR.

## S2A — Filtro de Production (contrato)

`GET /api/gallery/outputs?productionId=<uuid>` (além de `type`, `projectId`, `limit`, `cursor`, `totals`).

- **Validação:** `productionId` precisa ser UUID (400 `INVALID_PRODUCTION`) e uma Production do próprio usuário (404 `PRODUCTION_NOT_FOUND` — também para a de outro usuário, sem revelá-la; 503 `PRODUCTION_UNAVAILABLE` se a leitura falhar). O Project da Production é o Project efetivo de todas as famílias; um `projectId` enviado junto que discorde dela é recusado (400 `PROJECT_PRODUCTION_MISMATCH`), nunca resolvido silenciosamente.
- **Membro = verificado.** O filtro replica exatamente a regra que a listagem usa para `productionState: 'resolved'` em cada família. Assim a lista filtrada é o mesmo conjunto dos itens “resolved nessa Production” da lista sem filtro; saídas `unscoped` e `conflict` nunca aparecem dentro de uma Production.
- **Antes da paginação e da contagem:** o filtro é aplicado dentro da consulta de cada fonte (antes de `limit + 1`, antes do cursor e dos `head` counts). Nada é filtrado em memória depois da página.
- **Estratégia por família (cada uma tem uma origem diferente de Production):**

| Família | Como a Production é obtida | Filtro aplicado na consulta principal |
|---|---|---|
| `video_generation` | colunas da própria linha (`production_id` + `project_id`) | `eq production_id` e `eq project_id` |
| `video_render` | `video_drafts.production_id` (draft do mesmo Project) | `video_draft_id IN (ids dos VideoDrafts da Production no Project)` + `eq project_id` da execução |
| `static_render` | `channel_pieces → editorial_contents.production_id` (conteúdo do mesmo Project) | `channel_piece_id IN (ids das ChannelPieces dos conteúdos da Production)` + `eq project_id` da execução |
| `image` | Attempts (`result_image_id`) e, só se nenhum Attempt nomeia a imagem, rascunho legado (`current_image_id`) | `id IN (imagens-membro)`; membro = candidato (Attempt/rascunho que nomeia a Production) **verificado com a mesma resolução de claims da listagem** (conflitos, outro Project e outro dono ficam de fora) |

- **Limites e falha honesta:** os conjuntos de ids são lidos até o fim sob um teto explícito (`FILTER_ID_LIMIT = 200`, seguro para URL). Acima disso → a família falha com `PRODUCTION_FILTER_TOO_LARGE`; resposta cortada pelo servidor ou ilegível → `PRODUCTION_FILTER_UNAVAILABLE`. O filtro nunca é aplicado a parte de uma Production, uma falha nunca vira “Production vazia”, e as outras famílias continuam respondendo (`partial: true`, cursor aberto para a família com falha).
- **Eficiência:** a pertinência de cada família é calculada uma vez por requisição (memo) e reaproveitada pela lista e pela contagem; consultas de pertinência filtram por `user_id` e são limitadas pelo teto.
- **Cursor:** o fingerprint do cursor inclui Production (e Project efetivo): um cursor não vale sem filtro, sob outra Production, nem com outro tipo/Project.
- **Totais:** exatos para o filtro quando informados (`bySource` + `global` só com todas as fontes selecionadas listadas e contadas).

Não há filtro “Sem Production”: exigiria consultas complementares (NOT EXISTS) para imagens e uma terceira categoria (`conflict`); fica fora do S2.

## S2B — Página `/galeria`

- **Fonte única:** `hooks/use-gallery-outputs.ts` consome somente `GET /api/gallery/outputs`. Saíram da página as leituras de `images`, `image_drafts`, `video_drafts`, `productions`/`projects` como dados de saída, `GET /api/gallery/video-outputs` e `GET /api/library-files?origin=studio_render`. Projects e Productions continuam sendo lidos apenas como **opções** dos filtros (limite explícito de 500, com aviso se o limite for atingido).
- **Quatro tipos:** chips “Imagem IA”, “Vídeo IA”, “Render de vídeo” e “Render estático” em cada card/linha e no preview; chips de filtro por tipo (multisseleção; todos = nenhum) enviados ao servidor.
- **Filtros no servidor:** tipo, Project e Production. Qualquer mudança reinicia a lista (cursor e totais voltam ao início) e **aborta** a requisição anterior; uma resposta tardia de filtros antigos não sobrescreve a nova (geração por requisição + `AbortController`). Um “Carregar mais” em andamento quando os filtros mudam é descartado.
- **“Carregar mais”:** usa o cursor real devolvido pela API; clique duplo não envia segunda requisição; falha mantém tudo que já está carregado e permite repetir com o mesmo cursor; as páginas são mescladas pela chave tipada (`<tipo>:<id>`), sem card duplicado, e mantidas na ordem cronológica canônica (uma fonte que se recupera encaixa suas saídas no lugar certo).
- **Falhas por fonte:** banner “Lista incompleta” nomeia as fontes com falha e mantém os outputs carregados; “Tentar novamente” continua com o cursor (a API o mantém aberto para a fonte com falha). Falha total (503 com envelope) ou de rede → “Falha ao carregar a Galeria” com repetição, nunca “Galeria vazia”.
- **Totais e vazios honestos:** o total de `Outputs` e os números por tipo só aparecem quando a API os reporta como exatos (`globalExact`); caso contrário “—” e “Total exato indisponível”. “Nenhum output concluído ainda” só quando todas as fontes responderam, nada falhou e não há próxima página; vazio com falha/mais páginas = “lista incompleta”; filtro de servidor sem resultado (coleção completa) = “Nenhum output encontrado”.
- **Busca e status locais:** rotulados “Buscar nos itens carregados” e “Status (itens carregados)”, com texto explicando o escopo; não geram requisição e não produzem totais. Se ocultam tudo o que foi carregado e há mais páginas, a tela diz isso (“Nenhum output carregado corresponde…”) em vez de “vazio”.
- **Production honesta:** `Sem Production associada` (sem declaração verificável) ou `Production indefinida (registros conflitantes)`; sem botão “Ver Production” nesses casos.
- **LibraryFile:** vira apenas a marca “Salvo em Arquivos” (com contagem se houver vários) no output de origem; nunca um segundo card; a Galeria não oferece salvar.
- **Navegação de origem:** Session de imagem, Session de vídeo, Creative Editor (VideoDraft), editor visual da ChannelPiece e Production; vídeos IA avulsos mostram “Geração avulsa” e **não** têm link de Session.
- **Cards/Lista:** preservados (mesma preferência `gallery-output-view`, mesmas classes responsivas), com as mesmas ações.

### Mídia

A lista nunca traz URL exibível. Miniaturas (apenas imagens e renders estáticos), preview e download pedem uma URL nova ao **endpoint autenticado do próprio item** (`access` de S1), sob demanda e só no estado do componente (nunca como identidade):

| Família | Endpoint | Resposta | Renderer |
|---|---|---|---|
| `image` | `/api/images/:id/signed-url` | `{ imageUrl, thumbnailUrl, publicUrl }` | `<img>` |
| `video_generation` | `/api/video-generations/:id/playback-url` (`?disposition=attachment` no download) | `{ url, expiresAt }` | `<video>` |
| `video_render` | `/api/render-executions/:id/output-url` (idem) | `{ url, expiresAt }` | `<video>` |
| `static_render` | `/api/render-executions/:id/output-url` (idem) | `{ url, expiresAt }` | `<img>` |

Miniaturas carregam de forma preguiçosa (perto da viewport) e uma URL expirada é pedida de novo uma vez antes do placeholder honesto. Mídia ausente/expirada/inacessível mostra mensagem e “Tentar novamente” e **nunca remove o card** do histórico. Vídeos não têm miniatura (sem infraestrutura nova). A existência do objeto continua sendo provada apenas no acesso; HeadObject em lote é o S3.

## Testes

- `gallery-outputs-production-filter.test.ts`: filtro por família, equivalência com a lista sem filtro, conflitos/outro Project/outro dono/sem ativo, paginação antes do filtro, totais exatos, teto e falhas, recuperação de família, cursor ligado à Production.
- `gallery-outputs-route.test.ts`: validação/ownership/Project×Production/cursor/totais da rota.
- `gallery-ui-model.test.ts`: regras puras (merge, query, totais, estados vazios, rótulos, leitura das três formas de resposta de mídia).
- `components/gallery/gallery-page.test.tsx`: a página real (rede, Supabase e router simulados): quatro tipos, identidade/dedup, load more, filtros e requisições obsoletas, falha parcial/total/recuperação, totais e vazios honestos, busca local, preview e download por tipo, mídia indisponível, vídeos avulsos, vários LibraryFiles, Cards/Lista.
- Testes de texto-fonte que inspecionavam a página antiga foram reescritos para o novo pipeline sem perder a intenção (separação preview inline × download attachment, ausência de leitura de tabelas no navegador, vídeo sem miniatura, etc.).

## Limitações conhecidas

- Production com mais de 200 VideoDrafts, conteúdos/peças ou imagens-candidatas faz a(s) família(s) afetada(s) falhar de forma explícita (`PRODUCTION_FILTER_TOO_LARGE`); suportar mais exigiria agregação/visão no banco (migração) e não foi feito.
- Sem filtro “Sem Production”; sem busca no servidor (por decisão).
- `GET /api/gallery/video-outputs` e `lib/gallery-output-library.ts` (construtor antigo) não são mais usados pela página; foram mantidos (e seus testes) para não ampliar o escopo — remoção em passo posterior. `galleryStudioRenderTitle` segue usado pelo seletor I2V.
- Uma fonte que se recupera no meio da paginação pode inserir saídas fora da ordem da página atual (a lista carregada é reordenada; uma nova carga restaura a ordem estrita).
- Opções de filtro (Projects/Productions) vêm do cliente do navegador com teto de 500.
- Preview/download de renders dependem do objeto scratch existir (83/83 existiam na auditoria de 17/10/2026; sem regra de lifecycle no bucket); a falha é tratada com mensagem e retry.
