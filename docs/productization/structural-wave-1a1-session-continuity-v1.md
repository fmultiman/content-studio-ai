# Onda 1A-1 — continuidade canônica de sessões

Base: `c962eb1a4206cd71bfad362b87c6a55f7c035789` (PR #205, Onda 0). Branch: `feat/structural-wave-1a1-session-continuity`.

## Decisões e limites da missão

Sessões são a unidade de continuidade da geração de imagens e vídeos. ImageDraft permanece compatível como legado; VideoDraft permanece autoria legítima do Creative Editor. Session, Attempt, Draft e Output têm significados distintos. A decisão aprovada de incluir todos os outputs concluídos na Galeria será implementada na Onda 1A-2.

Nenhuma migração, exclusão, alteração de autosave, revisão, tradução, modelos ou Creative Editor. As consultas novas são somente leitura, com cliente autenticado e filtro explícito de `user_id`. A verificação não executa geração, consulta de créditos ou escrita em banco. O levantamento já fornecido (29 ImageDrafts vinculados, 41 sessões) não foi repetido.

## Comportamento e destinos

| Entidade | Continuidade |
| --- | --- |
| ImageGenerationSession ativa | `/imagens/geracoes/[sessionId]` |
| VideoGenerationSession | `/videos/geracoes/[sessionId]` |
| VideoDraft | `/creative-editor/video/[draftId]` |
| EditorialContent | `/projetos/[projectId]/conteudos/[contentId]` |
| ImageDraft sem sessão vinculada | Rota legada `/imagens?draft=...`, preservando contexto disponível |
| VideoGeneration histórica sem sessão | Continua no histórico da Production e do hub de Vídeos; não é convertida em sessão no Dashboard |

Na Production, a aba Imagens lê sessões com Project e Production explícitos e revalida ambos na derivação. O card compartilhado mostra título, status salvo, data e contexto; Continuar abre a sessão existente. Criar Imagem preserva a navegação contextual da Onda 0, sem criar sessão no clique. A aba Vídeos mantém sessões, gerações avulsas e edições em seus grupos e destinos próprios.

O Dashboard inclui sessões novas sem ImageDraft e distingue cada entidade nos itens recentes. Atividade de sessão participa da data e ordenação de Productions. Pais referenciados pelas fatias recentes são recuperados em consultas por lote: uma Production com timestamp próprio antigo não desaparece simplesmente por ficar fora das dez Productions inicialmente lidas. Nomes de contexto também são recuperados por lote; um Project incompatível não recebe o nome de uma Production alheia àquele escopo.

## Contagem e deduplicação

| Local | Regra |
| --- | --- |
| Resumo do Dashboard | Contagens exatas e separadas: Projects, Productions, sessões ativas de imagem, sessões de vídeo, edições de vídeo e conteúdos editoriais |
| Card de Production no Dashboard | Contagens exatas por entidade, filtradas pelo usuário, Project da Production e Production |
| Card de Project no Dashboard | Contagem exata de Productions do usuário naquele Project; não deriva da fatia de dez |
| Visão geral da Production | Sessões de imagem e legado órfão separados; sessões de vídeo, edições e gerações avulsas separados |
| Abas Imagens e Vídeos | Sem total misturando entidades distintas |

`legacy_image_draft_id` é a única autoridade de deduplicação: correspondência de Project, prompt ou título não cria vínculo. A busca por IDs dos drafts visíveis inclui sessões arquivadas, fora da fatia recente ou que mudaram de escopo. O índice único existente em `scripts/050_create_image_generation_session_attempts.sql` limita a busca a uma sessão por draft. Nenhum dado é excluído. Se a busca de vínculos falhar, o legado é omitido com aviso; as sessões legíveis continuam aparecendo.

Falhas de contagem produzem `null`/“—”, nunca zero fabricado. Falha de uma fonte mantém as outras e impede estados vazios categóricos. Na Production há nova tentativa de leitura. Se o histórico de vídeo estiver incompleto, ausência na fatia não vira “Sem tentativas”; aparece “Sem status” e histórico parcial.

## Consultas, limites e compatibilidade

- `lib/session-continuity.ts`: regras puras de rotas, status, escopo, deduplicação e texto dos contadores.
- `lib/dashboard-continuation.ts`: derivação dos itens, datas e cards.
- `lib/dashboard-data.ts`: consultas autenticadas, contagens exatas e recuperação dos pais.
- Listagens de sessões preservam o máximo de 100 itens e acrescentam `hasMore`, detectado por uma linha extra.
- `/api/image-drafts?productionId=...&continuity=true` preserva até 200 drafts e acrescenta `hasMore` e `linkedLegacyDraftIds` (`null` se a busca falhar). Os outros consumidores mantêm o contrato anterior.
- A listagem de VideoDraft por Production mantém até 200 itens e acrescenta `hasMore`.
- `/api/video-generations?productionId=...&continuity=true` limita a 200 gerações e acrescenta `hasMore`; os outros consumidores, inclusive o histórico do workspace de sessão, mantêm o comportamento anterior.
- Cada consulta de lista nova tem limite explícito. O Dashboard lê até 20 linhas por entidade, seis Projects e dez Productions iniciais. Recuperações por IDs são limitadas pelo tamanho dessas fatias; contagens usam `count: 'exact', head: true`.
- Contagens de até quatro Productions e status de até seis sessões visíveis geram um número limitado de consultas pequenas em paralelo. Não há fan-out por todos os registros do usuário. Os quatro Projects exibidos têm contagem própria exata.

Limitações residuais: o Dashboard é uma janela de atividade, não um inventário de todas as entidades. Uma Production cuja atividade não está em nenhuma das fatias recentes pode ficar fora dos cards. Aumentar a cobertura global de atividade requer paginação/agregação própria; nenhuma contagem total depende dessas fatias. Na Production, limites são informados por `+` ou aviso de lista parcial, sem navegação para páginas adicionais nesta onda. Vídeos avulsos não ganham falsa rota de sessão e permanecem acessíveis nos históricos existentes.

## Validação

Testes direcionados cobrem regras puras, consultas e ownership, listagens no limite, pais fora da fatia inicial, deduplicação fora da página, coexistência de sessões e VideoDrafts, destinos, criação contextual, datas, contagens, falhas, retry e ausência de escritas. Os testes de UI renderizam as páginas reais com rede/dados simulados.

| Verificação local em 16/10/2026 | Resultado |
| --- | --- |
| Suíte direcionada de continuidade, APIs, ownership, Onda 0, workspace e autosave | 558 testes, 21 arquivos, todos passaram |
| Compatibilidade dos contratos de VideoDraft/Creative Editor | 137 testes, seis arquivos, todos passaram |
| `pnpm typecheck` | Passou |
| `pnpm lint` | Passou, zero erros e 50 avisos no projeto |
| ESLint de todos os arquivos TypeScript alterados/novos | Zero erros, dois avisos preexistentes: efeito de channel pieces na Production e `img` no card de sessão |
| `pnpm build` | Passou, Next.js 16.2.4/Turbopack |
| `git diff --check` | Passou |

Total: 695 testes em 27 arquivos; não foi executada suíte global. As seis suítes adicionais são `video-canvas`, `temporal-items`, `single-writer`, `scene-composition`, `free-composition` e `element-timing`, pois importam a API de VideoDraft alterada.

Preview e smoke são registrados na PR e no artefato de entrega. Smoke autenticado só conta como validado se executado no preview desta branch; navegação em produção não valida a mudança.

## Handoff aprovado — Onda 1A-2 (sem implementação)

A Galeria deve agregar imagens IA existentes, vídeos IA com status `succeeded` e renders concluídos dos editores. Deduplicar um mesmo output pela identidade/origem persistida, preservando contexto real de Project e Production. Não salvar automaticamente em Arquivos. Reprodução e download devem usar endpoints autenticados, com ownership validado e URLs assinadas sob demanda. Uma fonte indisponível não deve ocultar saídas das outras; distinguir falha parcial de coleção vazia. Revisar paginação por fonte e ordenação agregada antes de tratar a Galeria como inventário completo.
