# Project Identity — Recomendação V1 Mínima

**Data:** 2026-06-25  
**Revisado:** 2026-06-25 — decisões de produto finalizadas; shape aprovado com alterações  
**Objetivo:** Propor a implementação mínima, coerente com o modelo atual e com o `PROJECT_IDENTITY_FOUNDATION.md`.

---

## 1. Mapeamento das Cinco Zonas para a V1

Em vez de transformar as cinco zonas conceituais em 30 campos de banco de dados complexos, a V1 focará na essência operável pelo Prompt Generator e Image Evaluator atuais.

### 1.1 Foundation
* **Dimensão:** Essência / Propósito
* **Campo atual:** Parcialmente no `context`
* **V1:** Transformado num campo estruturado ou seção dentro do JSON de identidade: `purpose` (Texto livre, Opcional, Locked).
* **Consumidores:** Todos os geradores.

### 1.2 Relationship
* **Dimensão:** Audiência
* **Campo atual:** Ausente (misturado no `context`)
* **V1:** Nova dimensão `audience` (Texto livre conciso, Opcional, Adaptable na Production).
* **Consumidores:** Feed Generator, Image Evaluator.

### 1.3 Expression
* **Dimensão:** Linguagem Visual & Verbal
* **Campo atual:** `style_profile` (misturado)
* **V1:** `visual_identity` (identidade visual do Project — direção estética permanente) e `voice` (tom, registro, vocabulário). Ambos opcionais. **Nota:** `visual_direction` fica reservado para futura adaptação contextual na Production.
* **Consumidores:** Image Generator, Feed Generator.

### 1.4 Governance
* **Dimensão:** Princípios e restrições
* **Campo atual:** Ausente (misturado como negativas no `style_profile`)
* **V1:** `principles[]` (direções afirmativas — o que o project defende) e `restrictions[]` (negações locked — o que nunca pode aparecer). Funções diferentes; tratamento diferente no prompt dos agentes.
* **Consumidores:** Prompt Generator (contexto), Image Evaluator (restrições consideradas no score e `refinedPrompt`).

### 1.5 Practice
* **Dimensão:** Preferências operacionais de geração
* **Campo atual:** Parte misturada no `style_profile`
* **V1:** `generation_preferences[]` — preferências de execução (composição, atmosfera, estilo). Decomposto a partir do `style_profile` durante M11-F. `evaluation_mode` permanece separado — representa a régua de qualidade, não preferências de execução.

---

## 2. Opções de Implementação Avaliadas

### Opção A — Mínima (Sobrescrita do Campo Context)
Mantém o banco atual e altera apenas a interface. A UI exibe as dimensões e compila todas em um texto unificado que sobreescreve os campos `context` e `style_profile`.
* **Custo:** Muito baixo (Apenas UI).
* **Risco:** Perda de granularidade no futuro.
* **Benefício:** Rápido.

### Opção B — Equilibrada (Coluna JSONB Identity)
Adiciona uma nova coluna `identity` (JSONB) em `projects`, deixando os campos legados de transição intocados inicialmente. O JSONB carrega as zonas `foundation`, `relationship`, `expression` e `governance`.
* **Novos Campos:** `identity` (JSONB). O `evaluation_mode` fica intacto.
* **O que é texto livre:** Os valores dentro do JSON são textos livres descritivos (ex: `identity.audience`).
* **Vantagem:** Evita a criação de muitas colunas, prepara o terreno para esquemas dinâmicos no futuro sem quebrar dependências atuais.

### Opção C — Estruturada (Alteração massiva do Schema)
Criar colunas `purpose`, `audience`, `voice_tone`, `visual_identity`, `restrictions`.
* **Custo:** Alto. Requer migrations severas e refatoração nas tipagens do prisma/supabase e de todos os componentes de UI.
* **Risco:** Engessa as zonas conceitualmente, ferindo o princípio do enriquecimento progressivo.

### Recomendação Final
**Recomendamos a OPÇÃO B (Equilibrada - JSONB).** 
Ela permite evolução da estrutura sem alterações frequentes em banco, é 100% compatível com a visão de Identity Builder futura e mantém a retrocompatibilidade.

---

## 3. Detalhamento da Opção Recomendada (Opção B) — Shape Final Aprovado

**Decisão de produto finalizada (2026-06-25).**

```json
{
  "schema_version": 1,
  "foundation": {
    "purpose": "texto livre — por que este project existe"
  },
  "relationship": {
    "audience": "texto livre — público principal"
  },
  "expression": {
    "visual_identity": "texto livre — identidade visual permanente do Project",
    "voice": "texto livre — tom, registro, vocabulário"
  },
  "governance": {
    "principles": ["array — direções afirmativas"],
    "restrictions": ["array — o que nunca pode aparecer"]
  },
  "practice": {
    "generation_preferences": ["array — preferências de execução"]
  }
}
```

`schema_version` é obrigatório e fixo em `1`. Todos os demais campos são opcionais.

### Relação com Context e Style Profile

**`context` permanece.** Tem semântica própria como narrativa geral livre. Não é substituído por `foundation.purpose` — os dois coexistem e o formatter os inclui separadamente.

**`style_profile` será decomposto e removido.** Durante M11-F, o conteúdo do `style_profile` é manualmente reorganizado em:
- `expression.visual_identity` (direções positivas de execução)
- `governance.principles[]` (afirmações)
- `governance.restrictions[]` (negações)
- `practice.generation_preferences[]` (preferências operacionais)

Após validação (M11-F) e remoção dos consumidores (M11-G), a coluna é dropada em M11-H.

### Relação com Production

As zonas `restrictions[]` do Project são injetadas em toda execução — não são sobrescritas pela Production. O `evaluation_mode` override da Production é adiado para M12.

### Nota da Auditoria do Image Evaluator
Como o Image Evaluator consome o contexto de forma multimodal via OpenAI, o novo campo JSONB não deve ser repassado cru (`JSON.stringify`). O `Effective Context Compiler` da V1 deverá extrair os blocos relevantes (como `purpose`, `audience`, `visual_direction`, `restrictions`) e montar um bloco de texto formatado antes de enviar ao avaliador.

### Itens Adiados para V2
* O `Identity Builder` (Chatbot Interativo de setup).
* O `Effective Context Compiler` avançado (que decide magicamente qual pedaço passar; na V1, passaremos as propriedades JSON de forma estruturada textual dentro do prompt de sistema unificado).
* Histórico e Versionamento de Identidade.
* Production Style Direction (a abstração completa da substituição visual restrita à campanha).
