# Open Decisions & Hypotheses

Neste artefato estao listadas as decisoes nao totalmente mapeadas e incertezas que devem ser sanadas por acao humana (Review) ou por rodadas de design futuras antes da fixacao das bibliotecas em código real.

## 1. Decisoes Humanas Pendentes (UX / Produto)

### A. O Papel do "Studio" Theme
**Dúvida:** O tema "Studio" deverá ser uma opcao no Settings (acionada unicamente pelo usuario) ou ele se tornara o estilo "global e irrevogavel" do app (matando as opcoes neutras Light/Dark)?
**Impacto:** Se for imposto go-to-market global, precisa refinar imediatamente contraste acessivel. Se for opcao, requer arquitetura de persistencia do localstorage.

### B. Header Global vs Page Headers
**Dúvida:** O `<Header />` atual global, que muitas vezes renderiza um H1 invisivel ou conflituoso com o PageHeader da view (vide problema da Galeria que exibia 2 H1) devera ser mantido apenas como barra de utilidades (notificacoes, profile, e breadcrumbs), deixando o título H1 **inteiramente** para as views?
**Proposta:** O Header global vira TopNav utilitario apenas. As paginas assumem o H1 via `PageHeader`.

### C. Ações "Duplas" em Hubs de Produção
**Dúvida:** O que priorizar nos hubs Imagens e Videos: a ação de visualizar o Asset no painel imediato, ou de "Ver Production" que redireciona o usuario mudando o contexto dele? Ter as duas acoes simultaneamente nos mesmos pesos concorre para o clique e consome espaco util valioso que comprime grids.
**Proposta:** Manter `Abrir` ou `Preview` como Botao Primario (Accent), colocar "Ver Production" como botao secundario (Outline) acessado apenas apos visualização do item ou num dropdown (ellipsis/hover) para dispositivos nao moveis.

## 2. Dependências Estruturais (UX-H4)

A rodada `DS-0` paralela ao `UX-H4*` assume que as listas densas (Imagens, Videos, Galeria) estao pacatas no status *stack mobile / grid responsivo* gerado pelo UX-H4B1, validando a abordagem visual proposta.
* **Riscos:** Se o UX-H4 refatorar bruscamente a composicao, o inventario precisara de update.

## 3. Hipóteses

* **Hipótese de Componentes de Layout:** Assumimos que criar um `PageHeader` genérico resolvera as discrepancias entre Dashboard, Galeria e Hubs que usam `H2` e `H3` inconsistentemente.
* **Hipótese de Refatoração de Classes:** Assumimos que remover backgrounds harcoded (ex: `bg-slate-900`) e trocar por tokens semanticos (`bg-canvas` e `bg-surface`) via classes novas Tailwind não quebrará o layout desde que os arquivos de tema CSS fornecam valores mapeados em OKLCH consistentes (mantendo o contraste atual ate que os designers polam).
* **Hipótese de Navegação no Mobile:** Assumimos que em `< 768px` as entidades exibidas na interface sempre empilharao (stacking grid columns to 1fr) sem depender de carrossel horizontal de tabelas.

---
**Status da Rodada:** Aprovada e estocada. As decisoes acima podem ser respondidas nos pull requests da implementacao `DS-1`.
