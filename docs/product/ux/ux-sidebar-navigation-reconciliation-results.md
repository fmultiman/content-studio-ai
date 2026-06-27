# UX-H3D - Sidebar Navigation Reconciliation Results

Data: 2026-06-27
Branch: `feat/ux-sidebar-navigation-reconciliation`
Escopo: reconciliar Sidebar e nomenclatura global com o modelo Project -> Production, sem alterar as paginas de dominio, banco, APIs ou permissoes.

## 1. Contexto

O UX-H3 Discovery definiu que a navegacao global precisava deixar de comunicar um conjunto plano de ferramentas equivalentes. Depois de UX-H3A, UX-H3B e UX-H3C, os papeis principais ficaram claros:

- Dashboard: centro de retomada.
- Projetos: entrada estrutural para Projects e Productions.
- Conteudos: hub editorial.
- Imagens: criacao contextual e retomada de drafts de imagem.
- Videos: criacao contextual e retomada de drafts de video.
- Galeria: biblioteca de outputs visuais gerados.
- Arquivos: biblioteca global de uploads e insumos.
- Configuracoes: preferencias e integracoes.

## 2. Estado anterior

A Sidebar estava funcional, mas plana:

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

Esse modelo fazia Dashboard, hubs, bibliotecas e configuracoes parecerem areas equivalentes. O matching de rota ativa usava comparacao direta por prefixo no componente, sem contrato compartilhado e testavel.

## 3. Estrutura final

A Sidebar passa a usar agrupamento leve, com no maximo quatro grupos:

```text
Workspace
- Dashboard
- Projetos
- Conteudos

Criacao
- Imagens
- Videos

Bibliotecas
- Galeria
- Arquivos

Sistema
- Configuracoes
```

Dashboard permanece primeiro. Configuracoes permanece secundaria. Galeria nao foi colocada acima de Imagens para preservar a diferenca entre criar/retomar e consultar outputs.

Refinamento pre-smoke: o grupo `Trabalho` foi renomeado para `Workspace`. O termo e mais curto, evita tom possessivo e conversa melhor com o vocabulario atual de Project e Production.

`Conteudos` permanece em Workspace porque funciona como hub editorial e operacional: possui estados, retomada e organizacao. Ele nao representa apenas uma ferramenta de geracao, enquanto Imagens e Videos permanecem entradas explicitas de criacao multimodal.

## 4. Nomenclatura

Os labels da Sidebar permanecem curtos:

```text
Dashboard
Projetos
Conteudos
Imagens
Videos
Galeria
Arquivos
Configuracoes
```

Descricoes longas como `Rascunhos de imagem`, `Biblioteca de outputs visuais` ou `Conteudos editoriais completos` continuam pertencendo as paginas, nao ao menu global.

## 5. Item Rascunhos

Foi rejeitada a criacao de um item global `Rascunhos`.

Motivos:

- duplicaria o Dashboard como centro de retomada;
- duplicaria os hubs globais de Imagens e Videos;
- Conteudos ja possui papel editorial proprio;
- `Rascunho` e estado de trabalho, nao entidade principal;
- adicionaria ambiguidade no ultimo passo da reconciliacao global.

Essa hipotese pode ser reavaliada futuramente apenas se houver evidencia de que Dashboard, Imagens, Videos e Conteudos nao resolvem a retomada de trabalho.

## 6. Estados ativos

O contrato de rota ativa foi extraido para helper compartilhado.

Rotas esperadas:

- `/dashboard` ativa Dashboard.
- `/projetos`, `/projetos/[id]` e `/projetos/[id]/producoes/[productionId]` ativam Projetos.
- `/imagens`, `/imagens/rascunhos` e URLs com query de draft ativam Imagens.
- `/videos`, `/videos/rascunhos` e URLs com query de draft ativam Videos.
- `/conteudos` e URLs derivadas ativam Conteudos.
- `/galeria` ativa Galeria.
- `/arquivos` ativa Arquivos.
- `/configuracoes` e subrotas ativam Configuracoes.

O helper foi testado para garantir que apenas um item fique ativo por rota.

## 7. Desktop

O estilo visual existente foi preservado:

- mesma largura;
- mesmo comportamento de colapso;
- mesmos icones principais;
- mesma base de cor e hover;
- sem novo menu profundo ou dropdown.

As mudancas ficaram limitadas a agrupamento, ordem, labels, foco, `aria-current`, espacamento proporcional entre grupos e estrutura vertical.

A Sidebar agora possui tres regioes:

```text
Header da Sidebar
Navegacao rolavel
Area inferior persistente
```

O header mantem o logo quando a Sidebar esta aberta e sempre exibe o controle de abrir/fechar. A navegacao rolavel contem Workspace, Criacao e Bibliotecas. A area inferior persistente mantem apenas Configuracoes, separada por divisor visual, deixando Configuracoes alcancavel sem competir com conteudo decorativo.

O label visual `Sistema` foi removido do rodape para reduzir ruído: a separacao de area continua comunicada pelo divisor, enquanto a semantica acessivel do agrupamento permanece no componente.

O box permanente de versao beta foi removido. Ele ocupava altura util, empurrava Configuracoes e provocava rolagem desnecessaria. Comunicacoes futuras de beta devem viver em Configuracoes, Sobre ou release notes, nao como bloco fixo na Sidebar.

A rolagem continua funcional em viewports de pouca altura, mas a necessidade de barra visivel em desktop normal foi reduzida pela remocao do box beta e pela persistencia da area de Sistema. Quando a rolagem for necessaria, a barra usa aparencia discreta restrita a Sidebar.

O controle de menu possui labels acessiveis:

```text
Abrir menu
Fechar menu
```

Quando recolhida, a Sidebar mantem um botao visivel com icone de menu para reabrir a navegacao.

## 8. Mobile

Nao foi encontrada uma navegacao mobile separada em uso. A navegacao global atual permanece centralizada em `components/layout/sidebar.tsx`, que agora consome a mesma fonte de verdade.

O smoke posterior deve validar:

- comportamento em 390px e 768px;
- navegabilidade com os grupos;
- scroll quando necessario;
- alcance de Configuracoes;
- item ativo nas rotas nested.

Um drawer mobile completo com hamburger no Header nao foi implementado nesta rodada porque nao havia infraestrutura mobile separada em uso. A garantia minima aplicada e que a navegacao nao fica sem retorno visual depois de recolhida. Hamburger/drawer dedicado fica como refinamento futuro se o smoke em mobile demonstrar necessidade.

## 9. Header e breadcrumbs

Nao houve alteracao no Header nem nos breadcrumbs.

Motivo: as paginas reconciliadas em UX-H1, UX-H2, UX-H3A, UX-H3B e UX-H3C ja comunicam Project, Production e contexto local. A divergencia desta rodada estava concentrada na Sidebar global.

## 10. Acessibilidade

A Sidebar agora inclui:

- `aria-label` para a navegacao principal;
- grupos com `section` e label acessivel;
- `aria-current="page"` no item ativo;
- foco visivel nos links;
- `title` nos itens quando a Sidebar esta colapsada;
- botao nativo com `aria-label`, `aria-expanded` e `type="button"` para abrir/fechar;
- icones marcados como decorativos com `aria-hidden`.

Os labels textuais continuam presentes quando a Sidebar esta expandida, entao os icones nao dependem apenas de tooltip.

## 11. Componentes e helpers

Arquivos principais:

- `lib/sidebar-navigation.ts`: fonte de verdade para grupos, items e matching de rotas.
- `components/layout/sidebar.tsx`: renderizacao da Sidebar usando a fonte compartilhada.
- `lib/__tests__/sidebar-navigation.test.ts`: contrato de ordem, grupos, rotas ativas e acessibilidade.

Nao foi criado framework generico de navegacao.

## 12. Testes

Cobertura focada:

- Dashboard aparece primeiro;
- grupos aparecem na ordem correta;
- Projetos pertence a Workspace;
- grupo `Trabalho` nao existe mais;
- Conteudos permanece em Workspace;
- Imagens e Videos aparecem juntos em Criacao;
- Galeria e Arquivos aparecem em Bibliotecas;
- Configuracoes permanece na area inferior fixa;
- item `Rascunhos` nao existe;
- box beta nao e renderizado;
- label visual `Sistema` nao e renderizado no rodape;
- Configuracoes permanece na area inferior persistente;
- controle de abrir/fechar permanece disponivel e acessivel;
- pouca altura mantem navegacao alcancavel por rolagem local;
- rotas nested de Project e Production ativam Projetos;
- rotas de draft de Imagens e Videos ativam os hubs corretos;
- Conteudos, Galeria, Arquivos e Configuracoes ativam seus itens;
- apenas um item ativo por rota;
- Sidebar usa a fonte compartilhada;
- labels permanecem curtos;
- `aria-current` e grupos acessiveis permanecem no componente;
- helper nao muta a configuracao.

## 13. Itens adiados

- Revisao linguistica ampla entre `Project`, `Projeto`, `Production` e `Producao`.
- Navegacao mobile dedicada ou drawer global, caso o produto decida adotar esse padrao.
- Hub agregado de Rascunhos.
- Reorganizacao visual ampla da Sidebar.
- Permissoes ou feature flags por item de menu.

## 14. Checklist de smoke

Desktop:

```text
Dashboard
-> Projetos
-> Production
-> Imagens
-> Videos
-> Conteudos
-> Galeria
-> Arquivos
-> Configuracoes
```

Mobile/responsivo:

```text
390px
768px
rotas nested
scroll da Sidebar
foco visivel
item ativo unico
Configurações alcançavel
```

## 15. Smoke autenticado

Resultado: `UX-H3D SMOKE APROVADO — READY FOR FINAL VALIDATION`.

Ambiente:

- Browser autenticado em `http://localhost:3000`.
- Branch `feat/ux-sidebar-navigation-reconciliation`.
- Viewports testados: desktop `1280x800`, altura reduzida `1280x360`, tablet `768px` e mobile `390px`.

Estrutura confirmada:

```text
Workspace
- Dashboard
- Projetos
- Conteudos

Criacao
- Imagens
- Videos

Bibliotecas
- Galeria
- Arquivos

Area inferior
- Configuracoes
```

Decisoes confirmadas:

- `Workspace` substitui `Trabalho`.
- `Conteudos` permanece em Workspace por ser hub editorial e operacional.
- Imagens e Videos permanecem em Criacao.
- Galeria e Arquivos permanecem em Bibliotecas.
- Configuracoes permanece fixa no rodape.
- O label visual `Sistema` nao aparece no rodape.
- A regiao inferior mantem semantica acessivel.
- O item global `Rascunhos` nao existe.
- O box permanente de versao beta foi removido.

Rolagem:

- Desktop `1280x800`: navegacao sem rolagem real; `scrollHeight` igual a `clientHeight`; Configuracoes sempre visivel.
- Altura reduzida `1280x360`: navegacao principal rola localmente; Configuracoes permanece fixa; itens continuam alcancaveis.

Abrir e fechar:

- Ciclo `abrir -> fechar -> reabrir -> fechar -> reabrir` aprovado.
- Aberta: `Fechar menu`, `aria-expanded="true"`.
- Recolhida: `Abrir menu`, `aria-expanded="false"`.
- O controle permanece visivel e nao deixa a navegacao sem retorno.

Rotas principais aprovadas com exatamente um item ativo:

```text
/dashboard       -> Dashboard
/projetos        -> Projetos
/conteudos       -> Conteudos
/imagens         -> Imagens
/videos          -> Videos
/galeria         -> Galeria
/arquivos        -> Arquivos
/configuracoes   -> Configuracoes
```

Rotas nested aprovadas:

```text
/projetos/[projectId]                                  -> Projetos
/projetos/[projectId]/producoes/[productionId]         -> Projetos
/imagens?draft=...&project=...&production=...          -> Imagens
/videos?project=...&production=...                     -> Videos
/conteudos?project=...                                 -> Conteudos
/configuracoes?tab=api                                 -> Configuracoes
```

Responsividade:

- Desktop aprovado.
- Tablet `768px` aprovado, sem overflow horizontal.
- Mobile `390px` aprovado dentro do modelo atual de Sidebar/rail.
- Nao ha drawer mobile completo com hamburger; isso permanece como refinamento futuro, nao bloqueante, porque a navegacao continua acessivel e o controle de abertura permanece visivel.

Acessibilidade:

- `aria-current="page"` aparece no item ativo.
- Apenas um item fica ativo por rota.
- Controle abrir/fechar tem nome acessivel, `type="button"` e `aria-expanded` coerente.
- Icones acompanham texto quando a Sidebar esta expandida.
- A regiao inferior preserva semantica acessivel mesmo sem label visual `Sistema`.

Console:

- Nenhum erro ou warning relevante relacionado ao UX-H3D foi observado.
- A automacao por locator/teclado foi inconsistente para simular `Enter` em links, mas clique fisico por coordenada navegou corretamente e os itens sao links nativos. Classificado como limitacao da automacao, nao divergencia funcional.

## 16. Validacao tecnica final

Executada uma vez no fechamento da rodada:

```text
pnpm.cmd test       -> 255 testes aprovados
pnpm.cmd typecheck  -> aprovado
pnpm.cmd lint       -> 0 erros, 49 warnings preexistentes
pnpm.cmd build      -> bloqueado por rede ao baixar Geist / Geist Mono
```

O build falhou exclusivamente em `next/font` ao buscar `Geist` e `Geist Mono` em Google Fonts, uma limitacao ambiental ja conhecida do sandbox. Nao houve erro de compilacao do diff do UX-H3D antes dessa falha.

## 17. Conclusao

UX-H3D implementa a reconciliacao estrutural da Sidebar como camada final do UX-H3: a navegacao global passa a distinguir Workspace, criacao, bibliotecas e configuracoes sem alterar os workspaces ou bibliotecas ja reconciliados.

Status final: `UX-H3D APROVADO — READY FOR PR`.
