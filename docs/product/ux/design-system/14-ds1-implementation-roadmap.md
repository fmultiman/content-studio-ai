# DS-1 Implementation Roadmap

## Escopo Geral
O lote DS-1 formaliza a infraestrutura técnica dos temas aprovados sem quebrar as fundações do UX-H4. A abordagem não pode ser em "Big Bang". O objetivo é substituição progressiva de estilos fixos pela malha flexível.

## Próximos Lotes

### DS-1B — Token Infrastructure
*Criação e ligação das variáveis CSS.*
- **Objetivo**: Transpor o contrato semântico (DS-1A) para a infraestrutura real de código do Tailwind v4 (`globals.css`) e habilitar os toggle de temas (next-themes).
- **Critério de Entrada**: DS-1A aprovado (audit e contrato).
- **Critério de Saída**: Temas `light`, `dark` e `studio` podem ser ativados livremente, e a alteração aplica as novas cores base na UI.
- **Branch Sugerida**: `feat/design-system-tokens-ds1b`
- **Dependências**: Aprovação do contrato (este documento).

### DS-1C — Primitives & Components Adoption
*Substituição das classes utilitárias no nível dos componentes UI.*
- **Objetivo**: Atualizar os componentes da pasta `components/ui/` e os componentes globais (ex: PageHeader, StatusBadge) para consumirem explicitamente as classes semânticas.
- **Critério de Entrada**: Infraestrutura de tokens (DS-1B) instalada e funcional.
- **Critério de Saída**: Componentes base operam com as novas variáveis; classes Tailwind hardcoded incompatíveis (como os paddings ou margens arbitrárias descobertas no DS-1A) substituídas.
- **Branch Sugerida**: `feat/design-system-primitives-ds1c`
- **Dependências**: DS-1B.

### DS-1D — Human Visual Validation & Polish (Piloto)
*Ajuste sensorial e decisões humanas.*
- **Objetivo**: Refinar radius, font-families finais, intensidades de sombra (glow e glass do Studio). Realizado focado inicialmente no Dashboard (Piloto).
- **Critério de Entrada**: Primitivas já consumindo os tokens dinamicamente (DS-1C).
- **Critério de Saída**: Resolvidas as decisões humanas apontadas no DS-1A (tipografia, radius, intensidades). 
- **Branch Sugerida**: `feat/design-system-polish-ds1d`
- **Dependências**: DS-1C.

### DS-1E — Global Rollout (Adoção Progressiva)
*Aplicar as diretrizes visualmente testadas em todos os Hubs.*
- **Objetivo**: Garantir que as visões de lista (Projetos, Produções, Imagens, Vídeos, Conteúdos e Galeria) não tenham sofrido regressão semântica (contraste e responsividade) sob a nova infraestrutura.
- **Critério de Entrada**: Validação visual do piloto (DS-1D).
- **Critério de Saída**: Ausência de regressões em relação ao post-UX-H4; todas as superfícies respondem aos temas sem overrides incorretos.
- **Branch Sugerida**: `feat/design-system-rollout-ds1e`
- **Dependências**: DS-1D.

## Estratégia de Migração (Como evitar regressões)

1. **Evitar Big Bang**: A migração de variáveis em globals.css deve tentar mapear os defaults do shadcn sempre que possível (aliasing), não sobreescrevendo todas as invocações `.bg-xxx`.
2. **Substituição controlada de classes**: Os valores tipográficos encontrados como `text-[10px]` e `text-[0.68rem]` devem ser corrigidos localmente usando a classe definida em vez de substituir cegamente com RegEx.
3. **Preservar estados semânticos**: Cuidado com o mapeamento de falhas (`danger`) para não confundir com botões secundários caso os tons no modo Studio colidam visualmente.

## Riscos
- **Regressão de Contraste:** A introdução do tema Studio, com suas atmosferas, pode acidentalmente diminuir legibilidade de cards de metadados críticos.
- **Regressões Responsivas:** Durante as limpezas de classes para unificar gaps, podemos perder configurações de flex-wrap, prejudicando os cenários testados no UX-H4.
