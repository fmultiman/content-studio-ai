# Responsive Contracts

Este documento oficializa as conclusoes das analises de densidade e responsividade (notavelmente as discussoes e solucoes em desenvolvimento na branch `UX-H4B1`) como contratos imutaveis de Design para o Content Agent Studio.

## 1. Regras Principais (Princípios)

* **Densidade Funcional Antes de Estetica**: Informacao primaria de identificacao de midia e textos (`Project`, `Production`, status, thumbnail) NUNCA desaparecem. Eles devem rearranjar sua posicao e tamanho.
* **Acoes Principais Sempre Acessíveis**: Botoes como `Abrir`, `Baixar`, ou `Continuar` nunca devem se esconder em *hover states* ou em menus *dropdown (kebab)* profundos quando for a razao de ser do componente. Em viewports muito pequenos, acoes quebram para uma nova linha.
* **Metadados em Condensacao**: Em layouts estreitos, metadados (`Project`, `Production`, `Data`) condensam e perdem labels obvios se necessario, mas a hierarquia posicional se mantem para permitir leitura automatizada do olhar.
* **Master-Detail vira Drawers/Stacks**: Padroes de workspace duplos (Split Workspace) devem renderizar em pilha (`stack`) em telas muito pequenas, empurrando a barra de ferramentas pro topo ou usando Sheet/Drawers de `shadcn`.
* **Cards não devem depender de hover**: Para UX Mobile (Touch) os *actions* secundários (`Ver Production`, `Apagar`) tem que estar presentes sem necessidade de :hover de mouse (sendo revelados como icon-buttons na base ou topo direito).

## 2. Breakpoints Observados e Praticados

Conforme documentado no `UX-H4B1`, os breakpoints assumem os limites maximos do container (`max-w-4xl` etc):

* **`>= 1280px` (Desktop Largo)**:
  * Layout tabular completo ou grids expandidos.
  * Sidebar expandida não quebra layout interno se o max-w permitir.
* **`1024px a 1279px` (Desktop Estreito)**:
  * Listas colapsam para menos colunas (duas faixas), acoes em segunda faixa (direita).
  * Filter bars comprimem espacos horizontais, selects ganham min-widths menores.
* **`768px a 1023px` (Tablet)**:
  * Item compacto (ListRow vira bloco robusto de duas faixas, sem os titulos longos de tabela acima).
  * Abas de Settings viram dropdowns ou grids compactos.
* **`< 768px` (Mobile)**:
  * Empilhamento estrito (Stacking).
  * Grids de OutputCards passam a 1 ou no maximo 2 colunas visiveis.
  * Componentes complexos (Tabelas) não são horizontal-scrollables, eles devem adotar Stack de "Cards".
  * Ações de botoes (flex-row) quebram ou preenchem todo block (w-full).

## 3. Dependências do UX-H4*

As implementações do DS-1 em diante devem acatar que:
* Imagens e Videos nao possuem mais grid puramente tabular. A responsividade aprovada e a de DUAS FAIXAS (metadados + acoes no fundo).
* A Galeria e as areas dependentes de Provider resolveram problemas de promessas presas que bloqueavam o UI; o design system deve prever e acoplar a implementacao de Empty State / Loading State seguindo esse contrato de *failsafe*.
* As Listas densas estao restritas ao H4B1. Quando formos aplicar a Shell em Projetos (UX-H4B2/B3) ou outros dominios, eles usarao a mesma matematica de quebra de componentes aprovada nestes testes.
