# Component Inventory

Esta classificacao serve para guiar a construcao do Design System separando componentes que sao meras cascas primitivas de componentes fortemente ligados ao negocio (Domain).

## A. Primitivos (Core UI)

Componentes agnósticos sem conhecimento de negocio (Atualmente supridos em sua maioria pelo shadcn/ui).
- `Button`
- `Input` / `Textarea` / `Select` / `Checkbox`
- `Dialog` / `Sheet` (Modais)
- `Tabs` (List/Trigger/Content)
- `Tooltip`
- `Badge` (Neutro, cor definida por prop generica)
- `Card` (Apenas a caixa, Header/Content/Footer)
- `Table`

## B. Componentes Compartilhados (Shared Structures)

Componentes estruturais usados por multiplas areas, compostos por Primitivos e Tokens semanticos, mas ainda independentes do modelo de dados exato (Project/Production).
- `PageHeader` (H1 unico, texto descritivo e Ação principal).
- `SectionHeader` (H2 com divisor, ou título de aba).
- `FilterBar` / `FilterCard` (Padrão de barra de controle com search input lado a lado com selects responsivos).
- `EmptyState` (Container com icone discreto, titulo, mensagem e CTA para "reiniciar" a view).
- `StatusBadge` (Extensao do Badge genérico que processa strings fixas de sucesso, erro, atencao e as formata visualmente, ex: `StatusBadge status="completed"`).
- `ViewModeToggle` (Switch visual entre Lista e Grid).
- `Callout` (Caixa colorida leve para avisos/Dicas).
- `Sidebar` (Shell esquerdo padrao).

## C. Componentes de Domínio (Domain Specific)

Componentes que conhecem especificamente as entidades do banco ou APIs do Content Agent. Eles recebem tipos de negocio (ex: um objeto `Project` ou `Production`) e renderizam o template correspondente.
- `OperationalCard` (Renderiza contexto rapido para retomada).
- `DraftCard` (Card que contem dados estritos do Hub de imagens/videos, icone, metadata em ordem).
- `OutputCard` (Gallery, thumbnail focada no topo e metadata e botões na base).
- `ListRow` (Renderiza a linha tabular ou em duas faixas para Hubs de Imagens, Videos e Galerias, incorporando as acoes `Abrir`, `Ver Production`, etc).
- `IdentitySummary` (Bloco visual compacto para contexto herdado).
- `EvaluationPanel` (Componente de UI de aprovação de imagem gerada).

## D. Componentes Locais ou Duplicados (Refatoracao Candidata)

Identificacao de redundancias e divergencias atuais:
- Multiplos headers locais: Projetos tem header inline, Conteudos tem uppercases espalhados, Galeria possui header global conflitando com a secao interna. **Deve ser substituído pelo `PageHeader` (Shared).**
- Botoes de Acao (Call-to-Action) por contexto: Paginas renderizam suas proprias div de botoes, as vezes quebrando linhas. **Devem padronizar seus verbos e respeitar limites de flex-wrap.**
- Metadata rows: Repetem-se de formas diferentes nos hubs (Dashboard exibe metadados diferente dos DraftCards). **Deve se convergir usando uma ordem canonica descrita no DS.**
- Status: Botoes de status sao renderizados com hardcoded classes em multiplos lugares (ex: text-green-500, text-red-500). **Necessário adotar um `StatusBadge` global.**
