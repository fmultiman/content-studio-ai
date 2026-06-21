# Descoberta de Domínio — Publicações

**Status:** Rascunho de descoberta. Não implementar até revisão e aprovação explícita.  
**Data:** 2026-06-21  
**Escopo:** Incremento 5 — congelamento e mapeamento do domínio de publicação.

---

## 1. Motivação

A entidade `Post` existe no banco e na API, mas seu domínio não foi formalmente modelado. Perguntas como "o que é uma publicação?", "qual a diferença entre um post e uma distribuição?" e "como uma produção se relaciona com publicações?" não têm resposta clara no código atual. Este documento mapeia o domínio antes de qualquer expansão funcional.

---

## 2. Estado Atual da Entidade `Post`

A tabela `posts` no banco contém os seguintes campos relevantes:
- `id`, `user_id`, `project_id` — identidade e propriedade
- `production_id` (FK nullable, `ON DELETE SET NULL`) — vínculo com Produção
- `name` — título editorial
- `channel` — canal de destino (Instagram, LinkedIn, etc.)
- `description` — conteúdo editorial base
- `ai_context` — contexto para geração IA
- `feed_text` — texto gerado para feed
- `image_url`, `thumbnail_url` — mídias associadas
- `status` — estado do post (ex: draft, published)
- `storage_provider` — provedor de armazenamento de mídia

**Diagnóstico:** O `Post` atual é uma entidade híbrida. Ele mistura três responsabilidades distintas que deveriam ser separadas:  
(A) conteúdo editorial independente de canal,  
(B) peça específica para um canal,  
(C) evento de distribuição/publicação.

---

## 3. Decomposição do Domínio

### 3.1 Dimensão A — Conteúdo Editorial (`ContentDraft`)

**O quê:** O núcleo semântico da mensagem — o que o criador quer comunicar, independente de onde será publicado.

**Características:**
- Tem título, corpo, contexto de IA, mídias
- Não sabe para qual canal vai
- Pode existir sem estar vinculado a nenhuma Produção
- Relaciona-se com `image_drafts` e `video_drafts` como ativos de mídia
- Equivalente ao conceito de "artigo base" ou "brief de conteúdo"

**Entidade proposta:** `ContentDraft` (ou manter `Post` com papel redefinido)

---

### 3.2 Dimensão B — Peça de Canal (`ChannelPiece` / `PostVariant`)

**O quê:** A adaptação do conteúdo editorial para um canal específico — com linguagem, formato e limites de caracteres do canal.

**Características:**
- Referencia um `ContentDraft`
- Tem `channel` (Instagram, LinkedIn, X, TikTok, etc.)
- Tem `feed_text` adaptado para o canal
- Pode ter múltiplas variantes por conteúdo (mesmo conteúdo → Instagram + LinkedIn)
- Um `ContentDraft` pode gerar N `ChannelPiece`s

**Entidade proposta:** `PostVariant` ou `ChannelPiece`

---

### 3.3 Dimensão C — Distribuição (`Distribution`)

**O quê:** O ato e o registro de publicar uma peça em um canal em um momento específico.

**Características:**
- Referencia uma `ChannelPiece`
- Tem `scheduled_at`, `published_at`, `status` (scheduled/published/failed)
- Tem metadados do resultado (URL pública, external_id na plataforma)
- É imutável após publicação
- Um `ChannelPiece` pode ter múltiplas `Distribution`s (republicação, agendamento futuro)

**Entidade proposta:** `Distribution`

---

## 4. Relacionamento com a Entidade `Production`

Uma `Production` é um contêiner organizacional de ativos criativos (`image_drafts`, `video_drafts`, `posts`). O vínculo `production_id` em `Post` é um FK opcional — indica que o post nasceu dentro de um contexto de produção, mas pode existir independentemente.

**Questões abertas sobre esse relacionamento:**

| Questão | Resposta atual | Impacto de redesenho |
|---------|---------------|----------------------|
| Uma produção pode ter múltiplos posts para o mesmo canal? | Sim (sem restrição) | Clarificação de cardinalidade necessária |
| A produção define o canal ou o post define? | O post define | Manter |
| O estado da produção afeta o post? | Não (ON DELETE SET NULL) | Adequado — post sobrevive à produção |
| Deve haver um "post principal" por produção? | Não modelado | Decidir na fase de redesenho |
| A produção pode publicar diretamente ou precisa de posts? | Via posts | Manter separação |

---

## 5. Dez Cenários Mandatórios

### Cenário 1 — Criação de post sem produção
**Contexto:** Usuário abre `/posts` diretamente.  
**Fluxo atual:** Cria post com `production_id = null`.  
**Adequação:** Funciona. `project_id` mantém contexto organizacional.  
**Questão:** Sem produção, como agrupar múltiplos canais do mesmo conteúdo?

---

### Cenário 2 — Post criado dentro de uma Produção
**Contexto:** Usuário abre `/posts?production=<id>&project=<id>`.  
**Fluxo atual:** Post salvo com `production_id` definido; banner de contexto visível.  
**Adequação:** Funciona. `ON DELETE SET NULL` protege o post se a produção for excluída.  
**Questão:** O post herda o `project_id` da produção ou o define independentemente?

---

### Cenário 3 — Mesmo conteúdo, dois canais (Instagram + LinkedIn)
**Contexto:** Usuário quer publicar a mesma mensagem em dois canais com textos adaptados.  
**Fluxo atual:** Cria dois posts distintos, sem relação entre si.  
**Problema:** Não há conceito de "conteúdo base compartilhado" — redundância editorial.  
**Solução proposta (próxima evolução):** `ContentDraft` → 2 × `PostVariant`.

---

### Cenário 4 — Publicação agendada
**Contexto:** Usuário quer agendar um post para terça-feira 10h.  
**Fluxo atual:** Campo `status` existe, mas não há mecanismo de agendamento.  
**Problema:** A dimensão C (Distribuição) está ausente.  
**Solução proposta (futuro):** Entidade `Distribution` com `scheduled_at`.

---

### Cenário 5 — Republicação de um post
**Contexto:** Usuário quer publicar o mesmo post novamente (ex: repost semanal).  
**Fluxo atual:** Sem suporte — seria necessário duplicar o post.  
**Problema:** A imutabilidade de distribuições não está modelada.  
**Solução proposta (futuro):** Nova `Distribution` vinculada ao mesmo `ChannelPiece`.

---

### Cenário 6 — Post vinculado a image_draft
**Contexto:** Post usa uma imagem gerada no workspace de Imagens.  
**Fluxo atual:** `image_url` no post aponta para URL da imagem (sem FK direto ao `image_draft`).  
**Problema:** Não há rastreabilidade entre post e rascunho de imagem.  
**Solução proposta (próxima evolução):** FK `image_draft_id` opcional em `PostVariant`.

---

### Cenário 7 — Exclusão da Produção com posts vinculados
**Contexto:** Usuário exclui uma produção que tem posts associados.  
**Fluxo atual:** `ON DELETE SET NULL` — posts sobrevivem com `production_id = null`.  
**Adequação:** Correto. Posts são ativos independentes, não sub-recursos da produção.  
**Observação:** Posts ficam "soltos" — usuário pode não encontrá-los facilmente.

---

### Cenário 8 — Listagem de posts por canal
**Contexto:** Usuário quer ver todos os posts do Instagram.  
**Fluxo atual:** Filtro por `channel` na query GET `/api/posts`.  
**Adequação:** Funciona para o MVP.  
**Limitação:** Sem o modelo de `ChannelPiece`, não é possível agrupar variantes do mesmo conteúdo.

---

### Cenário 9 — IA gera feed_text a partir de description
**Contexto:** Usuário clica em "Gerar texto para feed".  
**Fluxo atual:** `POST /api/posts/generate-feed-text` processa `description` + `ai_context`.  
**Adequação:** Funciona para o MVP.  
**Questão:** O texto gerado pertence ao `ContentDraft` (reutilizável) ou ao `ChannelPiece` (canal-específico)?  
**Resposta:** Pertence ao `ChannelPiece` — cada canal tem seu próprio `feed_text`.

---

### Cenário 10 — Post na aba Publicações de uma Produção
**Contexto:** Usuário abre uma Produção e vê a aba "Publicações".  
**Fluxo atual:** Lista posts com `production_id = <id>`.  
**Adequação:** Funciona para o MVP.  
**Limitação:** Se o post for desvinculado da produção (unlink), desaparece da aba — mas ainda existe. Comportamento correto, mas deve ser comunicado ao usuário.

---

## 6. Avaliação de Nomenclatura

### O nome `Post` é adequado?

**Problema:** "Post" é ambíguo — pode significar o conteúdo editorial, a peça de canal, ou o ato de publicar.

**Avaliação:**
- Para o MVP atual: `Post` é aceitável como entidade unificada (simplificação intencional).
- Para evolução: o nome deve ser desambiguado.

**Recomendação:** Manter `Post` no MVP. Renomear para `ContentDraft` na próxima evolução, criando `PostVariant` como entidade separada.

---

### `PublicationDraft` é necessário?

No modelo atual, `Post` com `status = 'draft'` serve como rascunho de publicação. Uma entidade separada `PublicationDraft` só seria necessária se:
- O rascunho precisar ser separado do conteúdo final por questões de aprovação/workflow.
- Múltiplos colaboradores revisarem antes de publicar.

**Recomendação para MVP:** Não criar `PublicationDraft`. Usar `status` do `Post` para ciclo de vida.

---

### `Publication` como entidade separada

Uma `Publication` representaria o registro imutável de que um conteúdo foi publicado em um canal. É a Dimensão C deste documento.

**Recomendação para MVP:** Não criar. Usar `status = 'published'` + `published_at` no `Post`.  
**Recomendação para próxima evolução:** Criar como entidade separada quando agendamento e rastreamento de resultados forem necessários.

---

### `Distribution` vs `Publication`

`Distribution` é o conceito mais preciso — representa o ato de distribuir um conteúdo para um canal em um momento. `Publication` é o resultado desse ato.

**Recomendação:** Usar `Distribution` como nome de entidade na evolução futura, reservando `Publication` como conceito de negócio (não de código).

---

## 7. Modelo Progressivo

### Nível 1 — MVP Imediato (estado atual — congelado)

```
Post {
  id, user_id, project_id, production_id (FK nullable)
  name, channel, description, ai_context
  feed_text, image_url, thumbnail_url
  status, storage_provider
  created_at, updated_at
}
```

**Características:**
- Entidade única, sem decomposição
- Canal definido diretamente no post
- Status simples (draft/published)
- Vinculado opcionalmente a uma Produção

**Limitações conhecidas:**
- Não suporta múltiplos canais do mesmo conteúdo sem duplicar
- Não tem rastreabilidade de publicação
- Não suporta agendamento

**Decisão:** Manter congelado. Nenhuma nova funcionalidade deve ser adicionada até conclusão da revisão de domínio.

---

### Nível 2 — Próxima Evolução (não implementar agora)

```
ContentDraft {
  id, user_id, project_id, production_id (FK nullable)
  title, body, ai_context
  image_draft_id (FK nullable → image_drafts)
  video_draft_id (FK nullable → video_drafts)
  status (draft / ready / archived)
  created_at, updated_at
}

PostVariant {
  id, user_id, content_draft_id (FK → content_drafts)
  channel (instagram / linkedin / x / tiktok / ...)
  feed_text, image_url, thumbnail_url
  status (draft / approved / published)
  created_at, updated_at
}
```

**Mudanças requeridas:**
- Migração de `posts` para `content_drafts` + `post_variants`
- Atualização de API routes e UI
- Preservação de dados existentes

---

### Nível 3 — Futuro (não planejar agora)

```
Distribution {
  id, user_id, post_variant_id (FK → post_variants)
  scheduled_at, published_at
  status (scheduled / published / failed / cancelled)
  external_id (ID na plataforma de destino)
  external_url (URL pública do post publicado)
  error_message (nullable)
  created_at, updated_at
}
```

**Requer:**
- Integração com APIs de redes sociais
- Serviço de agendamento (cron ou queue)
- Webhooks de confirmação de publicação

---

## 8. Impacto no Código Atual

### Arquivos afetados pelo congelamento (não modificar):

| Arquivo | Motivo do congelamento |
|---------|----------------------|
| `app/api/posts/route.ts` | API de CRUD — domínio não definido |
| `app/api/posts/generate-feed-text/route.ts` | Geração de texto — depende da separação canal/conteúdo |
| `app/(dashboard)/posts/page.tsx` | UI — estrutura depende do modelo de dados |

### Arquivos com integração indireta (observar, não alterar):

| Arquivo | Tipo de integração |
|---------|-------------------|
| `app/(dashboard)/producao/[id]/page.tsx` | Aba "Publicações" lista posts por `production_id` |
| `app/api/productions/[id]/route.ts` | Pode retornar contagem de posts vinculados |

### Decisões que afetarão migração futura:

1. **`production_id` em `Post`** — manter como FK nullable com `ON DELETE SET NULL`. Decisão correta para todos os três níveis do modelo.
2. **`project_id` em `Post`** — manter. Mesmo no modelo de 3 níveis, `ContentDraft` terá `project_id`.
3. **`channel` como string livre** — aceitar por ora, mas definir enum quando o modelo de `PostVariant` for implementado.
4. **`status` como campo** — manter. O ciclo de vida do status mudará entre os níveis, mas o campo permanece.

---

## 9. Questões em Aberto para Decisão

Estas questões devem ser respondidas antes de avançar para o Nível 2:

1. **Quem decide o canal?** O criador de conteúdo (ao criar o `ContentDraft`) ou o distribuidor (ao criar o `PostVariant`)?
2. **Um `ContentDraft` pode existir sem nenhum `PostVariant`?** Sim (rascunho editorial). Isso muda a cardinalidade.
3. **A aba "Publicações" na Produção deve mostrar `ContentDraft`s ou `PostVariant`s?** Ambos, ou apenas o nível relevante para o workflow?
4. **Aprovação é necessária?** Se houver workflow de aprovação, `PublicationDraft` volta a ser necessário.
5. **Múltiplos autores?** Se houver colaboração, o modelo de propriedade (`user_id`) precisará de revisão.
6. **Integração com APIs externas é no escopo do produto?** A resposta define se o Nível 3 é MVP ou roadmap distante.

---

## 10. Decisão de Congelamento

**Não implementar nenhuma das evoluções acima sem:**
1. Responder às 6 questões da seção 9.
2. Definir qual nível (1, 2 ou 3) é o alvo da próxima iteração.
3. Escrever uma migração de dados para `posts` → `content_drafts` + `post_variants` (se necessário).
4. Revisar todos os arquivos listados na seção 8.
5. Obter aprovação explícita do responsável pelo produto.

**A integração atual (Nível 1) está funcional e preservada. Qualquer modificação deve começar por aqui.**
