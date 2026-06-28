# DS-0 Post UX-H4 Reconciliation

## Objetivo

Consolidar o que o produto realmente aprovou durante UX-H4 e transformar esses aprendizados em contratos explicitos do DS-0, sem implementar DS-1.

## Regra de evidencia

Fonte de verdade, nesta ordem:

1. comportamento aprovado no produto;
2. resultados documentados de H4B1, H4B2, H4B3 e H4B4;
3. briefing aprovado do DS-0R;
4. referencias visuais locais.

## Estrutura documental canonica

- `02-page-archetypes.md`: arquetipos e contrato do `PageHeader`
- `03-component-inventory.md`: primitivas comprovadas, familias e limites de abstracao
- `04-structural-mapping.md`: rastreabilidade
- `05-responsive-contracts.md`: contratos responsivos comprovados
- `08-open-decisions.md`: backlog e fronteira DS-1
- este documento: decisoes consolidadas, substituicoes e veredito

## Decisoes confirmadas

### Arquetipos

- hub;
- colecao;
- detalhe;
- workspace;
- configuracoes.

### PageHeader

- titulo obrigatorio;
- contexto opcional;
- descricao opcional;
- metadata opcional;
- acoes opcionais;
- ausencia de wrappers vazios;
- ordem DOM previsivel;
- um unico `h1`;
- composicao explicita, sem objeto universal de configuracao.

### Familias de cards

- `ProjectCard`
- `ProductionCard`
- `DraftCard`
- `GeneratedOutputCard`
- `EditorialContentCard`
- `FileCard`
- `ContinuationCard`

### Metadata

Ordem-base quando os campos existem:

```text
titulo
-> resumo
-> Project
-> Production
-> status
-> tipo ou origem
-> atualizacao
-> acoes
```

Regras:

- `Project` antes de `Production`;
- data com peso secundario;
- status nao compete com o titulo;
- tipo/origem nao parece acao;
- fallback sem Production permanece explicito quando necessario;
- Cards e Lista mantem o mesmo significado.

### Acoes e verbos

Verbos aprovados:

- `Abrir`
- `Continuar Production`
- `Visualizar`
- `Ver Production`
- `Abrir origem`
- `Baixar`

Significados aprovados:

- `Abrir`: entrada generica na entidade ou workspace;
- `Continuar Production`: retomada de workspace contextual;
- `Visualizar`: preview sem edicao;
- `Ver Production`: navegacao estrutural para a Production;
- `Abrir origem`: retorno ao draft/origem;
- `Baixar`: download de asset.

### States

Taxonomia comprovada:

- Loading
- Empty
- Filtered empty
- Error
- Partial failure
- Success
- Disabled
- Unavailable
- Needs configuration
- Validation error
- Retryable error
- Non-retryable error

Distincoes essenciais:

```text
lista vazia != filtro sem resultado
provider ausente != erro temporario
falha de um item != falha estrutural da pagina
campo invalido != erro do servidor
```

### Formularios

- label visivel;
- placeholder nao substitui label;
- erro proximo ao campo;
- `aria-invalid`;
- mensagem associada ao campo;
- required explicito;
- disabled e loading distintos;
- submit protegido;
- valores preservados apos falha;
- erro nao fecha modal;
- cancelamento previsivel;
- foco no primeiro erro quando adequado;
- footer alcancavel em mobile.

### Responsividade

- validacao operacional em `1600`, `1280`, `1024`, `768` e `390`;
- ausencia de overflow horizontal global;
- Cards e Lista adaptam densidade;
- acoes fazem wrap;
- metadata quebra linha com seguranca;
- tabs mobile podem usar overflow horizontal interno;
- empty states nao ocupam altura desproporcional;
- conteudo nao depende so de hover.

### Acessibilidade

- um unico `h1`;
- ordem DOM coerente;
- links para navegacao;
- botoes para acoes;
- foco visivel;
- badges com texto;
- labels acessiveis em acoes por icone;
- `role="status"` para loading apropriado;
- `role="alert"` apenas para erros reais;
- `aria-live` proporcional;
- `aria-invalid` e mensagens associadas;
- tabs com semantica e estado ativo;
- controles indisponiveis fora do DOM ou realmente disabled;
- sem dependencia exclusiva de cor, icone ou hover;
- evitar links aninhados.

## Decisoes refinadas

| Tema | Formulação anterior | Contrato reconciliado | Evidencia |
| --- | --- | --- | --- |
| Bibliotecas | Galeria e Arquivos como mesma familia visual ampla | Mesma logica estrutural, mas papeis claramente distintos: outputs vs inputs | H4B2, H4B3 |
| Filter bar | Hipotese de componente unico ja definido | Contrato funcional confirmado, implementacao final adiada | H4A, H4B1 |
| StatusBadge | Badge global generico | Primitiva leve textual com tons limitados e sem dependencia de cor | H4B3 |
| StateMessage | EmptyState/Callout generico | Primitiva limitada a estados reais, sem virar framework universal | H4B4 |

## Decisoes substituidas

### 1. Hero operacional generico no topo dos hubs

- **Formulação anterior:** headers de pagina poderiam assumir hero, saudacao e bloco de destaque amplo.
- **Por que foi substituida:** o produto aprovado ficou mais claro com headers contidos, sem competir com o conteudo.
- **Contrato aprovado:** `PageHeader` leve e composicional.
- **Evidencia:** H4B2.

### 2. Grid tabular como resposta natural para listas densas

- **Formulação anterior:** listas deveriam tender a tabela ou grid de colunas fixas.
- **Por que foi substituida:** viewport nao representa largura util, e o modo tabular colapsava com sidebar e containers reais.
- **Contrato aprovado:** duas faixas em desktop/tablet e stack em mobile; tabela nao e universal.
- **Evidencia:** H4B1.

### 3. Card universal

- **Formulação anterior:** cards equivalentes poderiam convergir para um componente unico.
- **Por que foi substituida:** a diferenca entre Project, Production, draft, output, conteudo e arquivo e semantica, nao apenas cosmetica.
- **Contrato aprovado:** familias distintas com linguagem equivalente apenas quando a entidade e a mesma.
- **Evidencia:** H4B3.

### 4. Empty state unico

- **Formulação anterior:** vazio poderia ser tratado como um unico padrao visual e textual.
- **Por que foi substituida:** empty estrutural, filtered empty, needs configuration e erro estrutural respondem perguntas diferentes.
- **Contrato aprovado:** taxonomia explicita de estados.
- **Evidencia:** H4B4.

### 5. Toast como feedback suficiente

- **Formulação anterior:** confirmacoes e falhas poderiam depender principalmente de toast.
- **Por que foi substituida:** fluxos criticos exigem feedback inline e persistente.
- **Contrato aprovado:** toast transitorio, inline para correcao ou estado persistente.
- **Evidencia:** H4B4.

## Decisoes adiadas para DS-1

### P1 - Fundacoes visuais

- tokens semanticos;
- escala tipografica;
- espacamento;
- radius;
- elevacao;
- cores e tons de estado.

### P2 - Anatomias finais

- anatomia visual de cards;
- variantes formais de badges;
- variantes formais de botoes;
- anatomia visual de states e callouts.

### P3 - Sistema e adocao

- catalogo visual;
- documentacao de componentes;
- criterios de migracao;
- criterios de adocao;
- motion e iconografia.

## Fora do Design System

- backend de retry;
- novas queries so para metadata;
- regras de schema;
- autorizacao;
- semantica de negocio de provider alem da UX aprovada;
- redesign de dominio editorial ou de upload.

## Limites de abstracao

Principios:

```text
repeticao comprovada -> pode justificar primitiva
semelhanca superficial -> nao justifica componente universal
diferenca de dominio -> deve permanecer visivel
composicao explicita -> preferivel a configuracao excessiva
```

Primitivas comprovadas ate aqui:

- `PageHeader`
- `ContextMetadata`
- `StatusBadge`
- `StateMessage`

Elas devem ser tratadas como:

```text
contratos comprovados na aplicacao
-> candidatos a formalizacao no DS-1
```

## Backlog priorizado de DS-1

| Prioridade | Decisao ja comprovada | O que DS-1 precisa formalizar |
| --- | --- | --- |
| P1 | `PageHeader` leve e composicional | anatomia visual, espacamento, escala e variantes finais |
| P1 | Familias de cards por entidade | anatomia visual e criterios de uso por familia |
| P1 | Status textual com tom semantico | variantes formais de badge e mapeamento visual |
| P1 | Taxonomia de states | variantes formais de loading, empty, error e success |
| P2 | Formularios com erro proximo e submit protegido | field patterns, spacing e feedback visuals |
| P2 | Tabs mobile com overflow interno seguro | componente/documentacao de tabs responsivas |
| P2 | Responsividade comprovada em larguras reais | estrategia final de tokens ou breakpoints |
| P3 | Acessibilidade estrutural consistente | checklist formal de componentes e estados |

## Veredito

O DS-0 pos-UX-H4 esta:

```text
DS-0 POS-UX-H4 RECONCILIADO - READY FOR FINAL REVIEW
```

Justificativa:

- os contratos do produto agora estao refletidos;
- contradicoes relevantes foram resolvidas ou marcadas;
- decisoes antigas superadas foram explicitadas;
- a fronteira entre DS-0 e DS-1 esta clara;
- o backlog do DS-1 esta explicito;
- a rastreabilidade principal esta coberta.
