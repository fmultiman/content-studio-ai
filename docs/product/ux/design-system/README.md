# Design System V1 - Discovery and Structural Mapping (DS-0)

## Objetivo

Este diretorio documenta o estado discovery do Design System V1 do Content Agent Studio. O papel do DS-0 e transformar comportamento comprovado do produto em contratos explicitos, sem antecipar a implementacao visual do DS-1.

## Escopo atual

- inventario historico das superficies;
- analise de referencia visual local;
- definicao de arquetipos e mapeamento estrutural;
- consolidacao dos contratos comprovados durante UX-H4;
- backlog explicito do que DS-1 ainda precisa formalizar.

## Limitacoes

- DS-0 nao altera a aplicacao;
- DS-0 nao implementa componentes visuais novos;
- DS-0 nao define ainda tokens, paleta, escalas ou anatomias finais de DS-1;
- referencias visuais locais continuam sendo referencia, nunca fonte de verdade acima do produto aprovado.

## Status

- **DS-0:** concluido
- **DS-0R:** reconciliado primeiro com UX-H4B1
- **DS-0 pos-UX-H4:** reconciliado com UX-H4B1, H4B2, H4B3 e H4B4
- **DS-1A:** concluido (Foundation Audit e Semantic Token Contract)
- **DS-1B:** concluido (Token Infrastructure)
- **DS-1C:** concluido
- **DS-1D:** concluido
- **DS-1E:** concluido
- **DS-1F:** concluido
- **DS-1G:** consolidado nesta branch de trabalho
- **DS-1H em diante:** backlog posterior de adocao transversal e hardening

## Leitura recomendada

1. [Current UI Inventory](00-current-ui-inventory.md)
   Fotografia historica das superficies antes da reconciliacao completa do UX-H4.

2. [Hermes Reference Analysis](01-hermes-reference-analysis.md)
   Referencia visual local. Nao substitui contratos comprovados no produto.

3. [Page Archetypes](02-page-archetypes.md)
   Arquetipos reais confirmados apos H4B2.

4. [Component Inventory](03-component-inventory.md)
   Inventario reconciliado de primitivas, estruturas compartilhadas, familias de cards e limites de abstracao.

5. [Structural Mapping](04-structural-mapping.md)
   Matriz de rastreabilidade entre UX-H4 e contratos do Design System.

6. [Responsive Contracts](05-responsive-contracts.md)
   Contratos responsivos comprovados na aplicacao apos H4B1-H4B4.

7. [Theme and Token Proposal](06-theme-and-token-proposal.md)
   Material preparatorio de DS-1. Nao e contrato comprovado do produto.

8. [Migration Strategy](07-migration-strategy.md)
   Sequenciamento de alto nivel para implementacao futura do DS-1 em diante.

9. [Open Decisions](08-open-decisions.md)
   Pendencias reais e fronteira entre DS-0 reconciliado e backlog de DS-1.

10. [UX-H4B1 Reconciliation](09-ux-h4b1-reconciliation.md)
    Registro intermediario da reconciliacao limitada ao H4B1.

11. [DS-0 Post UX-H4 Reconciliation](10-post-ux-h4-reconciliation.md)
    Fonte canonica da reconciliacao final do DS-0 apos H4B1, H4B2, H4B3 e H4B4.

12. [Foundation Audit (DS-1A)](11-ds1a-foundation-audit.md)
    Auditoria do estado atual da base de codigo.

13. [Semantic Token Contract (DS-1A)](12-semantic-token-contract.md)
    Contrato semantico e arquitetura de camadas de tokens.

14. [Theme Mapping Plan (DS-1A)](13-theme-mapping-plan.md)
    Mapeamento de papeis e diretrizes para os temas light, dark e studio.

15. [DS-1 Implementation Roadmap (DS-1A)](14-ds1-implementation-roadmap.md)
    Ordem de implementacao, limites, e riscos para os proximos passos.

16. [DS-1B Token Infrastructure](15-ds1b-token-infrastructure.md)
    Implementacao da camada inicial de tokens semanticos, compatibilidade shadcn e mecanismo unico de tema.

17. [DS-1C Light and Dark Baseline](16-ds1c-light-dark-baseline.md)
    Formalizacao do baseline visual de light e dark, com auditoria inicial, refinamento de tokens e limites explicitados.

18. [DS-1D Studio Theme](17-ds1d-studio-theme.md)
    Implementacao do tema Studio com tipografia propria, atmosfera Hermes-like e intensidades `soft`, `balanced` e `expressive`.

19. [DS-1E Controls and Indicators](18-ds1e-controls-indicators.md)
    Refinamento sistemico de controles compartilhados, badges, indicadores, loading e feedback, sem redesign amplo de paginas ou cards de dominio.

20. [DS-1F Card Anatomies](19-ds1f-card-anatomies.md)
    Taxonomia real de familias de cards, pilotos aprovados, expansao controlada para call sites equivalentes e limites explicitados para DS-1G e DS-1H.

21. [DS-1G Proven Primitives](20-ds1g-proven-primitives.md)
    Consolidacao das primitivas comprovadas, remocao de wrappers UI sem uso, unificacao do sistema de toast e registro do que permanece `LOCAL BY DESIGN`.

22. [DS-1H-A Adoption and Shell Audit](21-ds1ha-adoption-shell-audit.md)
    Auditoria transversal de adocao apos DS-1G, separacao entre problemas de pagina e shell, decisao preliminar sobre `Lista/Cards` e recomendacao de piloto para DS-1H-B.

23. [DS-1H-B Shell Pilot and Decision](22-ds1hb-shell-pilot.md)
    Piloto funcional e reversivel do novo shell com top utility bar compacta, rail desktop flutuante/colapsavel, drawer mobile convencional e decisao final para o lote seguinte.

## Fonte de verdade

Na reconciliacao pos-UX-H4, a ordem de evidencia passa a ser:

1. comportamento aprovado na aplicacao;
2. resultados documentados de UX-H4B1 a UX-H4B4;
3. briefing aprovado do DS-0R;
4. referencias visuais locais.

## Relacao com UX-H4

O UX-H4 deixou de ser apenas um insumo paralelo e passou a ser a principal evidencia operacional do DS-0 reconciliado. Os contratos reais de:

- PageHeader;
- Cards, metadata e acoes;
- loading, empty, filtered empty, error, success e retry;
- tabs mobile de Configuracoes;
- responsividade e acessibilidade;

agora devem ser lidos pelo documento canonico de reconciliacao final e nao pelas hipoteses anteriores congeladas em H4B1.

## Proxima etapa

Com o DS-1F implementado, o proximo checkpoint natural passa a ser:

- fechar o lote de anatomias de cards em Git e PR;
- consolidar primitivas realmente adotadas e usos locais remanescentes em DS-1G;
- tratar adocao transversal, listas Lista/Cards e hardening responsivo em DS-1H;
- tratar adocao transversal, listas Lista/Cards e hardening responsivo em DS-1H;
- manter o shell `390px` como tema estrutural separado dos lotes visuais do DS-1.
