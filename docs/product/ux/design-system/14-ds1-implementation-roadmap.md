# DS-1 Implementation Roadmap

## Escopo geral
O DS-1 formaliza a infraestrutura tecnica dos temas aprovados sem quebrar as fundacoes do UX-H4.
O roadmap precisa separar com clareza:
- infraestrutura tecnica
- decisoes visuais humanas
- adocao de primitivas
- tema Studio
- rollout transversal

## Proximos lotes

### DS-1B - Token Infrastructure
*Criacao e ligacao das variaveis CSS.*
- **Objetivo**: transpor foundations e semantic tokens para `app/globals.css`, sem ainda migrar a massa de componentes
- **Criterio de entrada**: DS-1A aprovado
- **Criterio de saida**: aliases semanticos existem em codigo; compatibilidade shadcn continua intacta; ainda sem exigir Studio completo nem rollout global
- **Branch sugerida**: `feat/design-system-tokens-ds1b`
- **Dependencias**: aprovacao do contrato

### DS-1C - Light and Dark Baseline
*Fechar os dois temas que ja existem tecnicamente.*
- **Objetivo**: consolidar `light` e `dark` sobre a nova camada semantica e resolver a ativacao consistente de tema
- **Criterio de entrada**: DS-1B concluido
- **Criterio de saida**: `light` e `dark` aplicam os mesmos papeis semanticos com o mesmo DOM; shell, cards base, dialogs e estados criticos respondem corretamente
- **Branch sugerida**: `feat/design-system-light-dark-ds1c`
- **Dependencias**: DS-1B

### DS-1D - Studio Theme Mapping
*Introduzir o terceiro tema sem mudar componentes.*
- **Objetivo**: mapear `studio` sobre a mesma semantica de `light/dark`, validando contraste, translucidez, glow e brand accent sem alterar anatomia
- **Criterio de entrada**: DS-1C concluido
- **Criterio de saida**: Studio existe tecnicamente e compartilha os mesmos papeis e estrutura; glass e glow permanecem restritos
- **Branch sugerida**: `feat/design-system-studio-ds1d`
- **Dependencias**: DS-1C

### DS-1E - States, Indicators and Controls
*Atacar as primitivas pequenas que hoje carregam semantica local.*
- **Objetivo**: migrar `StatusBadge`, `StateMessage`, tabs, toggles, badges, chips e indicadores para a nova semantica
- **Criterio de entrada**: DS-1C e DS-1D estabilizados
- **Criterio de saida**: controles e indicadores compartilham tokens coerentes nos tres temas, com contraste e acessibilidade preservados
- **Branch sugerida**: `feat/design-system-controls-ds1e`
- **Dependencias**: DS-1D

### DS-1F - Card Anatomies Pilot
*Piloto em superficies representativas antes do rollout amplo.*
- **Objetivo**: formalizar anatomias visuais de cards e paines recorrentes em uma rota piloto segura, preferencialmente `/projetos`
- **Criterio de entrada**: DS-1E concluido
- **Criterio de saida**: `ProjectCard`, paines estruturais e metadata principal validam spacing, radius, elevacao e CTA sem reabrir contratos do UX-H4
- **Branch sugerida**: `feat/design-system-card-pilot-ds1f`
- **Dependencias**: DS-1E

### DS-1G - Shared Primitives Adoption
*Substituicao controlada em primitivas e estruturas comprovadas.*
- **Objetivo**: atualizar `components/ui/*` e estruturas compartilhadas como `PageHeader` e `ContextMetadata` para consumirem explicitamente os tokens aprovados
- **Criterio de entrada**: DS-1F concluido
- **Criterio de saida**: primitivas comprovadas operam com a nova camada semantica; excecoes restantes ficam rastreaveis
- **Branch sugerida**: `feat/design-system-primitives-ds1g`
- **Dependencias**: DS-1F

### DS-1H - Progressive Rollout and QA
*Aplicar as diretrizes visualmente testadas em todas as superficies.*
- **Objetivo**: garantir que Projetos, Producoes, Imagens, Videos, Conteudos, Galeria, Arquivos e Configuracoes nao sofram regressao semantica, responsiva ou de acessibilidade
- **Criterio de entrada**: DS-1G concluido
- **Criterio de saida**: ausencia de regressao em relacao ao pos-UX-H4; overrides restantes documentados e reduzidos
- **Branch sugerida**: `feat/design-system-rollout-ds1h`
- **Dependencias**: DS-1G

## Estrategia de migracao
1. **Evitar Big Bang**: DS-1B nao deve tentar resolver tema Studio, componentes compartilhados, rollout global e QA transversal de uma vez
2. **Compatibilidade primeiro**: mapear aliases sobre os defaults do shadcn antes de reescrever superficies inteiras
3. **Substituicao controlada de classes**: tipografia arbitraria, translucidez recorrente e brand accents devem ser migrados por familia de componente, nao por busca-cega
4. **Separar decisao humana de decisao tecnica**: radius, glow, intensidade do Studio e densidade base nao devem ser misturados com rollout global
5. **Preservar estados semanticos**: cuidado com a diferenciacao entre falha, selecao, CTA e callout, especialmente no Studio

## Riscos
- **Regressao de contraste:** Studio, glow e translucidez podem diminuir legibilidade de cards e estados criticos
- **Regressoes responsivas:** limpar gaps, widths e max-widths pode quebrar wraps e stacks aprovados no UX-H4
- **Escopo grande demais:** juntar infraestrutura, ativacao de temas, primitivas, cards e rollout global no mesmo lote dificulta diagnostico de regressao
