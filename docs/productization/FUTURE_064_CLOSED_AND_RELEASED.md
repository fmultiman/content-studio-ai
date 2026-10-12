# FUTURE-064 — encerramento e liberação Gemini BYOK

Decisão do proprietário em 2026-10-12: disponibilizar os dois modelos oficiais para todos os usuários autenticados com Gemini BYOK, sem allowlist e sem outra geração paga de validação. Esta decisão substitui a restrição temporária do Lite nos documentos anteriores.

| Modelo | Alias interno | Modelo oficial | Decisão |
|---|---|---|---|
| Nano Banana 2.1 | `gemini-nb-2.1` | `gemini-nano-banana-2.1` | GO; canary pago anterior aprovado |
| Nano Banana 2 Lite | `gemini-nb-lite` | `gemini-3.1-flash-lite-image` | GO; contrato oficial e regressões mockadas |

Ambos usam geração de uma imagem em 1K, nas dez proporções do catálogo. Manual envia o prompt escrito; Assistido exige aplicação da sugestão e clique explícito para gerar; Automático exige um clique de início, usa o provedor textual configurado e envia uma imagem. Não há retry oculto ou fallback. Recuperações de rede/resposta em andamento preservam o request id; uma nova geração deliberada é uma nova operação paga.

O gate global continua OFF por padrão no código e aceita apenas `enabled`. Em Production, o proprietário autorizou `CONTENT_STUDIO_GEMINI_IMAGE_GENERATION=enabled`; Preview, execução local/desconhecida, usuário anônimo, sessão de outro usuário, falta de BYOK e modelos fora do catálogo permanecem bloqueados. A exceção temporária de canary foi removida. Credenciais, banco, migrations, preços e NanoBananaAPI.ai não foram alterados.

Uso reportado é registrado antes do S3 e deduplicado pelo Attempt. Quantidades sem modalidade permanecem sem preço. O canary histórico reconciliado mantém input 29, IMAGE 1120, thoughts 868 e output_unattributed 315: subtotal conhecido USD 0.0401535, **Custo estimado parcial**. Os avisos de cobrança BYOK permanecem visíveis.

Compatibilidade Lite confirmada na [documentação de imagens](https://ai.google.dev/gemini-api/docs/image-generation?hl=en), [catálogo](https://ai.google.dev/gemini-api/docs/models?hl=en) e [REST generateContent](https://ai.google.dev/api/generate-content?hl=en). Não houve geração paga nesta missão. Mocks validam o contrato; acesso, quota, latência e qualidade reais dependem da conta Google. Uma chave configurada pode ser recusada pelo Google e recebe erro explícito, sem retry automático.

## Validação e publicação

494 testes focados passaram em 14 arquivos, cobrindo os dois modelos, os três modos, idempotência/recuperação, autenticação/BYOK, Preview/OFF, armazenamento, contabilização, custos parciais e legado. A revisão independente não identificou bloqueios. Typecheck, lint e checks publicados do HEAD devem estar verdes antes do merge. O fechamento operacional registra PR, SHA final, deployment READY, domínio e probes não cobradas no registro de execução associado à entrega.

## Rollback

No diretório já vinculado ao projeto `content-studio-ai`, remover somente a flag de Production:

```sh
vercel env rm CONTENT_STUDIO_GEMINI_IMAGE_GENERATION production --scope fmultimans-projects --yes
```

Criar `rollback.json` com o SHA atual de `origin/main` no campo `sha`:

```json
{"name":"content-studio-ai","project":"prj_jzyOMApIukhDc25xF2BpmHyjvZR4","target":"production","gitSource":{"type":"github","repoId":1221838288,"ref":"main","sha":"SHA_ATUAL_DE_ORIGIN_MAIN"}}
```

```sh
vercel api '/v13/deployments?forceNew=1' --method POST --input rollback.json --scope fmultimans-projects
vercel inspect URL_RETORNADA --wait --timeout 5m --scope fmultimans-projects
```

Confirmar READY, alias `content.multihuman.com.br` no deployment novo e, autenticado, GET `/api/settings/providers` com `imageGeneration.gemini = { available: false, reason: 'release_switch_off' }`. Uma requisição inválida de imagem deve retornar 403 `GEMINI_IMAGE_GENERATION_DISABLED`. Não executar geração para testar rollback.
