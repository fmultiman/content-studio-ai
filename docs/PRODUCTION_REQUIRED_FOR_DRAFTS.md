# PRODUCTION_REQUIRED_FOR_DRAFTS.md
**Implementado: M10-C · 2026-06-25**

## Objetivo

Garantir que nenhum novo `ImageDraft` ou `VideoDraft` possa ser criado sem uma Production válida.

## Contratos de API

### POST `/api/image-drafts`

`productionId` é agora obrigatório. O servidor:

1. Autentica o usuário
2. Exige `productionId` presente e string → `422 PRODUCTION_REQUIRED`
3. Valida formato UUID → `400 INVALID_PRODUCTION_ID`
4. Consulta a Production → `404 PRODUCTION_NOT_FOUND`
5. Verifica propriedade do usuário → `404 PRODUCTION_NOT_FOUND`
6. Compara `projectId` do cliente com `project_id` da Production → `409 PROJECT_PRODUCTION_MISMATCH`
7. Deriva `project_id` da própria Production (ignora `projectId` do cliente)
8. Cria o `ImageDraft` com `production_id = Production.id` e `project_id = Production.project_id`

### POST `/api/video-drafts`

Mesmo contrato que `/api/image-drafts`.

### Códigos de erro estruturados

| HTTP | `code`                      | Significado                                     |
|------|-----------------------------|-------------------------------------------------|
| 422  | `PRODUCTION_REQUIRED`       | `productionId` ausente ou não é string          |
| 400  | `INVALID_PRODUCTION_ID`     | `productionId` não é UUID válido                |
| 404  | `PRODUCTION_NOT_FOUND`      | Production não existe ou não pertence ao usuário |
| 409  | `PROJECT_PRODUCTION_MISMATCH` | `projectId` do cliente diverge da Production   |

### PATCH não alterado

O endpoint PATCH (`/api/image-drafts` e `/api/video-drafts`) **não foi modificado** — atualização de rascunhos existentes continua permitida independentemente de `productionId`.

## Gate de UI

### `/imagens` e `/videos`

Quando a página carrega sem `?production=<uuid>` na URL:

- O auto-save é bloqueado (retorna imediatamente sem chamar a API)
- O save manual mostra toast de erro e retorna sem chamar a API
- Um gate é exibido no lugar do formulário de criação, com mensagem orientando o usuário a acessar via Production
- O botão "Voltar" retorna ao contexto anterior

Quando `?production=<uuid>` está presente (fluxo normal via Production page):

- `productionId` state é setado no mount
- Auto-save e save manual funcionam normalmente
- O banner "Voltar para a Produção" é exibido

### Fluxo correto

```
Production page (/projetos/[id]/producoes/[productionId])
  └── "Criar Imagem" → /imagens?project=<id>&production=<id>
  └── "Criar Vídeo"  → /videos?project=<id>&production=<id>
  └── Abrir draft existente → inclui &production=<id>
```

## Arquivos modificados

| Arquivo | Mudança |
|---------|---------|
| `app/api/image-drafts/route.ts` | POST: require productionId, error codes, derive project_id |
| `app/api/video-drafts/route.ts` | POST: require productionId, error codes, derive project_id |
| `app/(dashboard)/imagens/page.tsx` | Gate UI + auto-save guard + manual save guard |
| `app/(dashboard)/videos/page.tsx` | Gate UI + auto-save guard + manual save guard |

## O que NÃO foi alterado

- Rotas `/imagens` e `/videos` continuam existindo (não removidas)
- Nenhuma constraint SQL `NOT NULL` adicionada
- Rascunhos de teste existentes com `production_id = NULL` não foram deletados
- PATCH continua sem exigir `productionId`
- `images` e `library_files` não alterados
- Production page sem mudanças amplas

## Testes automatizados de contrato HTTP

Script: `scripts/m10c_api_test.mjs`  
Resultado: **22/22 PASS**

Cenários testados por endpoint:

| # | Cenário | Esperado | ImageDraft | VideoDraft |
|---|---------|----------|-----------|-----------|
| T1 | Sem autenticação | 401 | ✅ | ✅ |
| T2 | productionId ausente no body | 422 PRODUCTION_REQUIRED | ✅ | ✅ |
| T3 | productionId = null | 422 PRODUCTION_REQUIRED | ✅ | ✅ |
| T4 | UUID inválido | 400 INVALID_PRODUCTION_ID | ✅ | ✅ |
| T5 | UUID válido, inexistente | 404 PRODUCTION_NOT_FOUND | ✅ | ✅ |
| T6 | Production de outro usuário | 404 PRODUCTION_NOT_FOUND | ✅ | ✅ |
| T7 | projectId divergente da Production | 409 PROJECT_PRODUCTION_MISMATCH | ✅ | ✅ |
| T8 | Production válida (com projectId) | 200 + production_id e project_id corretos | ✅ | ✅ |
| T9 | Production válida (sem projectId) | 200 + project_id derivado da Production | ✅ | ✅ |

Testes adicionais:
- PATCH preserva production_id e project_id quando chamado com projectId (comportamento do cliente real) ✅
- 3 drafts de teste com production_id=NULL não alterados ✅
- 6 drafts reais mantêm assignment para Production de Arquivo ✅

Integridade do banco pós-teste: idêntica ao pré-teste (2 NULL + 7 com production em image_drafts; 1 NULL + 5 com production em video_drafts).

## Smoke visual

Aprovado manualmente pelo usuário em 2026-06-25:
- `/imagens?project=0b04df8b-...&production=76120099-...` → criação de Imagem via Production funciona
- `/videos?project=6d09d50d-...&production=3719a3a2-...` → criação de Vídeo via Production funciona
- Acesso direto via menu lateral (sem `?production=`) → gate "Production obrigatória" exibido ✅

## Decisão de produto: gate atual

Aprovado como proteção nesta fase. Imagens e Vídeos podem permanecer no menu lateral.

Refinamento posterior documentado (não blocker do M10-C):

> Adicionar seletor Projeto → Production (ou dropdown de Production com Projeto derivado) nas telas globais `/imagens` e `/videos`, permitindo criação diretamente do menu sem passar pela Production page.

## Busca de bypasses

Grep em todo o codebase por `.insert()` em `image_drafts` e `video_drafts`:
- `app/api/image-drafts/route.ts` — 2 pontos de INSERT (caminho principal + fallback schema-compat) — ambos dentro do POST, ambos protegidos pelo M10-C gate ✅
- `app/api/video-drafts/route.ts` — 1 ponto de INSERT no POST, protegido ✅
- Nenhum outro INSERT em `image_drafts` ou `video_drafts` em nenhum arquivo do codebase ✅

Auto Mode, geração, upload, duplicação, retomada, criação dentro da Production: todos passam pelo auto-save da page ou pelo POST — ambos protegidos.

## Nota sobre PATCH

O PATCH não exige `productionId`, por design. O cliente real (`saveImageDraft` / `handleSaveDraft`) sempre envia `projectId` do state da página no body. Se um PATCH for chamado sem `projectId`, o campo `project_id` do draft será zerado — comportamento pré-existente ao M10-C, não introduzido por esta implementação.

## Resultado de validação final

```
tsc --noEmit:  0 erros
eslint:        0 erros / 50 warnings (baseline mantido)
pnpm build:    PASS
testes HTTP:   22/22 PASS
fixtures:      0 órfãos (todos deletados pelo teardown)
```
