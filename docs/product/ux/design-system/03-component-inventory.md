# Component Inventory

Este inventario separa contratos comprovados na aplicacao, primitivas candidatas a DS-1 e componentes que devem continuar explicitamente ligados ao dominio.

## A. Primitivos base

Continuam como base agnostica:

- `Button`
- `Input`
- `Textarea`
- `Select`
- `Checkbox`
- `Dialog`
- `Tabs`
- `Badge`
- `Card`

Esses elementos continuam fora do escopo do DS-0 reconciliado como implementacao visual final.

## B. Estruturas compartilhadas comprovadas

### `PageHeader`

- contrato comprovado na aplicacao;
- titulo obrigatorio;
- contexto, descricao, metadata e acoes opcionais;
- sem wrappers vazios;
- um unico `h1`.

### `ContextMetadata`

- primitiva leve para metadata contextual;
- ordem e composicao controladas pela superficie;
- campos opcionais nao geram ruido;
- nao conhece entidade, query ou dominio.

### `StatusBadge`

- badge textual simples;
- tom positivo, neutro, warning ou danger;
- nao depende apenas de cor;
- nao parece botao.

### `StateMessage`

- primitiva leve para loading, empty, error, info e success;
- titulo obrigatorio;
- descricao e acao opcionais;
- sem logica de retry, query ou dominio.

### `ViewModeToggle`

- padrao aprovado para alternancia Cards/Lista;
- persistencia e acessibilidade ja comprovadas no produto.

## C. Familias de superficie comprovadas

### `ContinuationCard`

- Dashboard;
- mostra entidade, contexto, status e proxima acao;
- orientado a retomada.

### `ProjectCard`

- `/projetos`;
- acao primaria explicita `Abrir`;
- nao depende do clique no card inteiro.

### `ProductionCard`

- `/projetos/[id]`;
- visualmente distinto de `ProjectCard`;
- acao primaria ligada ao workspace.

### `DraftCard`

- Imagens e Videos em Cards e Lista;
- `Project` antes de `Production`;
- `Abrir` e `Ver Production` quando valido.

### `GeneratedOutputCard`

- Galeria;
- thumbnail, contexto, status, data e acoes condicionais;
- `Visualizar`, `Abrir origem`, `Ver Production`, `Baixar`.

### `EditorialContentCard`

- Conteudos;
- mantem identidade editorial;
- `Abrir` como proxima acao natural.

### `FileCard`

- Arquivos;
- inputs/uploads, nao outputs;
- acao so aparece quando realmente existe preview ou download valido.

## D. Limites de abstracao

### Confirmado como aceitavel

- composicao explicita;
- primitivas pequenas com API curta;
- reutilizacao apenas quando a repeticao e real.

### Explicitamente recusado

- `UniversalCard`;
- data grid universal;
- sistema global de acoes orientado por grande objeto de configuracao;
- menu de tres pontos por padrao;
- framework universal de states;
- framework global de forms.

## E. Decisoes classificadas

| Decisao | Status | Observacao |
| --- | --- | --- |
| `PageHeader`, `ContextMetadata`, `StatusBadge` e `StateMessage` como primitivas comprovadas | Confirmada | Candidatas a formalizacao em DS-1 |
| `FilterBar` global como componente ja definido | Refinada | O contrato existe, mas a implementacao final ficou para DS-1 |
| `Table` como base natural das listas densas | Substituida | H4B1 aprovou duas faixas e stack em vez de tabela universal |
| `Callout` global unico para todo contexto | Adiada para DS-1 | Taxonomia existe, anatomia visual final ainda nao |
