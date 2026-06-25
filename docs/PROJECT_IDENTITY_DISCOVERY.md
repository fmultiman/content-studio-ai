# PROJECT_IDENTITY_DISCOVERY.md
**Discovery · Somente Leitura · 2026-06-24**

> Mapeamento dos campos de identidade que já existem no Projeto hoje,
> dos conceitos desejados para Project Identity, das lacunas entre os dois,
> e das perguntas de domínio que precisam de decisão antes de qualquer implementação.
> Nenhuma migration ou schema foi criado neste documento.

---

## 1. Campos Atuais do Projeto

### 1.1 Schema atual (`projects` table — migration 001 + 019)

| Campo | Tipo | Papel atual | Usado por IA? |
|-------|------|------------|--------------|
| `id` | UUID | PK | — |
| `user_id` | UUID | FK → auth.users | — |
| `name` | TEXT NOT NULL | Nome do projeto | Agente de feed text (nome) |
| `description` | TEXT | Descrição pública | Agente de feed text (description) |
| `context` | TEXT | Instrução base para IA | Prompt Generator + Image Evaluator + Feed Generator |
| `style_profile` | TEXT | Perfil estético (texto livre) | Prompt Generator (style_profile) |
| `evaluation_mode` | TEXT DEFAULT 'default' | Critério de qualidade | Image Evaluator + Prompt Generator |
| `status` | TEXT DEFAULT 'active' | active / archived | — |
| `created_at` | TIMESTAMPTZ | — | — |
| `updated_at` | TIMESTAMPTZ | — | — |

### 1.2 Como cada campo é usado pelos agentes

**`context`** — campo mais impactante:
- Inserido no system prompt do Prompt Generator como "project context"
- Inserido no system prompt do Image Evaluator
- Passado como `aiContext` ao Feed Generator
- Torna toda geração consciente do propósito do projeto

**`style_profile`** — campo estético:
- Inserido no system prompt do Prompt Generator após o context
- Define a linguagem visual sem estrutura formal
- Texto livre: pode ser tags, frases, ou parágrafos

**`evaluation_mode`** — critério de qualidade:
- Muda o comportamento tanto do Prompt Generator quanto do Image Evaluator
- Valores: `default | conceptual | aesthetic | commercial | experimental`
- É o único campo com enum controlado de identidade do projeto

**`description`** — campo público:
- Aparece na página do projeto como texto visível ao usuário
- Passado ao Feed Generator mas não ao Prompt Generator de imagem
- Papel duplica parcialmente o `context`

**`name`** — identificação:
- Passado ao Feed Generator como nome do projeto
- Usado na UI como título

### 1.3 Formulário atual de edição (`ProjectForm`)

O `ProjectForm` (`components/projects/project-form.tsx`) expõe:
- Campo `name` (text input)
- Campo `description` (textarea)
- Campo `context` (textarea — "Contexto para IA")
- Campo `style_profile` (TagInput — tags de texto livre)
- Campo `evaluation_mode` (select com 5 opções)
- Campo `status` (select: active/archived)

Não há campos de propósito, audiência, voz, restrições, ou contextos específicos por domínio.

---

## 2. Conceitos Desejados para Project Identity

A direção de produto indica que Project Identity poderá conter:

| Conceito | Descrição |
|----------|-----------|
| Essência | O que o projeto é em uma frase |
| Propósito | Por que o projeto existe (para quem, com que objetivo) |
| Público | Audiência principal e secundária |
| Voz e linguagem | Tom, registro, vocabulário, o que evitar |
| Princípios | Valores que guiam decisões editoriais |
| Temas | Assuntos recorrentes, território temático |
| Estética | Identidade visual (além do style_profile atual) |
| Restrições | O que nunca fazer — visual, editorial, linguagem |
| Contexto geral | Base para todos os agentes (atual: `context`) |
| Contexto de imagem | Instrução específica para geração visual |
| Contexto de vídeo | Instrução específica para storyboard e cenas |
| Contexto editorial | Instrução específica para copywriting |
| Style profile | Perfil estético (atual: `style_profile`) |

---

## 3. Matriz de Cobertura

| Conceito de Identidade | Campo atual | Cobertura | Problema |
|----------------------|-------------|-----------|---------|
| Essência | `name` + `description` | PARCIAL | `name` é só identificação; `description` mistura essência com descrição técnica |
| Propósito | `description` + `context` | PARCIAL | Nenhum campo é explicitamente sobre "por que existe" — está implícito no contexto |
| Público | — | AUSENTE | Não existe campo de audiência; o público deve ser derivado do contexto pelo usuário |
| Voz e linguagem | `context` (implícito) | PARCIAL | Pode estar descrito no `context` mas não é um campo estruturado separado |
| Princípios | `context` (implícito) | PARCIAL | Pode estar no `context` mas misturado com outras instruções |
| Temas | `context` (implícito) | PARCIAL | Pode estar no `context` mas sem estrutura |
| Estética (visual) | `style_profile` | PARCIAL | Existe mas é texto livre sem schema; pode ser tags ou parágrafos sem estrutura |
| Estética (componentes) | — | AUSENTE | Não há campo para paleta, referências visuais, exemplos, proibições específicas |
| Restrições | `context` (implícito) | PARCIAL | Podem estar no `context` mas sem campo dedicado |
| Contexto geral | `context` | TOTAL | Funciona bem como instrução base unificada |
| Contexto de imagem | `context` (geral) | PARCIAL | Não há separação entre contexto para imagem vs editorial vs vídeo |
| Contexto de vídeo | — | AUSENTE | Não há campo específico para contexto de storyboard e cenas |
| Contexto editorial | — | AUSENTE | Não há campo específico para copywriting |
| Style profile | `style_profile` | PARCIAL | Existe mas não tem schema estruturado |
| Evaluation mode | `evaluation_mode` | TOTAL | Bem definido com enum controlado |

---

## 4. Análise por Campo

### 4.1 `context` — campo sobrecarregado

O `context` está fazendo o trabalho de vários campos distintos. No projeto "Alquimia Cibernética"
o contexto contém:
- Descrição do que é o projeto (essência)
- Abordagem técnica estruturada (princípios)
- Intenção visual para IA (contexto de imagem)
- Eixos editoriais (temas)

Tudo em um único campo de texto livre. Isso funciona para um usuário experiente mas:
- Torna difícil para a IA priorizar as informações
- Não permite que diferentes agentes recebam apenas o que lhes é relevante
- Não tem estrutura para guiar novos usuários

**Decisão futura necessária:** Separar `context` em contextos específicos por domínio, ou
mantê-lo unificado com anotações de seção (ex: `[IMAGEM]`, `[EDITORIAL]`)?

### 4.2 `style_profile` — campo estético sem schema

O `style_profile` é implementado como `TagInput` (array de strings separado por vírgula
ou Enter). No projeto "Alquimia Cibernética" contém:
```
iluminação dramática, alto contraste, estética cinematográfica, atmosfera densa,
visual simbólico, fusão entre tecnologia e espiritualidade, elementos abstratos
e conceituais, evitar aparência genérica, evitar estilo clean ou corporativo,
composição forte e centralizada, sensação de mistério e profundidade
```

É uma lista de adjetivos/direções misturando positivos e negativos, estilos e proibições.

**Problema:** O Prompt Generator recebe esse texto como blob e não consegue distinguir
"o que promover" de "o que evitar". A separação aumentaria a qualidade da geração.

**Decisão futura necessária:** Estruturar `style_profile` em subcampos
(`{ positives: string[], negatives: string[], palette?: string[], references?: string[] }`)
ou mantê-lo como texto livre enriquecido?

### 4.3 `description` vs `context` — sobreposição

Ambos os campos descrevem o projeto. A diferença intencional:
- `description` = texto público para humanos
- `context` = instrução para IA

Na prática o usuário tende a escrever textos similares nos dois campos.
A UI exibe `description` na página do projeto e envia `context` para os agentes.

**Decisão futura necessária:** Manter a separação atual (description para leitura,
context para IA) ou unificar com flags de visibilidade?

### 4.4 Ausências críticas

Os três campos ausentes com maior impacto na qualidade da geração:

**Audiência (`audience`):**
Saber para quem é o conteúdo mudaria substancialmente as saídas do Feed Generator
e do Prompt Generator. "Jovens adultos interessados em espiritualidade e tecnologia"
produz resultados muito diferentes de "pesquisadores e acadêmicos de humanidades".

**Contexto de imagem vs editorial:**
Um projeto pode querer imagens com "atmosfera sombria e minimalista" mas textos com
"linguagem acessível e direta". Hoje o mesmo `context` guia ambos, o que cria conflito.

**Restrições explícitas:**
"Nunca usar linguagem de auto-ajuda", "nunca mostrar pessoas", "não mencionar concorrentes".
Essas restrições hoje vivem dentro do `context` e podem ser ignoradas pelos agentes
quando o `context` é muito longo.

---

## 5. Perguntas de Domínio

Estas perguntas precisam de resposta antes de qualquer implementação de Project Identity:

### 5.1 Sobre a estrutura dos campos

**Q1:** `context` deve ser fragmentado por domínio (image_context, video_context,
editorial_context) ou mantido unificado com seções marcadas?
- *Unificado:* mais simples para o usuário escrever, mas agentes recebem ruído
- *Fragmentado:* mais preciso, mas exige que o usuário preencha mais campos

**Q2:** `style_profile` deve virar estruturado (positivos/negativos/paleta/referências)?
- *Estruturado:* mais poderoso para os agentes, melhor UX com hints por campo
- *Texto livre:* mais natural para o usuário, menos atrito no início

**Q3:** `description` deve ser mantido separado de `context`?
- *Separado:* distinção clara (humano vs IA)
- *Unificado:* menos campos, menor carga cognitiva

### 5.2 Sobre o escopo de Project Identity

**Q4:** Project Identity é apenas context/style (o que já existe), ou inclui campos
de negócio como audiência, propósito, princípios?
- *Contexto técnico:* melhorar o que existe para servir melhor a IA
- *Identidade de marca:* expandir para cobrir toda a camada estratégica do projeto

**Q5:** `evaluation_mode` deve permanecer no Projeto ou migrar para a Production?
- *No Projeto:* estilo de avaliação é identidade permanente do projeto
- *Na Production:* diferentes campanhas podem ter critérios diferentes

**Q6:** Project Identity é preenchido pelo usuário ou sugerido por um agente?
- *Manual:* usuário define tudo, maior controle
- *Assistido:* agente "Identidade de Projeto" sugere baseado em exemplos e propósito

### 5.3 Sobre a UX

**Q7:** Como guiar um novo usuário no preenchimento de Project Identity?
- Campo com placeholder: "Descreva o público-alvo do seu projeto..."
- Template estruturado: campos pré-nomeados com hints
- Wizard: fluxo guiado de criação de identidade

**Q8:** A identidade deve ser visível como documentação (leitura fácil) ou como
formulário (edição fácil)?
- Hoje o card do Projeto é documentação com botão Editar
- Um campo extenso como `identity` poderia exigir um modo de edição dedicado

---

## 6. Proposta Inicial de Próximos Passos

### Etapa 1 (sem schema change) — Estruturar o que existe

Sem alterar nenhuma tabela, é possível:
1. Adicionar **hints/placeholders** nos campos existentes para guiar o usuário
2. Separar visualmente `context` em seções sugeridas dentro do mesmo campo
3. Estruturar `style_profile` na UI (subcampos com TagInput separados) salvo como
   objeto JSON na coluna existente (sem ALTER TABLE)

Esta etapa é reversível e de baixo risco.

### Etapa 2 (migration mínima) — Adicionar campos críticos

Se as perguntas de domínio forem respondidas, a migration mínima seria:

```sql
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS audience TEXT,          -- público-alvo
  ADD COLUMN IF NOT EXISTS restrictions TEXT,      -- o que nunca fazer
  ADD COLUMN IF NOT EXISTS image_context TEXT,     -- contexto específico para imagens
  ADD COLUMN IF NOT EXISTS editorial_context TEXT; -- contexto específico para copywriting
```

Todos nullable. Sem breaking change. Agentes passam a receber os campos específicos
quando disponíveis, fazendo fallback para `context` quando não.

### Etapa 3 (experiência Project Identity) — Nova seção na página

Criar uma seção de "Identidade do Projeto" com sub-cards por dimensão,
editável inline ou via modal dedicado. Não substitui os campos atuais —
os adiciona como expansão.

---

## 7. Observações sobre o Projeto Existente como Referência

O projeto **"Alquimia Cibernética"** (criado em abr/2026) demonstra como um usuário
avançado usa o sistema atual:

- `context`: 450+ palavras, estrutura própria com seções (ABORDAGEM, INTENÇÃO VISUAL),
  mistura de propósito, princípios e instruções visuais
- `style_profile`: 12+ tags cobrindo iluminação, atmosfera, composição e restrições

Isso mostra que o campo `context` **já absorve tudo** — o usuário avançado criou
sua própria estrutura dentro do campo livre. Project Identity formalizaria essa
estrutura implícita em campos explícitos.

O risco: tornar a estrutura obrigatória pode aumentar o atrito. A solução é torná-la
disponível mas não obrigatória — campos adicionais enriquecem o que já existe.
