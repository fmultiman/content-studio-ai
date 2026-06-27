# UX-H3 Discovery - Global Navigation Reconciliation

Data: 2026-06-27  
Branch: `discovery/ux-global-navigation-reconciliation`  
Escopo: auditoria, contrato conceitual e plano incremental. Nenhuma implementacao de UI, API, banco ou schema foi feita nesta rodada.

## 1. Contexto

O UX-H1 estabilizou continuidade da Production: titulo, breadcrumb, retorno contextual, loading, tabs e refresh de `/projetos?new=true`.

O UX-H2 tornou visivel a Project Identity herdada dentro da Production e dos workspaces, com linguagem honesta por modulo:

- Imagens: identidade aplicada a geracao e avaliacao.
- Videos: identidade disponivel como referencia.
- Conteudo editorial: identidade disponivel como referencia editorial.

Com isso, a arquitetura funcional aprovada permanece:

```text
Project
-> Project Identity
-> Production
-> entregaveis e workspaces
```

O ponto ainda nao reconciliado e a navegacao global: Dashboard, sidebar, Imagens, Videos, Conteudos, Galeria e Arquivos ainda comunicam parcialmente uma arquitetura antiga orientada por ferramentas.

## 2. Problema

O usuario consegue trabalhar de forma contextual quando entra por Project -> Production, mas as entradas globais ainda competem com esse modelo.

Problemas centrais:

- o Dashboard prioriza metricas e acoes de criacao genericas;
- a sidebar e plana e nao diferencia trabalho, hubs e bibliotecas;
- `Gerar Imagem` e `Gerar Video` levam a paginas que exigem Production;
- Imagens e Videos globais misturam hub de rascunhos com workspace contextual;
- Conteudos e mais coerente como hub editorial, mas ainda pode ocultar o titulo da Production no modo global;
- Galeria usa a palavra "rascunho" para registros de `images` nao aprovados, nao para `ImageDraft`;
- Arquivos funciona como biblioteca global de uploads, mas ainda nao comunica claramente insumo, trabalho e entregavel.

## 3. Auditoria documental

Documentos lidos:

- `docs/README.md`
- `docs/product/ux/ux-baseline-audit-pre-reconciliation.md`
- `docs/product/ux/ux-reconciliation-audit-post-project-identity.md`
- `docs/product/ux/ux-production-hardening-results.md`
- `docs/product/ux/ux-inherited-project-identity-discovery.md`
- `docs/product/ux/ux-inherited-project-identity-implementation-results.md`
- `docs/PROJECT_IDENTITY_V1_IMPLEMENTATION_PLAN.md`
- `docs/ARCHITECTURE.md`
- `docs/PUBLICATION_DOMAIN_DECISIONS.md`
- `docs/PUBLICATION_IMPLEMENTATION_PLAN.md`
- documentos de ChannelPiece Media e evolucao de dominio relacionados a Galeria, arquivos e midia.

Evidencias principais:

- A primeira auditoria preserva o blocker historico: Imagens/Videos exigiam Production, mas a Production ainda nao oferecia caminho multimodal claro.
- A segunda auditoria confirma que Production virou workspace multimodal, mas marca Dashboard, sidebar, Galeria e entradas globais como riscos de continuidade.
- O UX-H1 registra que global navigation, dashboard, Galeria e Arquivos ficaram explicitamente adiados.
- O UX-H2 registra que a heranca de Project Identity ja e comunicada dentro da Production e dos workspaces, mas nao resolve navegacao global.
- Documentos antigos ainda falam em `/publicacoes`, `Post`, `style_profile` ou Galeria como aprovados/finais de forma mais normativa do que o codigo atual sustenta.

### Divergencias documentais

| Documento | Divergencia | Status para UX-H3 |
| --- | --- | --- |
| `docs/ARCHITECTURE.md` | Ainda menciona rotas/entidades antigas como `/posts`, `Post` e `style_profile`. | Usar como historico, nao como contrato atual quando conflitar com UX-H1/UX-H2/codigo. |
| `docs/PUBLICATION_IMPLEMENTATION_PLAN.md` | Usa `/publicacoes` como rota aprovada historica. | O produto atual usa `/conteudos`; tratar como decisao superada pela implementacao. |
| Docs de Galeria/Biblioteca | Descrevem separacao conceitual entre imagens geradas, biblioteca e arquivos, mas a UI atual ainda mistura copy de rascunho/resultado. | Confirmar pelo codigo antes de prometer mudanca. |

## 4. Auditoria de codigo

### Dashboard

Arquivos:

- `app/(dashboard)/dashboard/page.tsx`
- `components/dashboard/action-cards.tsx`
- `components/dashboard/stats-cards.tsx`

O Dashboard carrega contagens de `projects`, `images`, `videos` e `prompts`. A area principal pergunta "O que voce gostaria de criar hoje?", mostra cards de estatistica, tres acoes rapidas e uma area de "Atividade Recente" sem dados reais.

Acoes atuais:

- `Criar Projeto` -> `/projetos?new=true`
- `Gerar Imagem` -> `/imagens`
- `Gerar Video` -> `/videos`

Conclusao: hoje o Dashboard funciona mais como launcher de ferramentas e painel de metricas do que como superficie de retomada de trabalho.

### Sidebar

Arquivo:

- `components/layout/sidebar.tsx`

Itens atuais:

```text
Dashboard
Projetos
Imagens
Videos
Conteudos
Arquivos
Galeria
Configuracoes
```

A sidebar e plana. O estado ativo usa rota exata ou prefixo. Nao ha agrupamento entre trabalho contextual, hubs de retomada e bibliotecas.

Conclusao: a sidebar e funcional, mas comunica equivalencia entre areas que possuem papeis diferentes.

### Projetos

Arquivos:

- `app/(dashboard)/projetos/page.tsx`
- `app/(dashboard)/projetos/[id]/page.tsx`

`/projetos` e a entrada canonica para criar, listar, pesquisar, arquivar e abrir Projects. O parametro `?new=true` abre o modal de novo Project. A pagina de detalhe do Project exibe informacoes do Project, Project Identity e Productions.

Conclusao: Projetos e o hub estrutural do produto. A retomada por Production ja e mais coerente aqui do que no Dashboard.

### Production

Arquivo:

- `app/(dashboard)/projetos/[id]/producoes/[productionId]/page.tsx`

A Production e o workspace contextual onde Imagem, Video e Conteudo editorial fazem sentido juntos. Depois de UX-H1 e UX-H2, ela ja comunica titulo/intencao, retorno contextual, identidade herdada e abas multimodais.

Conclusao: a Production deve continuar sendo o lugar onde novas criacoes multimodais sao iniciadas com contexto correto.

### Imagens globais

Arquivos:

- `app/(dashboard)/imagens/page.tsx`
- `app/(dashboard)/imagens/rascunhos/page.tsx`
- `app/api/image-drafts/route.ts`

`/imagens` carrega Projects, rascunhos recentes e parametros `project`, `production` e `draft`. Sem `productionId`, a pagina mostra gate de "Production obrigatoria". Quando ha contexto, funciona como workspace de geracao.

`/imagens/rascunhos` lista todos os `ImageDrafts` e permite retomar um draft em `/imagens?draft=...`.

Conclusao: Imagens global e atualmente um hibrido. Conceitualmente deve ser hub de retomada de rascunhos de imagem e entrada guiada para escolher Production, nao um gerador sem contexto.

### Videos globais

Arquivos:

- `app/(dashboard)/videos/page.tsx`
- `app/(dashboard)/videos/rascunhos/page.tsx`
- `app/api/video-drafts/route.ts`

`/videos` replica o padrao de Imagens: rascunhos recentes, parametros de contexto, gate de Production obrigatoria e workspace quando ha `productionId`.

`/videos/rascunhos` lista `VideoDrafts` e retoma em `/videos?draft=...`.

Conclusao: Videos global tambem deve ser tratado como hub de retomada e nao como promessa de geracao independente.

### Conteudos globais

Arquivos:

- `app/(dashboard)/conteudos/page.tsx`
- `app/api/editorial-contents/route.ts`

`/conteudos` carrega Projects, `EditorialContent`, filtros por status, Project e Production. O dominio permite `EditorialContent` com `production_id` nulo. Conteudos vinculados abrem no detalhe contextual do Project.

Limite observado: no modo "Todos os projetos", a lista pode mostrar o Project, mas o titulo da Production vinculada so fica confiavel depois de carregar Productions do Project selecionado.

Conclusao: Conteudos global e legitimamente um hub editorial. Ele pode criar e retomar conteudos, inclusive legados sem Production, mas deve comunicar melhor o contexto de Project/Production quando existir.

### Galeria

Arquivo:

- `app/(dashboard)/galeria/page.tsx`

Galeria consulta a tabela `images`, busca signed URLs e filtra por:

- todas;
- aprovadas (`status === 'approved'`);
- "rascunho" (`status !== 'approved'`);
- Project.

Nao consulta `image_drafts`. Portanto, "rascunho" na Galeria nao significa workspace de `ImageDraft`, mas imagem gerada ainda nao aprovada.

Conclusao: Galeria deve ser biblioteca de outputs visuais gerados, nao hub de drafts. A copy deve evitar confundir draft de trabalho com output nao aprovado.

### Arquivos

Arquivos:

- `app/(dashboard)/arquivos/page.tsx`
- `app/api/library-files/route.ts`

Arquivos consulta `library_files`, `library_folders` e Projects. Permite upload, filtros por Project, pasta, tipo, lixeira, criacao de pastas, mover, restaurar e excluir.

O upload pode existir sem Project ou ser associado a um Project. Nao ha relacao explicita com Production no fluxo atual.

Conclusao: Arquivos e uma biblioteca global de insumos e arquivos pesados, organizada por Project e pasta. Production pode ganhar relacao futura, mas isso nao deve ser prometido como implementado hoje.

## 5. Auditoria pratica

Tentativa realizada no browser embutido em `http://localhost:3000/dashboard`.

Resultado:

- a aba abriu o app, mas redirecionou para `/login`;
- o browser embutido nao expunha abas autenticadas para reivindicar;
- nao foram criados, alterados ou removidos dados reais;
- a validacao pratica autenticada desta rodada ficou limitada pelo ambiente.

Evidencia util ainda extraida:

- rota autenticada redireciona corretamente para login quando nao ha sessao;
- a auditoria de usuario recorrente foi reconstruida por codigo e documentos atuais;
- o fluxo de usuario novo foi avaliado pelos estados vazios, CTAs e gates implementados, sem criar dados artificiais.

## 6. Modelo mental atual

| Area | Papel atual observado | Problema |
| --- | --- | --- |
| Dashboard | Launcher + metricas + placeholder de atividade | Nao prioriza continuidade |
| Projetos | Hub estrutural de Project, Identity e Productions | Papel correto, mas pouco reforcado no Dashboard |
| Production | Workspace contextual multimodal | Papel correto apos UX-H1/H2 |
| Imagens | Hibrido de rascunhos recentes + editor contextual | CTA global entra em gate |
| Videos | Hibrido de rascunhos recentes + editor contextual | Mesmo risco de Imagens |
| Conteudos | Hub editorial global | Contexto de Production pode ficar incompleto na lista global |
| Galeria | Biblioteca de outputs em `images` | Copy confunde output nao aprovado com draft |
| Arquivos | Biblioteca global de uploads por Project/pasta | Nao comunica relacao futura com Production |

## 7. Papeis recomendados

| Area | Papel principal | Pode criar? | Pode retomar? | Contexto exigido | Conteudo exibido |
| ---- | --------------- | ----------: | ------------: | ---------------- | ---------------- |
| Dashboard | Retomada operacional | Sim, por fluxo guiado | Sim | Nao exige contexto previo | Productions recentes, drafts recentes, conteudos recentes, Projects recentes |
| Projetos | Hub estrutural | Sim | Sim | Project | Projects, Project Identity, Productions |
| Production | Workspace contextual | Sim | Sim | Project + Production | Visao geral, Imagem, Video, Conteudo editorial |
| Imagens | Hub de rascunhos de imagem | Somente com Production escolhida | Sim | Production para editar/gerar | ImageDrafts e atalhos para Production |
| Videos | Hub de rascunhos de video | Somente com Production escolhida | Sim | Production para editar/gerar | VideoDrafts e atalhos para Production |
| Conteudos | Hub editorial | Sim | Sim | Project obrigatorio; Production opcional/legada | EditorialContent e ChannelPieces |
| Galeria | Biblioteca de outputs visuais gerados | Nao diretamente; encaminha para Production/Imagem | Sim, para inspecionar outputs | Project opcional como filtro | Registros de `images`, aprovados e nao aprovados |
| Arquivos | Biblioteca de insumos e arquivos | Sim, upload | Sim | Project opcional hoje | `library_files` e `library_folders` |

## 8. Perguntas centrais respondidas

### 1. O Dashboard deve ser o que?

Recomendacao: combinacao com prioridade clara.

1. Retomada de trabalho.
2. Entrada para Projects/Productions recentes.
3. Acoes guiadas de criacao.
4. Metricas secundarias.

Ele nao deve ser principalmente launcher de ferramentas.

### 2. Qual prioridade visual?

Acima da dobra:

```text
Continuar trabalhando
Productions recentes
Rascunhos recentes
Criar novo trabalho contextual
```

Metricas podem existir abaixo ou em formato mais discreto.

### 3. Acoes globais como Gerar Imagem/Vídeo devem fazer o que?

Nao devem desaparecer imediatamente, mas devem deixar de abrir um workspace sem contexto.

Opcoes recomendadas:

- se houver Production recente: oferecer "Criar imagem em [Production]";
- se nao houver: abrir seletor Project -> Production;
- se nao houver Project: orientar para criar Project primeiro.

### 4. Imagens e Videos globais sao o que?

Sao hubs de retomada de drafts, com entrada guiada para criacao contextual. Nao sao workspaces independentes.

### 5. Conteudos globais tem papel diferente?

Sim. Conteudos possui papel de hub editorial porque o dominio suporta conteudos com Project e, historicamente, conteudos sem Production. Ainda assim, quando ha `production_id`, deve exibir essa relacao.

### 6. A sidebar plana ainda e adequada?

Funciona, mas comunica mal. A recomendacao incremental e manter rotas e introduzir agrupamento leve depois que o Dashboard de retomada estiver definido.

### 7. Agrupar por Production, Biblioteca, Ferramentas ou Conteudo?

Melhor agrupamento incremental:

```text
Trabalho
- Dashboard
- Projetos
- Conteudos

Bibliotecas
- Imagens
- Videos
- Galeria
- Arquivos

Sistema
- Configuracoes
```

Este agrupamento ainda exige copy para explicar que Imagens/Videos sao rascunhos/workspaces retomaveis, enquanto Galeria e output visual.

### 8. Usuario deve ver Projects ou Productions recentes no Dashboard?

Sim, ambos, mas Productions devem vir primeiro para "continuar de onde parei". Projects recentes sao segunda camada estrutural.

### 9. Qual entidade representa melhor continuar de onde parei?

Production. Ela preserva o contexto multimodal e conecta Imagem, Video e Conteudo.

### 10. Como lidar com usuario sem Project ou sem Production?

Estado sem Project:

```text
Comece criando um Project
```

Estado com Project sem Production:

```text
Crie uma Production para iniciar imagens, videos e conteudos com contexto.
```

Estado com Production:

```text
Continue uma Production recente ou crie um novo entregavel dentro dela.
```

### 11. Galeria deve incluir o que?

No contrato atual, Galeria deve incluir outputs visuais gerados na tabela `images`.

Nao deve prometer incluir:

- `ImageDrafts`;
- `VideoDrafts`;
- todos os arquivos de `library_files`;
- outputs finais multiformato.

Filtros recomendados:

- Todas;
- Aprovadas;
- Nao aprovadas / Em revisao;
- Project;
- futuro: Production, quando a relacao existir no dado.

### 12. Arquivos deve permanecer global?

Sim. Arquivos deve permanecer como biblioteca global de uploads e insumos por Project/pasta. Uma aparicao contextual dentro da Production pode ser futura, mas nao substitui a biblioteca global.

## 9. Alternativas de navegacao

### Alternativa A - Sidebar atual, comportamento reconciliado

Mantem itens e rotas atuais. Ajusta copy, CTAs, estados vazios e Dashboard.

- Clareza: media.
- Impacto: baixo.
- Esforco: baixo.
- Risco: baixo.
- Compatibilidade: alta.
- Risco de redesign prematuro: baixo.

Boa primeira etapa, mas nao resolve totalmente a percepcao plana da sidebar.

### Alternativa B - Agrupamento leve

Agrupa itens em Trabalho, Bibliotecas e Sistema.

- Clareza: alta.
- Impacto: medio.
- Esforco: medio.
- Risco: medio, principalmente mobile/active state.
- Compatibilidade: alta se nao mudar rotas.
- Risco de redesign prematuro: baixo a medio.

Boa etapa apos consolidar o Dashboard.

### Alternativa C - Navegacao orientada a Projects

Project/Production vira entrada quase unica; modulos globais ficam secundarios.

- Clareza: alta para o modelo novo.
- Impacto: alto.
- Esforco: alto.
- Risco: alto.
- Compatibilidade: media.
- Necessidade de migracao: possivel, pois nao ha rota global de Productions.
- Risco de redesign prematuro: alto.

Nao recomendada agora.

### Alternativa D - Dashboard de retomada

Mantem sidebar, mas Dashboard vira centro operacional:

- continuar Production;
- Productions recentes;
- drafts recentes;
- conteudos recentes;
- Projects recentes;
- criacao guiada.

- Clareza: alta.
- Impacto: alto no fluxo inicial.
- Esforco: medio.
- Risco: medio por depender de consultas agregadas.
- Compatibilidade: alta.
- Risco de redesign prematuro: baixo.

Recomendada como nucleo do UX-H3.

## 10. Solucao recomendada

Implementar uma combinacao incremental:

```text
UX-H3A: Dashboard de retomada
UX-H3B: Reconciliar Imagens/Videos globais como hubs de drafts
UX-H3C: Reconciliar Galeria como biblioteca de outputs visuais
UX-H3D: Agrupamento leve da sidebar e nomenclatura
UX-H3E: Arquivos contextualizados por Project, com direcao futura para Production
```

O primeiro passo deve ser o Dashboard. Ele muda a porta de entrada sem mexer no modelo de dados e sem redesenhar a Production.

## 11. Dashboard proposto

Contrato:

- papel principal: retomada;
- papel secundario: criacao guiada;
- papel terciario: metricas;
- nao deve depender de acoes globais que desembocam em gate sem contexto.

Acima da dobra:

```text
Dashboard

Continuar trabalhando
[Production A]
Project: Portal Norte
Atualizado ha 2h
[Abrir Production]

[Production B]
Project: ...

Rascunhos recentes
[Imagem] [Video] [Conteudo]

Criar
[Nova Production] [Novo Project]
```

Metricas:

```text
Resumo
3 Projects
8 Productions
12 imagens geradas
4 conteudos em rascunho
```

Estados vazios:

```text
Sem Projects
Crie um Project para definir identidade, contexto e Productions.
[Criar Project]
```

```text
Project sem Production
Crie uma Production para iniciar imagens, videos e conteudos com contexto.
[Criar Production]
```

## 12. Modulos globais

### Imagens

Papel recomendado: `Rascunhos de imagem`.

Titulo sugerido:

```text
Rascunhos de imagem
```

Descricao:

```text
Retome imagens em andamento ou escolha uma Production para criar uma nova imagem.
```

CTA principal:

```text
Criar imagem em uma Production
```

Comportamento sem Production:

- mostrar seletor Project -> Production;
- se nao houver Production, encaminhar para criar Production;
- evitar tela de editor vazia como destino primario.

### Videos

Papel recomendado: `Rascunhos de video`.

Titulo sugerido:

```text
Rascunhos de video
```

Descricao:

```text
Retome videos em andamento ou escolha uma Production para criar um novo video.
```

CTA principal:

```text
Criar video em uma Production
```

### Conteudos

Papel recomendado: hub editorial.

Titulo atual `Conteudos` pode permanecer, com secao interna:

```text
Conteudos editoriais
```

Descricao:

```text
Crie e retome conteudos editoriais vinculados a Projects e, quando aplicavel, a Productions.
```

CTA:

```text
Novo conteudo editorial
```

Estados:

- sem Project: orientar criacao de Project;
- com Project sem Production: permitir conteudo sem Production se o dominio continuar suportando legado, mas explicar que Production organiza iniciativas multimodais;
- com Production: exibir Project e Production de forma clara.

## 13. Galeria

Contrato recomendado:

```text
Galeria = biblioteca de imagens geradas
```

Inclui:

- registros da tabela `images`;
- imagens aprovadas;
- imagens nao aprovadas;
- filtros por Project.

Nao inclui no contrato atual:

- `ImageDraft`;
- `VideoDraft`;
- arquivos enviados manualmente;
- todos os outputs finais multiformato.

Copy sugerida:

```text
Galeria de imagens geradas
```

Descricao:

```text
Consulte imagens ja geradas, aprovadas ou ainda em revisao.
```

Filtros:

```text
Todas
Aprovadas
Em revisao
Project
```

Evitar:

```text
Rascunhos
```

quando a lista nao contem `ImageDraft`.

## 14. Arquivos

Contrato recomendado:

```text
Arquivos = biblioteca global de uploads, insumos e materiais de trabalho
```

Inclui:

- arquivos enviados pelo usuario;
- pastas;
- organizacao por Project;
- lixeira;
- tipos de arquivo.

Nao prometer ainda:

- relacao obrigatoria com Production;
- sincronizacao automatica com Galeria;
- promocao automatica de entregaveis finais.

Copy sugerida:

```text
Arquivos do Project
```

quando filtrado por Project, e:

```text
Biblioteca de arquivos
```

no modo global.

## 15. Sidebar

Recomendacao incremental:

Fase inicial: manter rotas atuais e reconciliar comportamento/copy.

Fase posterior: agrupamento leve.

Wireframe:

```text
Trabalho
  Dashboard
  Projetos
  Conteudos

Bibliotecas
  Imagens
  Videos
  Galeria
  Arquivos

Sistema
  Configuracoes
```

Risco a evitar: mover tudo para uma estrutura de Project antes de existir uma rota global de Productions e antes de revisar mobile.

## 16. Microcopy e nomenclatura

Decisao para esta etapa:

- preservar `Project` e `Production` como termos de dominio, pois a UI e os documentos recentes ja os usam;
- usar portugues nos verbos, descricoes e estados;
- nao abrir uma revisao linguistica total nesta rodada.

Labels recomendadas:

| Uso | Label |
| --- | --- |
| Retomada principal | `Continuar trabalhando` |
| Lista de Productions | `Productions recentes` |
| Imagem global | `Rascunhos de imagem` |
| Video global | `Rascunhos de video` |
| Conteudo global | `Conteudos editoriais` |
| Galeria | `Galeria de imagens geradas` |
| Arquivos | `Biblioteca de arquivos` |
| Criacao guiada | `Criar em uma Production` |
| Sem Project | `Crie um Project para comecar` |
| Sem Production | `Crie uma Production para iniciar entregaveis com contexto` |
| Retomar | `Retomar` ou `Abrir Production` |

Evitar:

- `Gerar Imagem` como CTA global sem seletor de Production;
- `Gerar Video` como CTA global sem seletor de Production;
- `Rascunho` na Galeria quando o item e output nao aprovado;
- mistura aleatoria entre `Projeto`/`Project` e `Producao`/`Production`.

## 17. Wireframes textuais

### Dashboard

```text
[Dashboard]

Continuar trabalhando
[Production: Campanha multimodal]
Project: Portal Norte
Intencao: lancamento editorial
[Abrir Production]

[Production: Serie de posts]
Project: ...
[Abrir Production]

Rascunhos recentes
[Imagem - Production A] [Video - Production B] [Conteudo - sem Production]

Criar
[Nova Production] [Novo Project]

Resumo
[Projects] [Productions] [Imagens geradas] [Conteudos em rascunho]
```

### Imagens global

```text
[Rascunhos de imagem]
Retome imagens em andamento ou escolha uma Production para criar uma nova imagem.

[Criar imagem em uma Production]

Rascunhos recentes
[Draft]
Project: Portal Norte
Production: Campanha multimodal
[Retomar]
```

### Videos global

```text
[Rascunhos de video]
Retome videos em andamento ou escolha uma Production para criar um novo video.

[Criar video em uma Production]

Videos recentes
[Draft]
Project: Portal Norte
Production: Campanha multimodal
[Retomar]
```

### Conteudos global

```text
[Conteudos]
Crie e retome conteudos editoriais vinculados a Projects e Productions.

[Novo conteudo editorial]

Filtros: Project / Production / Status

[Conteudo]
Project: Portal Norte
Production: Campanha multimodal
Status: Rascunho
[Abrir]
```

### Galeria

```text
[Galeria de imagens geradas]
Consulte imagens ja geradas, aprovadas ou ainda em revisao.

Filtros: Todas / Aprovadas / Em revisao / Project

[Imagem]
Project: Portal Norte
Status: Aprovada
[Baixar]
```

### Arquivos

```text
[Biblioteca de arquivos]
Uploads, referencias e materiais de trabalho organizados por Project e pasta.

Filtros: Project / Pasta / Tipo
[Enviar arquivos] [Nova pasta]

[Arquivo]
Project: Portal Norte
Pasta: Referencias
Tipo: Imagem
```

## 18. Plano incremental

### UX-H3A - Dashboard de retomada

Arquivos provaveis:

- `app/(dashboard)/dashboard/page.tsx`
- `components/dashboard/action-cards.tsx`
- `components/dashboard/stats-cards.tsx`
- novos componentes pequenos de dashboard, se necessario.

Comportamento:

- carregar Productions recentes;
- mostrar Projects recentes;
- mostrar drafts recentes de imagem/video;
- mostrar conteudos recentes;
- substituir CTAs globais por criacao guiada.

Dependencias:

- consultas Supabase existentes;
- relacoes Project/Production ja implementadas.

Testes:

- Dashboard com Projects/Productions;
- Dashboard vazio;
- CTA sem Project;
- CTA com Project sem Production;
- ordem de retomada por `updated_at`.

Risco: medio, por agregar dados de varias tabelas.

Esforco: medio.

Pode ser implementada isoladamente: sim.

### UX-H3B - Imagens/Videos globais como hubs

Arquivos provaveis:

- `app/(dashboard)/imagens/page.tsx`
- `app/(dashboard)/imagens/rascunhos/page.tsx`
- `app/(dashboard)/videos/page.tsx`
- `app/(dashboard)/videos/rascunhos/page.tsx`
- APIs de drafts apenas se faltar Production title para listagem.

Comportamento:

- transformar entrada global em hub de drafts;
- criar seletor Project -> Production antes de abrir editor;
- exibir Project/Production em cards;
- corrigir encoding residual das paginas de rascunhos.

Testes:

- sem Production nao abre editor vazio;
- draft vinculado retoma com contexto;
- draft legado sem Production continua seguro;
- textos de video/imagem sem encoding quebrado.

Risco: medio.

Esforco: medio.

Pode ser implementada isoladamente: sim.

### UX-H3C - Galeria

Arquivos provaveis:

- `app/(dashboard)/galeria/page.tsx`
- possivelmente testes de helper/copy.

Comportamento:

- reposicionar Galeria como biblioteca de outputs visuais gerados;
- renomear filtro "rascunho" para "em revisao" ou "nao aprovadas";
- explicar que novos outputs sao criados em Production/Imagem;
- nao incluir `ImageDraft` sem decisao de produto.

Testes:

- filtros por status;
- copy nao promete drafts;
- CTA leva a criacao contextual.

Risco: baixo a medio.

Esforco: baixo.

Pode ser implementada isoladamente: sim.

### UX-H3D - Sidebar e nomenclatura

Arquivos provaveis:

- `components/layout/sidebar.tsx`
- componentes de layout responsivo, se necessario.

Comportamento:

- introduzir agrupamento leve;
- manter rotas;
- preservar estado ativo;
- validar mobile/collapsed.

Testes:

- ordem e grupos;
- active route;
- colapso;
- acessibilidade de labels.

Risco: medio por impacto global.

Esforco: medio.

Pode ser implementada isoladamente: sim, preferencialmente apos H3A.

### UX-H3E - Arquivos

Arquivos provaveis:

- `app/(dashboard)/arquivos/page.tsx`
- `app/api/library-files/route.ts`, somente se filtros exigirem dados ja existentes.

Comportamento:

- reforcar biblioteca global de uploads;
- distinguir insumo, referencia e entregavel quando o dado permitir;
- manter Production como direcao futura, nao promessa atual.

Testes:

- filtros por Project/pasta/tipo;
- estado sem Project;
- upload sem Project ainda permitido se contrato mantiver isso.

Risco: baixo a medio.

Esforco: baixo a medio.

Pode ser implementada isoladamente: sim.

## 19. Itens adiados

- rota global dedicada de Productions;
- historico completo de atividade;
- versionamento/snapshot de Project Identity por Production;
- visualizacao consolidada de todos os entregaveis finais;
- integracao Production -> Arquivos;
- Gallery multiformato com videos e ChannelPiece media;
- revisao linguistica total `Project`/`Projeto` e `Production`/`Producao`;
- redesign global da sidebar/mobile;
- deploy.

## 20. Criterios de aceite para UX-H3 Implementation

- Dashboard prioriza retomada de Production, nao launcher de ferramentas.
- `Gerar Imagem` e `Gerar Video` nao levam o usuario a um editor sem Production.
- Imagens e Videos globais comunicam claramente que sao hubs de rascunhos/retomada.
- Conteudos globais mostra Project e Production quando houver dados.
- Galeria nao chama `ImageDraft` de rascunho quando consulta apenas `images`.
- Arquivos comunica biblioteca de uploads por Project/pasta, sem prometer Production.
- Sidebar mantem rotas atuais ou adota agrupamento leve sem quebrar active state.
- Estados vazios guiam Project -> Production -> entregavel.
- Mobile nao perde acesso a rotas principais.
- Textos nao prometem consumo tecnico inexistente ou entidade nao implementada.
