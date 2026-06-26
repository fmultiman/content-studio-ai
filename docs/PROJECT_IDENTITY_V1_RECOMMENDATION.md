# Project Identity — Recomendação V1 Mínima

**Data:** 2026-06-25
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
* **V1:** Separação do `style_profile` atual em `visual_identity` (direção estética) e `voice_and_tone` (como escreve). Ambos opcionais.
* **Consumidores:** Image Generator, Feed Generator.

### 1.4 Governance
* **Dimensão:** Restrições base
* **Campo atual:** Ausente (misturado como negativas no `style_profile`)
* **V1:** Nova dimensão `restrictions` (Bullet points ou array, Locked, Universal).
* **Consumidores:** Usado como prompts negativos rígidos e regras de corte no Image Evaluator.

### 1.5 Practice
* **Dimensão:** Preferências Operacionais
* **Campo atual:** `evaluation_mode` (representa a régua de qualidade de geração)
* **V1:** Mantém o `evaluation_mode` atual no Projeto (Default).

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

## 3. Detalhamento da Opção Recomendada (Opção B)

A estrutura mínima sugerida do campo `identity` será:
```json
{
  "foundation": {
    "purpose": "texto livre"
  },
  "relationship": {
    "audience": "texto livre"
  },
  "expression": {
    "voice": "texto livre",
    "visual_direction": "texto livre"
  },
  "governance": {
    "restrictions": ["array de strings"]
  }
}
```

### Relação com Context e Style Profile Legados
Na migração, dados existentes em `context` alimentarão `foundation.purpose`, e os dados de `style_profile` alimentarão `expression.visual_direction`. Os campos antigos podem ser depreciados gradativamente.

### Relação com Production
A Production ganha, via UI (ou banco), o poder de armazenar em seu próprio escopo a sua **Intenção** e o **Override de Evaluation Mode**. As zonas `Locked` (ex: `restrictions` do projeto) nunca serão sobrescritas e são injetadas em toda execução atrelada a esse projeto.

### Itens Adiados para V2
* O `Identity Builder` (Chatbot Interativo de setup).
* O `Effective Context Compiler` avançado (que decide magicamente qual pedaço passar; na V1, passaremos as propriedades JSON de forma estruturada dentro do prompt de sistema unificado).
* Histórico e Versionamento de Identidade.
* Production Style Direction (a abstração completa da substituição visual restrita à campanha).
