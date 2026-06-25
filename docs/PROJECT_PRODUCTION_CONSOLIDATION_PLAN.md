# PROJECT_PRODUCTION_CONSOLIDATION_PLAN.md
**Planejamento · 2026-06-24**  
**M10-A concluído · 2026-06-25**  
**M10-B concluído · 2026-06-25**

> Proposta de consolidação do Projeto como contexto e das Productions como
> único caminho operacional. Este documento define o que remover, o que migrar,
> as fases, a validação e o rollback. Nenhuma implementação foi realizada aqui.

---

## 1. Objetivo

Transformar a página do Projeto de um workspace paralelo (com abas operacionais
de Imagens e Vídeos) em uma página de identidade e contexto que direciona o
usuário para Productions como único caminho de trabalho.

**De:**
```
Projeto
├── aba Imagens (lista + criação direta)
├── aba Vídeos (lista + criação direta)
└── aba Produções
```

**Para:**
```
Projeto
├── Identidade e Contexto (campos existentes + futuros)
└── Produções (único caminho operacional)
     ├── Imagens (dentro da Production)
     ├── Vídeos (dentro da Production)
     └── Conteúdos Editoriais
```

---

## 2. Proposta da Nova Página do Projeto

### 2.1 Layout proposto

```
┌─ PROJETO: "Alquimia Cibernética" ────────────────────────────────┐
│  Criado em 24 abr. 2026  │  Ativo                  [Editar] [⋮] │
├───────────────────────────────────────────────────────────────────┤
│  Descrição       Contexto para IA        Perfil de Estilo        │
│  [texto]         [caixa copiável]        [caixa copiável]        │
├───────────────────────────────────────────────────────────────────┤
│  PRODUÇÕES                                    [+ Nova Produção]  │
│  ─────────────────────────────────────────────────────────────── │
│  Teste publicação 01  │  Editorial  │  5 conteúdos  │  jun 23   │
│  [card clicável]                                                  │
│  ─────────────────────────────────────────────────────────────── │
│  MÉTRICAS DE ARQUIVO (opcional, colapsável)                      │
│  7 imagens  │  4 vídeos  │  3 sem Production                     │
└───────────────────────────────────────────────────────────────────┘
```

### 2.2 Itens a remover da página principal

| Item | Localização atual | Ação |
|------|-----------------|------|
| Aba "Imagens" | `TabsTrigger value="images"` | Remover |
| Aba "Vídeos" | `TabsTrigger value="videos"` | Remover |
| `TabsContent value="images"` | Listagem de image_drafts | Remover |
| `TabsContent value="videos"` | Listagem de video_drafts | Remover |
| Botão "Criar Imagem" | Estado vazio da aba Imagens | Remover |
| Botão "Criar Vídeo" | Estado vazio da aba Vídeos | Remover |
| Query `image_drafts by project_id` | `useEffect` na linha ~108 | Remover |
| Query `video_drafts by project_id` | `useEffect` na linha ~113 | Remover |
| State `images`, `videos` | `useState` inicial | Remover |

### 2.3 Itens a manter

| Item | Razão |
|------|-------|
| Card de identidade do projeto | Permanece como contexto |
| Campos description, context, style_profile | Identidade do projeto |
| Botões Editar / Excluir do projeto | Gestão do projeto |
| Aba Produções (ou lista direta) | Único caminho operacional |
| Botão "Nova Produção" | Criação no contexto correto |
| Cards de Production com título, tipo, intention | Navegação |

### 2.4 Métricas que permanecem (como informação, não workspace)

| Métrica | Como exibir |
|---------|------------|
| Número de Productions | Contagem na lista / header |
| Conteúdos editoriais agregados | Card de métricas colapsável |
| Imagens sem Production (aviso de arquivo) | Seção de aviso dismissível |
| Vídeos sem Production (aviso de arquivo) | Seção de aviso dismissível |

A agregação permanece como **informação de contexto**, não como workspace concorrente.

---

## 3. Atribuição de Registros sem Production

### 3.1 Classificação de cada registro

#### ImageDrafts sem Production (Projeto: Alquimia Cibernética)

| id (prefixo) | user_input | tem imagem | Classificação | Ação proposta |
|-------------|-----------|-----------|--------------|--------------|
| `d52b83b6` | "uma montanha antiga" | ❌ | REGISTRO DE TESTE | Pode ser deletado após aprovação do usuário |
| `8c5bbdb7` | "consciência e tecnologia..." | ❌ | REGISTRO DE TESTE | Pode ser deletado após aprovação do usuário |
| `c44bf448` | "Um símbolo mágico" | ✅ | CRIAR PRODUCTION DE ARQUIVO | Atribuir a Production "Arquivo Alquimia Cibernética" |
| `97508404` | "Uma floresta vista do alto..." | ✅ | CRIAR PRODUCTION DE ARQUIVO | Atribuir a Production "Arquivo Alquimia Cibernética" |
| `e624d457` | "Criar um objeto mágico" | ✅ | CRIAR PRODUCTION DE ARQUIVO | Atribuir a Production "Arquivo Alquimia Cibernética" |
| `0eb2a983` | "Uma imagem sobre Alquimia Cibernética" | ✅ | CRIAR PRODUCTION DE ARQUIVO | Atribuir a Production "Arquivo Alquimia Cibernética" |

**Risco de atribuição:** Baixo. São registros antigos sem produção ativa. A atribuição é apenas um PATCH em `production_id`.

#### VideoDrafts sem Production (Projeto: Alquimia Cibernética)

| id (prefixo) | name | num_scenes | Classificação | Ação proposta |
|-------------|------|-----------|--------------|--------------|
| `f1029001` | "aluimia01" | 2 | CRIAR PRODUCTION DE ARQUIVO | Atribuir a Production "Arquivo Alquimia Cibernética" |
| `d46d2259` | "teste3" | 2 | CRIAR PRODUCTION DE ARQUIVO | Atribuir a Production "Arquivo Alquimia Cibernética" |
| `0bc4324c` | "testevideo" | 1 | REGISTRO DE TESTE | Pode ser deletado após aprovação do usuário |

#### EditorialContents sem Production (Projeto: Content Agent)

| id (prefixo) | title | channel_pieces | Classificação | Ação proposta |
|-------------|-------|--------------|--------------|--------------|
| `6d7d1a9a` | "Post no Youtube" | 0 | REGISTRO DE TESTE | Pode ser deletado após aprovação |
| `cb996953` | "Novo Conteúdo" | 0 | REGISTRO DE TESTE | Pode ser deletado após aprovação |

#### Productions vazias

| id (prefixo) | title | Classificação | Ação proposta |
|-------------|-------|--------------|--------------|
| `c859d21f` | "teste" (Alquimia Cibernética) | REGISTRO DE TESTE | Pode ser deletado; ou usado como Production de Arquivo |

### 3.2 Proposta de Production de Arquivo

Para os registros com conteúdo real mas sem Production, a proposta é criar uma Production chamada
**"Arquivo — [Nome do Projeto]"** e atribuir esses registros via PATCH:

```
Production a criar:
  title: "Arquivo — Alquimia Cibernética"
  type: editorial
  intention: "Registros criados antes da implantação do fluxo de Productions."
  project_id: 0b04df8b (Alquimia Cibernética)

Registros a atribuir (PATCH production_id):
  image_drafts: c44bf448, 97508404, e624d457, 0eb2a983
  video_drafts: f1029001, d46d2259
```

**Ação:** É manual, controlada, reversível. Não exige migration ou schema change.

---

## 4. Fases de Implementação

### Fase M10-A — Migration de Arquivo ✅ CONCLUÍDA (2026-06-25)

Production **"Arquivo — Alquimia Cibernética"** criada e 6 drafts reais atribuídos.

```
✅ Production "Arquivo — Alquimia Cibernética" criada (id: 76120099)
✅ 4 ImageDrafts com imagem atribuídos (c44bf448, 97508404, e624d457, 0eb2a983)
✅ 2 VideoDrafts com cenas atribuídos (f1029001, d46d2259)
✅ 3 testes preservados com production_id=NULL (d52b83b6, 8c5bbdb7, 0bc4324c)
```

Manifesto: `docs/migrations/project-archive-m10a.json`  
Rollback disponível: `scripts/project_archive_production_m10a_rollback.mjs`

### Fase M10-B — Simplificação da Página do Projeto ✅ CONCLUÍDA (2026-06-25)

```
Arquivo modificado:
  app/(dashboard)/projetos/[id]/page.tsx

Mudanças realizadas:
  ✅ Removida estrutura completa de Tabs (TabsList, TabsTrigger, TabsContent)
  ✅ Removida aba Imagens (TabsContent + cards + botão Criar Imagem)
  ✅ Removida aba Vídeos (TabsContent + cards + botão Criar Vídeo)
  ✅ Removidas queries image_drafts e video_drafts do useEffect
  ✅ Removidos useState para images e videos
  ✅ Removidos imports: ImageIcon, Video, ImageDraft, VideoDraft, Tabs*
  ✅ Removido activeTab state
  ✅ Productions exposta como seção flat com header "Produções" + badge de contagem
  ✅ Botão "Nova Produção" sempre visível no header da seção
  ✅ Estado vazio: "Este projeto ainda não possui Produções."
  ✅ tabsSectionRef renomeado para productionsSectionRef
  ✅ "Ir para Produções" no block dialog renomeado para "Ver Produções"
```

**Resultado:** typecheck 0 erros / lint 50 warnings (era 51) / build pass.

### Fase M10-C — Reforço dos fluxos de criação (futuro)

Após confirmar que registros estão atribuídos a Productions:

```
Oportunidade futura:
  - Remover query parameter ?project= das pages /imagens e /videos
    (ou ignorar se production não for passado)
  - Tornar production_id obrigatório nas APIs image-drafts e video-drafts POST
  - Redirecionar usuário para selecionar Production antes de criar
```

Esta fase não deve ser implementada antes de confirmar que todos os registros
existentes estão atribuídos ou descartados.

---

## 5. Validação antes da Simplificação

### Checklist pré-implementação

```
[ ] Confirmar que todos os image_drafts com imagem têm production_id
[ ] Confirmar que todos os video_drafts com cenas têm production_id
[ ] Confirmar que Production page funciona corretamente (testes manuais)
[ ] Confirmar que /imagens?project=P&production=X cria com production_id
[ ] Confirmar que /videos?project=P&production=X cria com production_id
[ ] typecheck: 0 erros
[ ] lint: 0 erros / não aumentar warnings
[ ] build: aprovado
```

### Checklist pós-implementação (M10-B)

```
[ ] Página do Projeto carrega sem erros
[ ] Aba Produções lista corretamente
[ ] Clique na Production navega para /producoes/[id]
[ ] Nova Production abre modal e cria corretamente
[ ] Botões Editar e Excluir do Projeto funcionam
[ ] Nenhum acesso a image_drafts/video_drafts na página do Projeto
[ ] typecheck: 0 erros
[ ] lint: 0 erros / não aumentar warnings
[ ] build: aprovado
```

---

## 6. Rollback

### Estratégia de rollback

Como a simplificação é uma remoção de código (não uma migração de banco), o rollback é:

```bash
# Reverter para o commit anterior ao M10-B
git revert <commit-hash-m10b>

# OU restaurar o arquivo específico
git checkout main -- app/(dashboard)/projetos/[id]/page.tsx
```

**Não há mudança de banco** nesta fase — apenas remoção de código de UI e queries client-side.

**Tag de rollback a criar antes de M10-B:**
```
pre-project-workspace-consolidation-m10b-release-YYYY-MM-DD
```

---

## 7. Aviso sobre `images` e `library_files`

Ambas as tabelas não possuem `production_id`. Se a simplificação da página do Projeto
remover o acesso por `project_id`, estas entidades ficarão acessíveis apenas indiretamente:

- `images`: via `image_drafts.current_image_id` → `images.id`
- `library_files`: via `channel_piece_media.library_file_id` → `library_files.id`

**Recomendação:** Manter a Galeria (`/galeria`) e a Biblioteca (`/arquivos`) como
pontos de acesso independentes. Elas não dependem da página do Projeto para navegação.

---

## 8. Perguntas em Aberto (decisões do usuário)

1. A Production de Arquivo deve ser criada antes da simplificação ou a simplificação
   vem primeiro com um aviso de "registros sem Production"?

2. Os registros classificados como REGISTRO DE TESTE devem ser deletados ou mantidos?
   Se mantidos, devem ir para a Production de Arquivo?

3. A aba Produções deve virar uma lista plana (sem Tabs) ou manter o componente Tabs
   com apenas uma aba?

4. Deve existir uma seção colapsável de "Arquivo" para mostrar registros sem Production?
   Ou basta um aviso ("X registros sem Production — [Atribuir]")?

5. O botão de exclusão do Projeto deve continuar bloqueado quando há registros sem
   Production, ou apenas quando há Productions ativas?
