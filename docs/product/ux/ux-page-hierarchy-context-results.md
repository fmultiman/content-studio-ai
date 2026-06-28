# UX-H4B2 - Hierarquia de paginas e mensagens contextuais

Branch: `feat/ux-page-hierarchy-context-h4b2`

## Escopo

Este lote consolidou a gramatica de hierarquia para telas internas apos UX-H3 e UX-H4B1, sem redesenhar o produto e sem reabrir listas responsivas, cards, estados globais ou formularios.

Foram tratados:

- contexto superior da pagina;
- titulo principal;
- descricao curta orientada a funcao;
- acao principal e acoes secundarias;
- posicionamento de mensagens contextuais junto ao header;
- espacamento entre header e conteudo;
- continuidade entre hubs, colecoes, bibliotecas, detalhe estrutural e workspace.

## Leitura e referencia

Foram usados como base:

- `docs/product/ux/ux-visual-consistency-audit.md`;
- `docs/product/ux/ux-responsive-list-density-results.md`;
- `docs/README.md`.

O diretorio local `docs/product/ux/design-system/` permaneceu fora do lote por contrato. Este resultado ficou alinhado conceitualmente ao briefing aprovado do DS-0R, sem afirmar leitura direta da branch documental pausada nem implementar DS-1.

## Paginas auditadas e arquetipos

| Pagina | Arquetipo | Observacao principal |
| --- | --- | --- |
| `/dashboard` | hub de continuidade | precisava de header explicito sem competir com os blocos de retomada |
| `/projetos` | colecao estrutural | virou piloto do contrato de `PageHeader` |
| `/projetos/[id]` | detalhe estrutural | precisava remover duplicacao entre topo e card principal |
| `/projetos/[id]/producoes/[productionId]` | workspace | precisava preservar breadcrumb e contexto sem duplicar o titulo |
| `/imagens` | hub de criacao | precisava explicitar o papel da pagina acima do bloco de criacao |
| `/videos` | hub de criacao | mesma logica de Imagens |
| `/galeria` | biblioteca de outputs | precisava remover `h1` duplicado e reforcar diferenca para Arquivos |
| `/conteudos` | hub editorial | precisava sair do padrao de heading uppercase como eixo principal |
| `/arquivos` | biblioteca de inputs | precisava diferenciar claramente inputs de outputs |
| `/configuracoes` | sistema | precisava separar titulo e descricao da navegacao interna por tabs |

## Inconsistencias observadas antes da implementacao

- `Header` superior era usado como titulo operacional em varias paginas, enquanto o conteudo interno criava hierarquias sem um padrao comum;
- `/galeria` renderizava dois `h1` visiveis;
- `/projetos` tinha descricao e CTA sem um header compartilhado;
- `/conteudos` ainda usava um heading de secao em uppercase como eixo principal;
- `/arquivos` e `/galeria` dependiam de copy solta para explicar bibliotecas com papeis diferentes;
- `/projetos/[id]` e `/producoes/[id]` repetiam o titulo entre o topo da pagina e o card principal;
- Dashboard tinha um topo proprio que parecia hero operacional isolado do restante do sistema.

## Contrato final do PageHeader

Foi criado um `PageHeader` leve em `components/layout/page-header.tsx`.

Contrato:

- `title` obrigatorio e unico `h1` da pagina;
- `context` opcional para contexto superior curto;
- `description` opcional;
- `metadata` opcional;
- `actions` opcionais;
- ausencia de props opcionais nao gera wrappers vazios;
- a ordem DOM permanece `context -> title -> description/metadata -> actions`;
- a acao principal permanece antes das secundarias;
- o componente nao depende de conteudo especifico de uma pagina.

## Piloto em `/projetos`

`/projetos` foi usado como piloto do lote:

- `Header` superior deixou de carregar o titulo operacional;
- o `h1` real passou para `PageHeader`;
- o CTA principal ficou junto do header;
- filtros e colecao permaneceram abaixo;
- a descricao passou a comunicar Projects como estrutura de identidade, contexto e Productions.

## Abstracoes criadas

- `components/layout/page-header.tsx`

Nenhuma abstracao maior de layout, callout global ou configuracao massiva foi criada neste lote.

## Paginas alteradas

### Dashboard

- recebeu `PageHeader` com contexto `Workspace`;
- manteve os blocos de retomada como conteudo principal;
- o topo interno de continuidade ficou menos heroico e mais proximo do resto do sistema.

### Projetos

- adotou `PageHeader` como piloto;
- CTA principal ficou acoplado ao header;
- filtros e colecao continuam logo abaixo.

### Project

- o topo superior deixou de repetir o nome do Project;
- o card principal passou a carregar o `h1`;
- o botao de volta para Projetos foi preservado como contexto leve.

### Production

- o topo superior deixou de repetir o nome da Production;
- o breadcrumb existente foi preservado;
- o card principal da Production passou a carregar o `h1`;
- o header nao compete com o workspace multimodal.

### Imagens

- o hub global recebeu `PageHeader` com contexto `Criacao`;
- o contrato de listas do H4B1 foi preservado;
- no workspace dentro de Production, o topo operacional foi mantido para nao competir com o fluxo de edicao;
- a copy do bloco interno `Criacao contextual` foi reduzida para evitar redundancia com a descricao do `PageHeader`.

### Videos

- mesmo padrao de Imagens;
- sem reabrir listas, filtros ou workspace;
- a copy do bloco interno `Criacao contextual` foi reduzida de forma espelhada.

### Galeria

- recebeu `PageHeader` com contexto `Biblioteca`;
- o `h1` duplicado foi removido;
- a descricao passou a reforcar a separacao entre Galeria e Arquivos;
- Cards, Lista, filtros e contadores permaneceram intactos.

### Conteudos

- recebeu `PageHeader` com acoes principal e secundaria;
- o eixo principal da colecao deixou de depender do heading uppercase anterior;
- a lista editorial foi reposicionada como conteudo secundario.

### Arquivos

- recebeu `PageHeader` com contexto `Biblioteca`;
- a descricao agora distingue inputs e uploads de outputs da Galeria;
- acoes de upload e lixeira foram mantidas no header, sem redesenhar a biblioteca.

### Configuracoes

- recebeu `PageHeader` com contexto `Sistema`;
- titulo e descricao ficaram acima das tabs;
- a navegacao interna por tabs foi preservada.

## Mensagens contextuais

Mensagens tratadas neste lote:

- orientacao estrutural no topo de Projetos;
- distincao Galeria x Arquivos nas duas bibliotecas;
- descricao editorial de Conteudos;
- descricao operacional de Dashboard, Imagens e Videos.

Mensagens removidas ou reposicionadas:

- o `h1` interno da Galeria foi removido;
- Conteudos deixou de depender de um heading uppercase como eixo principal;
- o topo de Projetos deixou de ser apenas uma frase solta acima da colecao.

## Responsividade

Os headers foram ajustados para:

- `1600px`, `1280px`, `1024px`, `768px` e `390px`;
- manter ordem de leitura `contexto -> titulo -> descricao -> acoes`;
- permitir quebra de acoes sem overflow;
- nao reabrir o comportamento responsivo das listas do H4B1.

## Acessibilidade

- paginas alteradas passaram a ter um `h1` explicito e unico no fluxo principal;
- `PageHeader` nao cria wrappers vazios;
- acoes permanecem como botoes e links reais;
- Project e Production detail deixaram de duplicar semanticamente o titulo entre topo e conteudo;
- o `h1` duplicado da Galeria foi removido.

## Testes

Foi criado `lib/__tests__/page-hierarchy-context.test.tsx` para cobrir:

- `PageHeader` com `h1` unico;
- props opcionais sem markup vazio;
- ordem de contexto, titulo e acoes;
- adocao do padrao nas paginas do lote;
- remocao do `h1` duplicado da Galeria;
- distincao Galeria x Arquivos;
- preservacao minima de contexto em Project e Production.

Tambem foi atualizado `lib/__tests__/draft-hub.test.ts` para refletir a nova origem do titulo das paginas de Imagens e Videos.

## Smoke humano aprovado

O smoke autenticado foi concluido com aprovacao em desktop, tablet e mobile.

### Contagem de `h1` por pagina

- `/dashboard` -> `Dashboard`
- `/projetos` -> `Projetos`
- `/projetos/[id]` -> nome do Project
- `/projetos/[id]/producoes/[productionId]` -> nome da Production
- `/imagens` -> `Imagens`
- `/videos` -> `Videos`
- `/galeria` -> `Galeria`
- `/conteudos` -> `Conteudos`
- `/arquivos` -> `Arquivos`
- `/configuracoes` -> `Configuracoes`

Todas as paginas auditadas ficaram com exatamente um `h1`.

### Viewports validados

- desktop: `1600px` e `1280px`
- tablet: `1024px` e `768px`
- mobile: `390px`

### Arquetipos confirmados

- Dashboard como hub de continuidade;
- Projetos como colecao estrutural;
- Project como detalhe estrutural;
- Production como workspace;
- Imagens e Videos como hubs de criacao com modo contextual preservado;
- Galeria como biblioteca de outputs;
- Conteudos como hub editorial;
- Arquivos como biblioteca de inputs e uploads;
- Configuracoes como area de preferencias e integracoes.

### Responsividade e overflow

- o `PageHeader` permaneceu legivel em todas as larguras auditadas;
- contexto, titulo, descricao e acoes seguiram a ordem esperada;
- nenhuma pagina do lote apresentou overflow horizontal;
- os contratos responsivos do H4B1 permaneceram preservados em Imagens, Videos e Galeria.

### Fluxos funcionais preservados

- criar Project abre e fecha sem regressao;
- abrir Project funciona;
- abrir Production e voltar ao Project funciona;
- Imagens e Videos preservam Cards, Lista e abertura de draft;
- Galeria preserva Cards, Lista, filtros, preview, origem e download;
- Arquivos preserva a acao principal de upload;
- Configuracoes preserva tabs e conteudo interno.

### Observacoes nao bloqueantes

- Project, Imagens e Videos ainda exibem estados curtos de loading antes de estabilizar, mas chegam corretamente ao estado final;
- havia redundancia leve de copy em Imagens e Videos entre o `PageHeader` e o bloco `Criacao contextual`; foi aplicada apenas uma correcao textual minima e espelhada no bloco interno, sem alterar estrutura, acoes ou layout.

## Itens deixados para H4B3

- familias de cards;
- metadata transversal;
- ordem e peso visual de acoes dentro de cards e listas;
- menus de acoes e harmonizacao de verbos entre modulos.

## Itens deixados para H4B4

- empty states completos;
- error, loading e success states globais;
- revisao mais ampla de callouts;
- formularios e tabs mobile de Configuracoes;
- revisao de mensagens inline de provider, validacao e retry.

## Riscos residuais

- o `Header` superior continua existindo como barra do shell e ainda pode receber refinamentos proprios em rodadas futuras;
- Imagens e Videos mantem comportamento misto entre hub e workspace na mesma rota, entao a padronizacao do topo nessas paginas segue deliberadamente conservadora;
- Conteudos e Arquivos ainda carregam diferencas de dominio que serao melhor harmonizadas nos lotes B3 e B4.

## Conclusao final

`UX-H4B2 SMOKE APROVADO - READY FOR FINAL VALIDATION`
