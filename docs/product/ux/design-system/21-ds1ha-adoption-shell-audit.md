# DS-1H-A Adoption and Shell Audit

## Objetivo

Mapear o estado do produto apos DS-1B a DS-1G, separar problemas internos de pagina de problemas do shell atual e deixar uma base de decisao para:

- DS-1H-B: shell pilot and decision
- DS-1H-C: shell implementation and responsive foundation
- DS-1H-D: route adoption and view modes
- DS-1H-E: final hardening and polish

## Evidencia usada

- leitura integral de `10` a `20` e `README.md` do lote de Design System;
- consulta de `01`, `03`, `05`, `07` e `08`;
- auditoria de codigo das rotas obrigatorias e do shell atual;
- verificacao de estado Git;
- verificacao de carregabilidade server-side das rotas protegidas com sessao local ja usada pelos testes do repositorio.

## Limitacao desta rodada

O servidor local subiu normalmente e as rotas protegidas responderam `200` server-side, mas a sessao autenticada nao ficou navegavel no browser in-app desta thread. Por isso:

- a classificacao abaixo e forte em evidencia de codigo e contrato;
- a verificacao visual autenticada por largura/tema ficou parcial;
- o problema estrutural principal do shell em `390px` continua suficientemente demonstrado pelo codigo, mesmo sem um smoke visual completo autenticado.

## Estado Git observado

- branch atual: `feat/design-system-adoption-audit-ds1ha`
- `HEAD`, `main` local e `origin/main` local alinhados em `baf29a4`
- `git fetch origin` executou sem erro nesta rodada
- worktree sem alteracoes de aplicacao antes da auditoria
- itens locais fora de escopo encontrados: `.codex/` e `docs/product/ux/design-system/dashboard_ref.html`

## Shell atual

### Anatomia observada

- `app/(dashboard)/layout.tsx` monta `Sidebar` fixa + `main` flexivel.
- `components/layout/sidebar.tsx` implementa um shell proprio, paralelo ao sistema generico de `components/ui/sidebar.tsx`.
- `components/layout/header.tsx` funciona como barra global de conta/notificacoes, sempre no topo da pagina.
- `main content` recebe `flex-1 overflow-hidden`; cada rota cria seu proprio `overflow-auto p-6`.
- o miolo usa `max-w-7xl`, `max-w-5xl` ou `max-w-3xl` por pagina, nao um contrato global.

### Sidebar

- fixa na esquerda;
- largura expandida `w-64` (`256px`);
- largura colapsada `w-16` (`64px`);
- colapso em `useState`, sem persistencia;
- sem provider compartilhado;
- sem atalho de teclado;
- sem drawer mobile;
- sem overlay mobile;
- sem restauracao dedicada fora do proprio botao local;
- labels de grupo somem em colapso, mas o item reduzido depende de `title`, nao de tooltip real.

### Header

- altura fixa `h-16`;
- notificacoes e menu de perfil a direita;
- sem busca global;
- sem command palette;
- sem breadcrumbs globais;
- `title` opcional existe na API do componente, mas o produto quase sempre usa `PageHeader` dentro da pagina.

### Mobile e breakpoints

- a sidebar atual nao tem breakpoint proprio;
- ela continua ocupando largura fixa em `390px`;
- o shell generico em `components/ui/sidebar.tsx` tem cookie, drawer mobile, atalho `cmd/ctrl+b`, variants `floating/inset` e tooltip real, mas nao esta ligado ao dashboard atual.

### Acessibilidade do shell

- pontos positivos:
  - `aria-current` nos links ativos;
  - `aria-label` no botao de colapso;
  - foco visivel nos links.
- lacunas:
  - colapso nao persistido;
  - modo compacto depende de `title`, nao de tooltip acessivel consistente;
  - sem fluxo mobile com foco/overlay;
  - sem landmarks mais explicitos para separar nav/header/main alem da estrutura HTML basica;
  - sem comando global de busca.

## Largura util e impacto do shell

Considerando sidebar expandida (`256px`) e `p-6` (`24px` por lado) dentro de cada pagina:

| Viewport | Largura util aproximada do miolo antes de max-width | Leitura |
| --- | --- | --- |
| `1600` | `1600 - 256 - 48 = 1296px` | quase encaixa o `max-w-7xl`; shell pouco danoso |
| `1280` | `976px` | dashboards e hubs ainda funcionam, mas colecoes perdem respiro |
| `1024` | `720px` | listas/cards de duas faixas ficam no limite |
| `768` | `464px` | a sidebar ja comprime demais e vira problema estrutural |
| `390` | `86px` | shell atual inviabiliza o produto sem colapso manual |

### Leitura principal

- `1600` e `1280`: predominam problemas locais de pagina e densidade.
- `1024`: shell e pagina passam a dividir a culpa.
- `768` e `390`: o shell atual vira o principal outlier.

## Matriz transversal por rota

| Rota | Adoção DS | Header | Cards/Rows | Filtros | Estados | Responsivo | Impacto do shell | Prioridade |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/dashboard` | `ALTA` | `PageHeader` correto | cards e grids coerentes | nao depende | estados corretos | bom ate tablet | medio | media |
| `/projetos` | `PARCIAL` | `PageHeader` correto | cards corretos | toggle/filtros locais | `StateMessage` correto | bom, mas denso | medio | alta |
| `/projetos/[id]` | `BAIXA` | heroi legacy, sem `PageHeader` | detalhe + cards locais | quase nao ha | loading/error locais | detalhe pesado | baixo/medio | alta |
| `/projetos/[id]/producoes/[productionId]` | `ESPECIAL` | breadcrumb + hero proprio | tabs + cards de workspace | tabs fortes, sem filter bar global | estados locais bons | workspace legitimo, mas apertado | medio/alto | alta |
| `/conteudos` | `ALTA` | `PageHeader` correto | lista de cards coerente | filtros claros | estados corretos | bom | medio | media |
| `/posts` | `BAIXA` | rota legacy sem `PageHeader` | split view legacy | filtros densos | estados heterogeneos | pesado | medio | baixa |
| `/imagens` | `ESPECIAL` | `PageHeader` correto | hub + workspace | forte necessidade de modo Lista/Cards | estados robustos | shell atrapalha muito em tablet/mobile | alto | alta |
| `/videos` | `ESPECIAL` | `PageHeader` correto | hub + workspace | forte necessidade de modo Lista/Cards | estados robustos | shell atrapalha muito em tablet/mobile | alto | alta |
| `/galeria` | `ALTA` | `PageHeader` correto | `BOTH` legitimo | filtros bons | estados corretos | tende a responder bem | medio | media |
| `/arquivos` | `PARCIAL` | estrutura de colecao | biblioteca mais operacional | tende a pedir lista | estados razoaveis | depende de densidade | medio | alta |
| `/configuracoes` | `ALTA` | `PageHeader` correto | cards + tabs | tabs adequadas | estados corretos | bom, com overflow interno previsto | medio | media |

## Classificacao por grupo

### Rotas `ALTA`

- `/dashboard`
- `/conteudos`
- `/galeria`
- `/configuracoes`

### Rotas `PARCIAL`

- `/projetos`
- `/arquivos`

### Rotas `BAIXA`

- `/projetos/[id]`
- `/posts`

### Rotas `ESPECIAL`

- `/projetos/[id]/producoes/[productionId]`
- `/imagens`
- `/videos`

## Problemas por rota

### `/dashboard`

- coerente com `PageHeader`, `ContextMetadata`, `StatusBadge`, `CardActions`;
- ainda mistura grid estrutural bom com dependencia do shell para continuidade;
- perde largura em `1024` para baixo, mas o problema principal ainda e do shell.

### `/projetos`

- forte adocao de primitives e `StateMessage`;
- filtros e barra de selecao ainda usam linguagem local e carregam muito violeta utilitario;
- o miolo suporta lista de cards, mas falta opçao de visao mais densa no futuro.

### `/projetos/[id]`

- continua como detalhe legacy forte;
- troca `PageHeader` por hero/card local;
- mistura identidade, descricao, contexto e acoes num bloco unico pesado;
- problema principal e interno da pagina, nao do shell.

### `/projetos/[id]/producoes/[productionId]`

- workspace legitimo com contrato proprio;
- tabs, resumo e cards vinculados fazem sentido;
- e onde o shell mais disputa espaco com o canvas;
- merece excecao semantica, nao padronizacao forcada de pagina comum.

### `/conteudos`

- bom alinhamento com DS-1G;
- filtros, metadata e CTA principal estao legiveis;
- principal ajuste futuro e densidade/visualizacao, nao semantica base.

### `/posts`

- pagina assumidamente legacy;
- split view, avisos, filtros e editor convivem em um conjunto mais pesado e menos coerente;
- nao deve guiar a direcao do shell novo.

### `/imagens`

- workspace e hub legitimos;
- forte dependencia de contexto de `Project`/`Production`;
- `ViewModeToggle` e hub de rascunhos apontam claramente para `BOTH`;
- em tablet/mobile o shell compete com o proprio canvas.

### `/videos`

- quadro muito parecido com `/imagens`;
- tambem pede `BOTH`;
- o fluxo de cenas e storyboard reforca a necessidade de largura util maior.

### `/galeria`

- uma das rotas mais prontas para adocao transversal;
- `ViewModeToggle`, filtros e metadata sustentam `BOTH`;
- shell atual ainda reduz densidade em larguras medias.

### `/arquivos`

- biblioteca operacional tende a ganhar mais com lista do que com card puro;
- a leitura funcional parece mais proxima de `LIST ONLY` ou `BOTH` com forte vies para lista;
- prioridade alta no rollout futuro.

### `/configuracoes`

- boa adocao de tabs, cards e `PageHeader`;
- overflow horizontal interno das tabs e legitimo em mobile;
- shell atrapalha menos que nas rotas de canvas.

## Problemas do shell vs problemas internos

### Problemas do shell

- sidebar fixa demais para `768` e inviavel em `390`;
- ausencia total de mobile drawer;
- ausencia de persistencia de estado expandido/compacto;
- ausencia de busca global e reserva clara para command palette;
- largura util perdida em workspaces;
- `components/ui/sidebar.tsx` ja oferece base mais madura que a implementacao ativa.

### Problemas internos de pagina

- `/projetos/[id]` ainda funciona como detalhe legacy, sem anatomia DS madura;
- `/posts` continua outlier e nao deve contaminar a decisao estrutural;
- `/projetos` ainda tem blocos locais de filtro/selecao sem consolidacao visual;
- `/arquivos` precisa decisao clara de densidade antes do rollout final.

## Lista versus Cards

| Rota | Decisao |
| --- | --- |
| `/dashboard` | `CARDS ONLY` |
| `/projetos` | `UNDECIDED` |
| `/projetos/[id]` | `NOT APPLICABLE` |
| `/projetos/[id]/producoes/[productionId]` | `NOT APPLICABLE` |
| `/conteudos` | `LIST ONLY` |
| `/posts` | `LIST ONLY` |
| `/imagens` | `BOTH` |
| `/videos` | `BOTH` |
| `/galeria` | `BOTH` |
| `/arquivos` | `LIST ONLY` |
| `/configuracoes` | `NOT APPLICABLE` |

### Leitura

- `BOTH`: `imagens`, `videos`, `galeria`
- `LIST ONLY`: `conteudos`, `posts`, `arquivos`
- `CARDS ONLY`: `dashboard`
- `UNDECIDED`: `projetos`

## Shell atual versus necessidades reais

### 1. Rotas que mais perdem largura

- `/imagens`
- `/videos`
- `/projetos/[id]/producoes/[productionId]`
- `/galeria`
- `/arquivos`

### 2. Rotas que pedem navegacao sempre visivel

- `/dashboard`
- `/projetos`
- `/conteudos`

### 3. Rotas que toleram navegacao oculta

- `/imagens`
- `/videos`
- `/projetos/[id]/producoes/[productionId]`
- `/galeria`

### 4. Rotas que mais se beneficiam de rail compacto

- `/imagens`
- `/videos`
- `/galeria`
- `/arquivos`

### 5. Rotas que poderiam usar header navigation

- `/dashboard`
- `/projetos`
- `/conteudos`
- `/configuracoes`

### 6. Acoes globais que devem permanecer no header

- perfil
- configuracoes de conta
- notificacoes
- futura busca / command palette

### 7. Onde Configuracoes deve ficar

- continua melhor proxima do perfil ou em grupo de sistema persistente;
- nao deve competir com criacao nem ocupar um dos primeiros slots de navegaçao principal.

### 8. Perfil atual

- funcional, mas preso a um header ainda subutilizado;
- a posicao faz sentido; o problema nao e o slot, e a falta de outras acoes globais ao redor.

### 9. Busca / command palette

- ha espaco futuro no header;
- nao ha espaco bom dentro da sidebar atual sem piorar largura.

### 10. Mobile

- o futuro shell precisa operar como drawer/overlay proprio;
- o conteudo precisa recuperar largura total ao fechar a navegaçao.

## Estudo do rail flutuante

### Anatomia recomendada para piloto

Estados:

- `expanded`
- `compact`
- `hidden`

Conteudo:

- `Workspace`: Dashboard, Projetos, Conteudos
- `Criacao`: Imagens, Videos
- `Bibliotecas`: Galeria, Arquivos
- `Sistema`: Configuracoes

### Regras iniciais

- fixado a esquerda;
- visualmente desacoplado do header;
- sem drag livre;
- sem docking arbitrario;
- persistencia local de estado;
- rota ativa inequivoca;
- tooltip real em compacto;
- botao claro de ocultar;
- restauracao via trigger no header;
- drawer proprio em mobile.

### Empurrar ou flutuar

Recomendacao:

- `>=1280`: rail compacto pode empurrar pouco e expandido pode empurrar o conteudo;
- `1024` e `768`: comportamento hibrido, com compacto empurrando pouco e expandido se comportando mais como overlay controlado;
- `390`: overlay/drawer, nunca fixa ocupando largura permanente.

## Estudo da top navigation

### Papel recomendado

- complemento ao rail, nao substituicao exclusiva.

### Forma

- altura contida;
- grupos: `Workspace`, `Criacao`, `Bibliotecas`;
- dropdowns so para acelerar troca, nao para esconder a IA do produto;
- item ativo e subrota precisam continuar inequivocos;
- foco e teclado precisam seguir o padrao Radix/shadcn;
- `Configuracoes` ao lado do perfil;
- command palette pode morar no header sem conflitar.

### Risco principal

- como navegaçao exclusiva, aproxima o produto de um site/control board;
- perde descoberta imediata dos destinos e aumenta cliques;
- em workspaces criativos, tira a ancora lateral que ajuda orientaçao contextual.

## Mobile

### Shell atual em `390px`

- sidebar fixa toma a largura do produto;
- nao ha overlay;
- nao ha trigger externo independente;
- nao ha retorno claro ao conteudo;
- conflito potencial com modais e CTA por simples falta de espaco;
- foco/fechamento mobile nao estao resolvidos como contrato.

### Requisitos para shell futuro

- drawer mobile com overlay;
- foco preso ao menu quando aberto;
- fechamento por `Esc`, overlay e acao explicita;
- retorno de foco ao trigger;
- sem empurrar lateralmente a pagina;
- prioridade para command palette e CTA do workspace no header.

## Acessibilidade

### Observado

- rotas ativas com `aria-current`;
- foco visivel basico em links/botoes;
- `PageHeader`, `StateMessage`, tabs e badges ja melhoraram muito apos DS-1G.

### Pendencias

- tooltip real no modo compacto;
- landmark e fluxo do drawer mobile;
- restauracao de foco ao abrir/fechar navegaçao;
- touch targets e sobreposiçao em mobile;
- garantia de reduçao de movimento no shell novo;
- evitar dependencia de hover para descobrir destinos em rail compacto.

## Notas comparativas

### A. Sidebar atual refinada

- clareza: `4/5` - ja e conhecida e legivel
- velocidade de navegaçao: `4/5` - acesso direto, poucos cliques
- largura util: `2/5` - continua cara em workspaces
- sensaçao de aplicativo criativo: `2/5` - ainda puxa para admin SaaS
- sensaçao de SaaS administrativo: `5/5` - e o comportamento dominante
- acessibilidade: `3/5` - melhoravel, sobretudo no compacto/mobile
- mobile: `1/5` - contrato atual e insuficiente
- complexidade de implementaçao: `4/5` - menor risco e menor escopo
- risco de regressao: `4/5` - baixo comparativamente

### B. Rail lateral flutuante e colapsavel

- clareza: `4/5` - continua oferecendo ancora lateral
- velocidade de navegaçao: `4/5` - um clique para tudo, com melhor equilibrio
- largura util: `5/5` - recupera area nas rotas de canvas
- sensaçao de aplicativo criativo: `5/5` - melhor encaixe com workspaces
- sensaçao de SaaS administrativo: `2/5` - reduz a casca de dashboard
- acessibilidade: `3/5` - depende de fazer compacto/hidden corretamente
- mobile: `4/5` - bom se nascer com drawer proprio
- complexidade de implementaçao: `3/5` - media, mas controlavel
- risco de regressao: `3/5` - moderado, aceitavel em piloto restrito

### C. Header navigation com dropdowns

- clareza: `2/5` - esconde destinos
- velocidade de navegaçao: `2/5` - adiciona cliques
- largura util: `5/5` - libera muito canvas
- sensaçao de aplicativo criativo: `3/5` - pode ficar elegante, mas nao ancora o workspace
- sensaçao de SaaS administrativo: `2/5` - menos dashboard, mas mais site/app-shell generico
- acessibilidade: `3/5` - viavel, porem mais delicado em menus e subrotas
- mobile: `3/5` - ainda precisaria outro padrao
- complexidade de implementaçao: `2/5` - exige arquitetura nova de navegaçao
- risco de regressao: `2/5` - alto como substituiçao exclusiva

## Recomendacao

### Recomendada

- `rail lateral flutuante e colapsavel`

Motivo:

- recupera largura util exatamente onde o produto mais precisa;
- preserva navegaçao sempre descoberta;
- conversa melhor com `imagens`, `videos` e `production workspace`;
- permite piloto reversivel sem redesenhar o resto do produto.

### Alternativa

- `sidebar atual refinada`

Motivo:

- caminho de menor risco;
- serve como fallback ou feature flag;
- nao resolve o suficiente a relaçao shell/canvas.

### Descartada como navegaçao exclusiva

- `header navigation com dropdowns`

Motivo:

- boa como complemento futuro;
- fraca como substituiçao total da navegaçao lateral nesta fase.

## Escopo proposto para DS-1H-B

### Arquivos candidatos

- `app/(dashboard)/layout.tsx`
- `components/layout/sidebar.tsx`
- `components/layout/header.tsx`
- `components/ui/sidebar.tsx`
- `lib/sidebar-navigation.ts`
- possivel novo adaptador de shell em `components/layout/`

### Componentes candidatos

- provider real de sidebar/rail;
- trigger global no header;
- rail content sectionado por grupos;
- tooltip real no modo compacto;
- drawer mobile.

### Feature flag / reversao

- manter shell atual preservado atras de flag simples;
- rollback deve ser troca de layout wrapper, nao reescrita de rotas;
- preferir variavel local, cookie ou gate interno no layout autenticado.

### Rotas piloto

- `/imagens`
- `/videos`
- `/projetos/[id]/producoes/[productionId]`

Motivo:

- sao as rotas onde o ganho de largura fica mais verificavel.

### Breakpoints do piloto

- `1600`
- `1280`
- `1024`
- `768`
- `390`

### Estados do piloto

- `expanded`
- `compact`
- `hidden`
- `mobile-open`

### Persistencia

- persistencia local do estado do rail;
- persistencia separada para intensidade de Studio ja existe e nao deve ser reaberta.

### Testes

- smoke manual por rota piloto nos tres temas;
- verificacao em `1600/1280/1024/768/390`;
- foco, `Esc`, overlay, retorno ao conteudo e rota ativa;
- ausencia de overflow horizontal global;
- comparativo com shell atual atras de flag.

### Criterios de aprovacao

- largura util claramente maior em workspaces;
- nenhum retrocesso em `dashboard`, `projetos` e `configuracoes`;
- mobile deixa de depender de sidebar fixa;
- rota ativa e descoberta continuam inequívocas;
- sem regressao de acessibilidade basica.

### Riscos

- overlay mal calibrado em tablet;
- rail compacto depender demais de hover;
- header ganhar carga demais cedo;
- piloto contaminar paginas que nao precisam de shell novo.

## Veredito desta rodada

```text
DS-1H-A APROVADO COM PENDENCIAS
```

Pendencias restantes:

- smoke visual autenticado completo por largura/tema;
- confirmacao final da rota de `arquivos` em runtime autenticado;
- validacao comparativa visual do shell futuro so em DS-1H-B.
