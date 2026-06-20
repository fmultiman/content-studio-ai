# Content Agent Studio — Base de Conhecimento Arquitetural

Esta pasta contém a documentação conceitual e arquitetural do Content Agent Studio,
produzida durante as sessões de análise da Fase 2.

Os documentos aqui não descrevem implementação. Descrevem o **entendimento do
sistema** — o que ele é, como funciona, o que deve se tornar.

---

## Ordem recomendada de leitura

### 1. [ARCHITECTURE.md](./ARCHITECTURE.md)
**Reconstrução da arquitetura atual**

Leia primeiro. Mapeia o estado real do sistema comprovado pelo código:
stack tecnológica, entidades existentes, API routes, fluxos implementados,
agentes implícitos, artefatos persistentes, pontos fortes e pontos de atenção.

É a fonte de verdade sobre o que existe hoje.

---

### 2. [DOMAIN_EVOLUTION.md](./DOMAIN_EVOLUTION.md)
**Evolução do domínio e descoberta das entidades**

Leia segundo. Responde às perguntas estratégicas da Fase 2:
qual é a entidade central real, quais entidades atuais são apenas implementação,
como os agentes evoluem, como o pipeline emerge naturalmente, e qual é o
roadmap conceitual (Fases A, B, C, D).

Identifica a entidade ausente entre `Project` e os workspaces especializados
e propõe o modelo de domínio evoluído com a entidade `Production`.

---

### 3. [PRODUCTION_LIFECYCLE.md](./PRODUCTION_LIFECYCLE.md)
**Comportamento da entidade Production**

Leia terceiro. Modela o ciclo de vida completo da entidade `Production`:
como nasce, quais informações mínimas precisa, como seus estados evoluem,
quais artefatos contém, como os agentes colaboram dentro ela, como se
relaciona com o Projeto, se pode gerar Produções derivadas, e como o modelo
se valida em diferentes domínios (editorial, branding, pesquisa, automações, etc.).

---

### 4. [PRODUCTION_DECISIONS.md](./PRODUCTION_DECISIONS.md)
**Decisões arquiteturais antes da implementação**

Leia antes de qualquer implementação da entidade `Production`. Responde a 7
perguntas arquiteturais que, sem resposta, forçariam retrabalho durante o
desenvolvimento:

- D1: Qual agente inicia universalmente toda Produção
- D2: Qual é a precedência de contexto entre Projeto, Produção e artefato
- D3: Quais status são derivados de artefatos e quais requerem evento explícito
- D4: Como o sistema lida com Produções criadas sem Projeto selecionado
- D5: Como o sistema de tipos funciona (enum + capabilities map)
- D6: Critérios para distinguir Produção derivada de artefato da mesma Produção
- D7: O que IA pode aprovar autonomamente vs. o que sempre requer decisão humana

Inclui invariantes do domínio e o papel futuro do Production Architect (Fase C).

---

### 5. [PRODUCTION_IMPLEMENTATION_PLAN.md](./PRODUCTION_IMPLEMENTATION_PLAN.md)
**Plano incremental de implementação**

Leia antes de escrever qualquer código para a entidade `Production`. Contém:

- Estado confirmado do código atual (schema real, padrões de FK e RLS, como o
  projeto é mantido na UI, quais colunas são nullable)
- Escopo exato do MVP (o menor incremento utilizável por um usuário real)
- Campos da primeira versão e o que foi explicitamente adiado
- Relações com entidades existentes e estratégia de backfill (nenhum)
- Vertical slice completo com 13 passos de teste
- 5 incrementos independentes com critérios de aceite e rollback individuais
- 4 decisões que ainda exigem confirmação humana antes de implementar

---

## Relação entre os documentos

```
ARCHITECTURE.md                →  "o que existe hoje"
     ↓
DOMAIN_EVOLUTION.md            →  "o que deve existir e por quê"
     ↓
PRODUCTION_LIFECYCLE.md        →  "como a nova entidade se comporta"
     ↓
PRODUCTION_DECISIONS.md        →  "o que decidir antes de implementar"
     ↓
PRODUCTION_IMPLEMENTATION_PLAN →  "como implementar, em que ordem, com que critérios"
```

---

## Decisões de linguagem de domínio

Durante a análise, foram avaliados os seguintes candidatos para a entidade
intermediária entre `Project` e os workspaces especializados:

`Pauta`, `Tema`, `Produção`, `Brief`, `Creative Brief`, `Job`, `Session`,
`Work Item`, `Assignment`, `Criação`

**Decisão:** `Production` (Produção) foi escolhido por ser o único candidato que:
- Funciona para todos os domínios propostos (editorial, branding, pesquisa, IA, automações)
- Não pertence a nenhum nicho específico
- Tem ciclo de vida implícito ("em produção" → "concluída")
- Produz código limpo (`production_id`, `/api/productions`, tabela `productions`)

---

## Recomendações de reorganização futura

À medida que a Fase 2 avança, estes documentos podem precisar ser divididos:

- **ARCHITECTURE.md** pode ser dividido em `ARCHITECTURE_CURRENT.md` (estado do código)
  e `ARCHITECTURE_DECISIONS.md` (decisões técnicas e por quê foram tomadas)

- **DOMAIN_EVOLUTION.md** pode gerar um `ROADMAP.md` separado focado apenas nas
  Fases A, B, C, D com critérios de entrada e saída de cada fase

- **PRODUCTION_LIFECYCLE.md** pode gerar um `AGENT_CATALOG.md` separado descrevendo
  cada agente, seus inputs, outputs e em quais tipos de Produção aparecem

Por enquanto, a estrutura atual (três documentos, leitura sequencial) é suficiente
para a base de conhecimento da Fase 2.

---

## Questões em aberto consolidadas

**Respondidas em PRODUCTION_DECISIONS.md (prontas para implementação da Fase B):**
- ~~O `evaluation_mode` da Produção sobrescreve o do Projeto ou o herda?~~ → D2
- ~~O tipo da Produção é um enum fechado ou extensível?~~ → D5
- ~~Uma Produção pode existir sem Projeto?~~ → D4
- ~~A fronteira entre "artefato" e "Produção derivada"~~ → D6
- ~~Quem é o agente universal de início?~~ → D1
- ~~O que IA pode aprovar vs. o que requer humano?~~ → D7

**Respondidas em PRODUCTION_IMPLEMENTATION_PLAN.md (prontas para o Incremento B):**
- ~~Schema mínimo da tabela `productions`~~ → Seção 3
- ~~Relações com entidades existentes~~ → Seção 4
- ~~O que fazer com dados existentes~~ → Seção 8 (nenhum backfill)
- ~~Sequência de incrementos~~ → Seção 6

**Pendentes — exigem confirmação humana antes de implementar (D.H. no plano):**
- D.H.1: Rota `/projetos/[id]/producoes/[id]` ou `/producoes/[id]`?
- D.H.2: Título obrigatório separado ou gerado da intenção?
- D.H.3: AlertDialog de delete do Projeto deve mostrar contagem de Produções?
- D.H.4: 1, 3 ou 7 tipos visíveis na UI do MVP?

**Pendentes para a Fase C (agentes editoriais):**
- A interface de aprovação do `production_brief`: Planejador roda automaticamente
  ou aguarda confirmação do usuário?
- Como `style_profile` de Projeto e Produção interagem — adição ou override?

**Pendentes para a Fase D (pipeline como produto):**
- Como representar redes de Produções derivadas na UI sem criar complexidade?
- Produções derivadas herdam `evaluation_mode` da fonte ou do Projeto?
- UI de migração de Produções entre Projetos.

**Pendentes para versões multi-usuário (futuro):**
- Quem tem autoridade para aprovação de entrega em equipes?
- Como `approved_by` se comporta com múltiplos aprovadores?
