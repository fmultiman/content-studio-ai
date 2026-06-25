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

## Resultado de validação

```
tsc --noEmit: 0 erros
eslint:       0 erros, 50 warnings (baseline mantido)
pnpm build:   PASS
```
