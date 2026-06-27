# UX-H3B Results - Global Image and Video Hubs

Data: 2026-06-27  
Branch: `feat/ux-global-image-video-hubs`  
Escopo: reconciliar apenas `/imagens` e `/videos` como hubs globais de rascunhos e retomada, sem implementar Galeria, Sidebar, Arquivos ou UX-H3C/H3D.

## Estado anterior

As rotas globais `/imagens` e `/videos` eram hibridas:

- mostravam rascunhos recentes;
- tentavam abrir o workspace de criacao;
- quando nao havia `production` na URL, exibiam apenas o gate de `Production obrigatoria`;
- os cards resumidos nao mostravam Project e Production de forma suficiente;
- CTAs globais podiam levar o usuario para uma tela bloqueada sem contexto.

## Contrato aplicado

As paginas globais agora comunicam:

```text
Project
-> Production
-> ImageDraft / VideoDraft
```

Sem `production` na URL, as paginas funcionam como hubs globais:

- retomada de rascunhos;
- filtros por Project, Production, status e busca;
- cards com Project e Production visiveis;
- acao explicita `Abrir`;
- acao `Ver Production` quando o draft possui contexto;
- criacao guiada por seletor Project -> Production.

Com `production` na URL, os workspaces contextuais existentes continuam sendo usados.

## Refinamento de hierarquia antes do smoke

A primeira implementacao funcional usava `Rascunhos de imagem` e `Rascunhos de video` como titulos principais. Isso estava correto para retomada, mas fazia as paginas parecerem arquivos de rascunhos, enquanto a sidebar continua oferecendo os dominios `Imagens` e `Videos`.

Refinamento aplicado:

- titulo global de `/imagens`: `Imagens`;
- titulo global de `/videos`: `Videos`;
- bloco inicial reposicionado como criacao contextual;
- listagem mantida como secao secundaria `Rascunhos recentes`;
- copy superior equilibrada entre criar e retomar;
- filtros, cards, ordenacao, contexto visivel e rotas foram preservados.

Hierarquia resultante:

```text
Imagens / Videos
-> explicacao curta
-> criar nova imagem/video
-> rascunhos recentes
-> filtros
-> lista ou cards
```

Foi considerada a criacao futura de um hub agregado de Rascunhos para Imagens, Videos e Conteudos, mas ele nao sera implementado agora porque poderia duplicar o Dashboard, os hubs de midia e o modulo editorial. A hipotese pode ser reavaliada no UX-H3D, durante a reconciliacao da Sidebar.

## Imagens

Papel aplicado:

```text
Imagens
```

O hub informa que imagens globais sao um dominio de criacao contextual e retomada. A Galeria permanece reservada para outputs visuais gerados.

Copy de identidade:

```text
A identidade do Project sera aplicada a geracao e a avaliacao.
```

Essa copy permanece verdadeira porque o workspace de imagem aplica Project Identity na geracao de prompt e avaliacao.

## Videos

Papel aplicado:

```text
Videos
```

O hub de videos usa linguagem mais restrita:

```text
A identidade do Project estara disponivel como referencia na Production.
```

Isso preserva o contrato UX-H2: videos ainda nao consomem tecnicamente Project Identity de forma comprovada.

## Visualizacao de rascunhos

Imagens e Videos passam a ser a primeira implementacao de referencia para hubs operacionais com colecoes de trabalho:

- lista e o modo padrao;
- cards sao alternativa visual;
- os dois modos exibem o mesmo conteudo essencial;
- as acoes permanecem equivalentes;
- a preferencia e persistida localmente por dominio;
- no mobile, a lista se transforma em itens compactos empilhados;
- a adocao em outras areas sera gradual.

Chaves de preferencia:

```text
image-draft-hub-view
video-draft-hub-view
```

Conteudos, Arquivos, Projects e Productions poderao adotar o padrao em rodadas futuras. Galeria pode manter cards como padrao por ter natureza visual. Nenhuma outra area foi alterada nesta rodada.

## Queries e dados

As paginas continuam client-side e usam dados autenticados/RLS existentes:

- `projects`;
- `productions`;
- `/api/image-drafts?limit=50`;
- `/api/video-drafts?limit=50`.

Nao houve nova tabela, migration ou endpoint generico.

Os hubs montam os cards em memoria a partir dos dados ja carregados. O limite de 50 rascunhos evita transformar a pagina em listagem completa nesta fase.

## Filtros

Filtros implementados:

- busca por titulo, Project, Production, status ou meta;
- Project;
- Production, filtrada pelo Project escolhido quando aplicavel;
- status.

Filtro sem resultado e diferente de ausencia total de drafts e oferece `Limpar filtros`.

## Criacao contextual

O CTA principal nao abre gerador sem contexto.

Fluxo:

```text
Nova imagem / Novo video
-> escolher Project
-> escolher Production daquele Project
-> abrir /imagens ou /videos com project e production na URL
```

Quando o Project selecionado nao possui Production, o hub orienta a criar uma Production antes de iniciar o entregavel.

## Retomada

Cards de draft preservam:

- `draftId`;
- `projectId`;
- `productionId`, quando existe.

Rotas:

```text
/imagens?draft=...&project=...&production=...
/videos?draft=...&project=...&production=...
```

Drafts legados sem Production continuam abrindo com rota segura sem inventar Production.

## Estados

Estados cobertos pelos helpers e UI:

- sem Project;
- com Project sem Production;
- sem rascunhos;
- filtro sem resultados;
- erro seguro;
- loading contextual existente;
- draft legado sem Production.

## Acessibilidade e responsividade

- Acoes explicitas `Abrir`, `Ver Production` e `Criar na Production`.
- Filtros com `Label` associado.
- Badges com texto, nao apenas cor.
- Datas em formato legivel.
- Cards em grid responsivo e stack em telas estreitas.
- Seletor Project/Production empilha em mobile.
- Nao foi criado carrossel.

## Componentes e helpers

Criado:

- `lib/draft-hub.ts`

Responsabilidades:

- montar cards de ImageDraft e VideoDraft;
- resolver rotas;
- resolver nome seguro de Production com helper defensivo existente;
- filtrar cards;
- construir estados vazios;
- preservar drafts legados sem Production;
- nao mutar objetos de entrada.

Nao foi criado framework generico de hubs.

## Testes

Criado:

- `lib/__tests__/draft-hub.test.ts`
- `lib/__tests__/view-mode-preference.test.ts`

Cobertura:

- cards de imagem com Project e Production;
- cards de video;
- rotas nested corretas;
- `Ver Production`;
- filtro por Project, Production, status e busca;
- Project sem Production;
- sem Project;
- sem drafts;
- filtro sem resultados;
- draft legado sem Production;
- fallback seguro de titulo;
- ordenacao por `updated_at`;
- nao mutacao de objetos.
- titulo global de Imagens e Videos;
- criacao antes de rascunhos recentes;
- modo padrao de lista;
- alternancia e persistencia de lista/cards;
- fallback seguro para preferencia invalida ou indisponivel;
- chaves separadas para Imagens e Videos.
- contrato de acessibilidade do toggle baseado em botoes nativos, sem `preventDefault`, `tabIndex` customizado ou handler exclusivo de teclado.

Validacao focada executada:

- `pnpm.cmd test -- lib/__tests__/draft-hub.test.ts lib/__tests__/view-mode-preference.test.ts`: aprovado; o runner executou 211 testes.
- `pnpm.cmd typecheck`: aprovado.
- `pnpm.cmd lint`: aprovado com 0 erros e 50 warnings preexistentes.

## Smoke autenticado

Resultado: aprovado funcionalmente em sessao autenticada.

Fluxos confirmados em `/imagens`:

- titulo global `Imagens`;
- bloco `Criar nova imagem` acima de `Rascunhos recentes`;
- copy de Project Identity aplicada a geracao e avaliacao;
- criacao contextual Project -> Production;
- abertura do workspace com `project` e `production` na URL;
- lista como modo padrao;
- cards como alternativa;
- persistencia visual de Lista/Cards apos reload;
- filtros por busca, Project, Production e status;
- filtro sem resultado distinto de ausencia total;
- retomada de draft com `draft`, `project` e `production`;
- retorno explicito para a Production correta.

Fluxos confirmados em `/videos`:

- titulo global `Videos`;
- bloco `Criar novo video` acima de `Rascunhos recentes`;
- copy honesta de Project Identity como referencia;
- ausencia de promessa de aplicacao tecnica da identidade a geracao de video;
- criacao contextual Project -> Production;
- abertura do workspace com `project` e `production` na URL;
- lista como modo padrao;
- cards como alternativa;
- persistencia visual de Lista/Cards apos reload;
- filtros por busca, Project, Production e status;
- retomada de draft com `draft`, `project` e `production`;
- retorno explicito para a Production correta.

Responsividade confirmada:

- mobile em 390px sem overflow horizontal;
- tablet em 768px sem overflow horizontal;
- filtros empilhados;
- lista transformada em itens compactos empilhados;
- acoes `Abrir` e `Ver Production` preservadas;
- toggle Lista/Cards visivel.

Estados raros:

- sem Project, Project sem Production, Production sem drafts e draft legado sem Production nao foram reproduzidos manualmente por ausencia de dados adequados sem alterar dados reais;
- esses estados permanecem cobertos por testes de helper e pelos estados vazios implementados.

Preferencias:

- persistencia visual de Lista/Cards confirmada por reload em Imagens e Videos;
- independencia visual entre Imagens e Videos confirmada durante o smoke;
- leitura direta de `localStorage` nao estava disponivel no sandbox do browser, entao a validacao foi feita por comportamento visivel.

Verificacao de teclado:

- o componente usa botoes nativos `type="button"`;
- nao ha `preventDefault`, `tabIndex` customizado, elemento sobreposto intencional ou handler exclusivo de mouse;
- `aria-pressed` reflete o estado ativo;
- a mesma acao `onClick` e usada para ativacao por mouse e ativacao nativa do botao;
- clique funcionou no browser autenticado;
- a automacao do browser nao alternou o modo com `Enter` ou `Space`, mas a inspecao tecnica e o teste de contrato indicam limitacao provavel do canal de automacao, nao bug no componente.

Console e Network:

- nao houve erro funcional atribuido ao UX-H3B;
- warnings/errors de lock do Supabase Auth apareceram durante navegacao rapida e foram classificados como ruido ambiental/preexistente, com recuperacao da UI.

## Validacao final

- `pnpm.cmd test`: aprovado; 12 arquivos de teste e 212 testes passaram.
- `pnpm.cmd typecheck`: aprovado.
- `pnpm.cmd lint`: aprovado com 0 erros e 50 warnings preexistentes.
- `pnpm.cmd build`: bloqueado exclusivamente por rede ao baixar Google Fonts `Geist` e `Geist Mono` via `next/font`.
- `pnpm.cmd validate`: nao executado porque repete `typecheck`, `lint` e `build` neste projeto.

## Itens adiados

- UX-H3C: Galeria como biblioteca de outputs visuais.
- UX-H3D: Sidebar e agrupamento/nomenclatura.
- Reconciliacao de `/imagens/rascunhos` e `/videos/rascunhos` como paginas legadas ou redirecionamentos para o hub principal.
- Rota global dedicada de Productions.
- Paginacao completa ou busca server-side para volumes grandes.
- Integracao tecnica de Project Identity no gerador de video.

## Conclusao

UX-H3B implementa a reconciliacao das entradas globais de Imagens e Videos como hubs de retomada e criacao contextual, sem alterar banco, Galeria, Sidebar ou geradores.
