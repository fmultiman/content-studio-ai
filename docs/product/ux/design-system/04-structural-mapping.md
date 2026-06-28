# Structural Mapping

Este documento concentra a rastreabilidade entre aprendizados do UX-H4 e contratos reconciliados no Design System.

## Classificacao de decisao

- **Confirmada**: comportamento comprovado e aprovado na aplicacao
- **Refinada**: a intencao original permaneceu, mas o contrato foi ajustado
- **Substituida**: a formulacao anterior foi superada por evidencia do produto
- **Adiada para DS-1**: decisao validada conceitualmente, mas ainda sem formalizacao visual/sistemica
- **Fora do Design System**: depende de dominio, backend ou fluxo local

## Matriz de rastreabilidade

| Origem | Aprendizado | Contrato reconciliado | Documento DS | Status |
| --- | --- | --- | --- | --- |
| H4B2 | Paginas precisam de um unico `h1` | `PageHeader` e a unica fonte do titulo principal | 02-page-archetypes.md | Confirmada |
| H4B2 | Contexto, titulo, descricao e acoes precisam de ordem previsivel | Ordem DOM do `PageHeader` e composicao explicita | 02-page-archetypes.md | Confirmada |
| H4B2 | Hubs, colecoes, detalhes e workspaces nao podem parecer a mesma coisa | Arquetipos reais: hub, colecao, detalhe, workspace, configuracoes | 02-page-archetypes.md | Confirmada |
| H4B3 | Mesma entidade precisa manter mesma linguagem entre Cards e Lista | Familias de card por entidade, sem UniversalCard | 03-component-inventory.md | Confirmada |
| H4B3 | Metadata precisa de ordem estavel | `Project` antes de `Production`, data secundaria, status sem competir com titulo | 10-post-ux-h4-reconciliation.md | Confirmada |
| H4B3 | Acoes exigem semantica consistente | Verbos aprovados: `Abrir`, `Continuar Production`, `Visualizar`, `Ver Production`, `Abrir origem`, `Baixar` | 10-post-ux-h4-reconciliation.md | Confirmada |
| H4B3 | `ContextMetadata` e `StatusBadge` resolveram repeticao real sem excesso de abstracao | Primitivas leves, sem logica de dominio escondida | 03-component-inventory.md | Confirmada |
| H4B1 | Tabela universal nao cabe nas listas reais | Contrato responsivo baseado em duas faixas e stack | 05-responsive-contracts.md | Substituida |
| H4B1 | Viewport nao basta; largura util manda no layout | Contrato responsivo validado em 1600, 1280, 1024, 768 e 390 | 05-responsive-contracts.md | Refinada |
| H4B4 | Loading deve sempre chegar a estado terminal | `StateMessage` com loading contextual e saida segura | 10-post-ux-h4-reconciliation.md | Confirmada |
| H4B4 | Empty e filtered empty sao estados distintos | Taxonomia de estados com proximo passo coerente | 10-post-ux-h4-reconciliation.md | Confirmada |
| H4B4 | Retry so quando a recuperacao e local | Retry local, sem backend novo, sem loop | 10-post-ux-h4-reconciliation.md | Confirmada |
| H4B4 | Provider ausente nao e erro temporario | `Needs configuration` aponta para Configuracoes e preserva entrada | 10-post-ux-h4-reconciliation.md | Confirmada |
| H4B4 | Formularios precisam preservar valores e validar perto do campo | Contrato de forms com `aria-invalid`, erro proximo e submit protegido | 10-post-ux-h4-reconciliation.md | Confirmada |
| H4B4 | Tabs mobile de Configuracoes precisam continuar acessiveis | Overflow horizontal interno aceitavel, sem overflow global | 05-responsive-contracts.md | Confirmada |
| H4B1-H4B4 | Acessibilidade precisa acompanhar os contratos reais | `h1` unico, links para navegacao, botoes para acoes, badges textuais, tabs semanticas | 10-post-ux-h4-reconciliation.md | Confirmada |
| H4B2-H4B4 | Repeticao comprovada nao justifica sistema universal | `PageHeader`, `ContextMetadata`, `StatusBadge` e `StateMessage` sao contratos comprovados e candidatos a DS-1, sem promover UniversalCard, data grid universal ou framework global de states/forms | 03-component-inventory.md | Confirmada |
| DS-0 inicial | Tema, tokens e escala visual ainda nao foram provados na aplicacao | Formalizacao visual fica para DS-1 | 06-theme-and-token-proposal.md | Adiada para DS-1 |

## Superficies reconciliadas

| Superficie | Arquetipo | Contrato principal | Status |
| --- | --- | --- | --- |
| Dashboard | Hub | continuidade antes de gestao | Confirmada |
| Projetos | Colecao | `PageHeader`, filtros e cards estruturais | Confirmada |
| Project detail | Detalhe | identidade do Project no bloco principal, sem duplicar topo | Confirmada |
| Production workspace | Workspace | contexto estrutural preservado sem competir com o workspace | Confirmada |
| Imagens | Hub de criacao | Cards/Lista, contexto estrutural e estados de provider | Confirmada |
| Videos | Hub de criacao | modulo irmao de Imagens com diferencas de dominio preservadas | Confirmada |
| Galeria | Biblioteca de outputs | Cards-first, lista compacta e loading resiliente | Confirmada |
| Conteudos | Hub editorial | identidade editorial, `Abrir` e estados operacionais claros | Confirmada |
| Arquivos | Biblioteca de inputs | distinta da Galeria, sem prometer acoes invalidas | Confirmada |
| Configuracoes | Configuracoes | header acima das tabs, tabs alcancaveis e feedback inline | Confirmada |
