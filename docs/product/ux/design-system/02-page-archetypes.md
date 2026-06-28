# Page Archetypes

Este documento consolida os arquetipos reais confirmados na aplicacao apos UX-H4. Ele substitui classificacoes amplas demais baseadas apenas em hipotese ou em referencia visual local.

## Regra geral

Cada arquetipo deve deixar claro:

- onde o usuario esta;
- qual entidade ou conjunto de entidades esta em foco;
- qual e a proxima acao valida;
- onde o conteudo principal realmente comeca.

## Arquetipos confirmados

### 1. Hub

- **Proposito:** orientar continuidade ou criacao dentro de um dominio operacional.
- **Paginas:** `/dashboard`, `/imagens`, `/videos`, `/conteudos`.
- **Contrato:** contexto leve, `h1` unico, descricao curta, acoes validas e conteudo principal logo abaixo.
- **Diferenciacao interna:**
  - `Dashboard` e hub de continuidade;
  - `Imagens` e `Videos` sao hubs de criacao;
  - `Conteudos` e hub editorial.

### 2. Colecao

- **Proposito:** listar e filtrar entidades estruturais sem virar biblioteca visual.
- **Paginas:** `/projetos`.
- **Contrato:** `PageHeader`, filtros e colecao abaixo do topo, CTA principal ligado a criacao da entidade, leitura clara da lista ou grid.

### 3. Detalhe

- **Proposito:** apresentar uma entidade estrutural e seus desdobramentos sem competir com o conteudo principal da propria entidade.
- **Paginas:** `/projetos/[id]`.
- **Contrato:** um unico `h1`, contexto leve de retorno, card principal ou bloco principal carregando a identidade da entidade.

### 4. Workspace

- **Proposito:** suportar trabalho ativo e mutavel dentro de uma entidade contextual.
- **Paginas:** `/projetos/[id]/producoes/[productionId]` e modos contextuais dentro de Imagens/Videos.
- **Contrato:** contexto estrutural preservado, header sem competir com a area de trabalho, acoes de fluxo mais proximas do conteudo editavel que do topo da pagina.

### 5. Configuracoes

- **Proposito:** concentrar preferencias, integracoes e formularios de sistema.
- **Paginas:** `/configuracoes`.
- **Contrato:** `PageHeader` acima da navegacao interna, tabs ou secoes alcancaveis em desktop e mobile, feedback persistente proximo do formulario.

## Bibliotecas dentro do modelo

Bibliotecas nao viraram um arquetipo visual universal separado. Elas se comportam como variacoes de hub ou colecao com papel diferente:

- `/galeria`: biblioteca de outputs gerados;
- `/arquivos`: biblioteca de inputs e uploads.

O que muda nao e a necessidade de um novo shell, e sim a linguagem contextual, o tipo de entidade e a relacao com filtros, preview e download.

## Contrato do PageHeader

O `PageHeader` reconciliado suporta:

- contexto opcional;
- titulo obrigatorio;
- descricao opcional;
- metadata opcional;
- acoes opcionais.

### Ordem semantica

```text
contexto estrutural
-> titulo principal
-> descricao
-> metadata
-> acoes
```

### Regras

- um unico `h1` por pagina;
- ausencia de props opcionais nao cria wrappers vazios;
- acoes nao substituem o titulo;
- descricao explica a funcao da pagina, sem repetir o titulo;
- o componente permanece de composicao explicita, nao um shell universal.

## Entidades que o arquetipo nao deve confundir

- `Project` = estrutura do trabalho;
- `Production` = workspace contextual;
- `draft` = trabalho em andamento;
- `output` = resultado gerado;
- `conteudo editorial` = item textual/editorial;
- `arquivo` = input ou upload.

## Decisoes classificadas

| Decisao | Status | Observacao |
| --- | --- | --- |
| Hub, Colecao, Detalhe, Workspace e Configuracoes como arquetipos reais | Confirmada | Comprovado por H4B2 no produto |
| Bibliotecas como shell totalmente distinto | Substituida | Galeria e Arquivos ficaram melhor como variacoes de arquetipos existentes |
| Hero operacional generico no topo de cada hub | Substituida | Produto aprovou headers mais contidos |
| Shell universal de pagina com grande objeto de configuracao | Fora do Design System | Contraria a composicao explicita aprovada |
