# Referência de imagem e Image-to-Image V1

Data da verificação documental: **13/10/2026**. A implementação foi verificada com contratos simulados; **nenhuma chamada paga de geração foi feita**. Não há migração, mudança de credenciais ou alteração de ambiente nesta entrega.

## Escopo por modelo

| Modelo/alias | Texto → imagem | Imagem + instrução → imagem | Referências na V1 | Saída na V1 |
| --- | --- | --- | --- | --- |
| Google `gemini-nano-banana-2.1` / `gemini-nb-2.1` | Mantido | Implementado | Uma | 1K |
| Google `gemini-3.1-flash-lite-image` / `gemini-nb-lite` | Mantido | Implementado | Uma | 1K |
| OpenAI `gpt-image-*` | Mantido | Não habilitado pelos adaptadores atuais | Controle indisponível; servidor rejeita | Contrato existente |
| NanoBananaAPI.ai | Mantido | Não habilitado pelo adaptador atual | Controle indisponível; servidor rejeita | Contrato existente |
| Kling MCP imagens | Não habilitado | Não habilitado | Fora desta V1 | Não aplicável |

A disponibilidade do Gemini continua sujeita à feature flag existente, à política de execução do ambiente e à chave BYOK do usuário. Não existe fallback para outro modelo/provedor. Referências mantidas ao trocar para um modelo incompatível bloqueiam a geração até selecionar um modelo compatível ou removê-las.

## Evidência oficial e limites

Fontes oficiais consultadas no navegador em 13/10/2026:

- [Geração e edição de imagens](https://ai.google.dev/gemini-api/docs/image-generation): edição com instrução textual e imagem; tabela específica de referências; Lite apenas 1K; Nano Banana 2.1 suporta 1K/2K/4K. A página informa até 14 referências para ambos; para 2.1 distingue fidelidade de até dez objetos e consistência de até quatro personagens; para Lite informa até 14 objetos e não promete essa consistência de personagens. A V1 não promete equivalência de qualidade.
- [Entradas de imagem](https://ai.google.dev/gemini-api/docs/image-understanding): limite de 20 MB para o pedido inline completo, incluindo texto e bytes; PNG, JPEG e WebP entre os MIME suportados. Outros MIME documentados não são habilitados aqui.
- [REST `generateContent`, `Part` e `Blob`](https://ai.google.dev/api/generate-content): partes `text` e `inlineData`, com `mimeType` e `data` base64. `inline_data` é a representação usada em exemplos de outros clientes; o adaptador REST conserva o formato JSON camelCase já utilizado.

| Limite | Nano Banana 2.1 | Lite | Política da aplicação |
| --- | --- | --- | --- |
| Referências documentadas | Até 14, com distinções de fidelidade acima | Até 14 objetos | **Uma** referência por tentativa; múltiplas são rejeitadas, sem truncamento |
| MIME aceitos na V1 | PNG/JPEG/WebP | PNG/JPEG/WebP | Assinatura, metadados e decodifica??o de pixels verificados no servidor |
| Bytes por referência | Limite inline global documentado | Limite inline global documentado | Até **10 MiB** (10 × 1024² bytes), escolha conservadora da V1 |
| Pedido inline | Até 20 MB | Até 20 MB | JSON serializado medido em bytes UTF-8, até **20.000.000 bytes**, incluindo base64 |
| Dimensões de entrada | Não inferidas do limite de saída | Não inferidas do limite de saída | Até **8192 px por lado**, teto de decodificação da aplicação; imagens animadas/multipágina rejeitadas |
| Resolução de saída documentada | 1K, 2K, 4K | Apenas 1K | **1K** permanece fixo; não foi adicionada seleção de resolução |
| Proporções habilitadas | Subconjunto existente | Subconjunto existente | 1:1, 3:2, 2:3, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9 |

Os limites por modelo ficam em `lib/providers/gemini/image-models.ts`; teto documentado e teto entregue são campos distintos. UI e servidor consultam a política. A política de upload/listagem compartilhada conserva o padrão Video I2V e só aceita WebP sob o perfil explícito `image-reference`.

## Fontes e experiência

O workspace `/imagens` reutiliza o navegador de fontes do Video I2V, com as origens Gerada por IA, Galeria, Arquivos e Enviar. É necessário selecionar um projeto. A Galeria continua representada por LibraryFiles, não por uma segunda identidade ou um novo gerenciador de arquivos.

O envio do computador usa o fluxo existente de URL assinada de upload → S3 privado → registro autorizado de LibraryFile. Apenas depois desse registro o arquivo pode ser selecionado. O pedido de geração leva `{type:'image'|'library_file', id}`; nunca um caminho local, uma URL pública, uma URL temporária ou base64 do navegador.

Uma referência tem miniatura e rótulo de origem, pode ser trocada/removida e pode vir de um resultado anterior. Resultado e histórico oferecem **Usar como referência**, e as tentativas mostram a referência efetivamente usada. A miniatura é resolvida novamente pelo ID ao reabrir a sessão, usando os endpoints autorizados existentes. A falta da miniatura não substitui silenciosamente a fonte.

Download, Review e **Salvar na Biblioteca** continuam disponíveis. Salvar é explícito; a cópia durável continua sendo um LibraryFile de imagem, selecionável pelo navegador existente de Image-to-Video conforme sua política PNG/JPEG. WebP continua fora do perfil Video I2V. Não há criação automática de VideoDraft, ChannelPiece ou outra entidade de vídeo.

## Modos

| Modo | Fluxo com referência |
| --- | --- |
| Manual | Prompt de geração escrito diretamente + referência opcional → clique explícito para gerar |
| Assistido | Descrição → Criar/Melhorar com IA → Aplicar sugestão → prompt final + referência → clique explícito para gerar |
| Automático | Descrição + referência opcional → uma assistência → uma submissão de imagem, sem botão concorrente de geração |

A assistência textual continua sem receber imagem ou bytes. Com referência nos modos Assistido/Automático, a interface explica: **A IA de texto não vê a imagem de referência; ela só é enviada ao modelo de imagem**. O pedido de assistência não afirma ter examinado a fonte. O único texto submetido ao modelo de imagem é o **Prompt de geração** canônico; **Português (leitura)** continua uma tradução opcional e somente leitura. Os avisos de custos BYOK permanecem.

Trocar modo, reabrir sessão ou hidratar estado mantém os IDs da referência. A geração aguarda o upload e o salvamento do estado exato; conflitos de revisão continuam tratados como 409, sem geração paralela ou perda silenciosa.

## Persistência, autorização e execução

1. `working_state.sourceReferences` preserva a escolha editável da Session.
2. Ao submeter, a Attempt congela `source_snapshot.references`, descrição original, prompt exato, modelo e parâmetros. IDs de referência participam do fingerprint; IDs diferentes com o mesmo `clientRequestId` geram conflito.
3. A referência explícita de um pedido novo precisa corresponder ao estado salvo. Um replay com a referência original explícita usa os metadados imutáveis da Attempt, mesmo após outras edições da Session.
4. O claim exclusivo existente impede chamadas pagas duplicadas. Replay não lê novamente a mídia e não chama o provedor. Timeout ou resultado desconhecido mantém a tentativa terminal/pendente existente; não dispara retry de geração automático.
5. O servidor reutiliza `resolveI2vSource(..., deliver:'bytes')` para exigir proprietário + projeto, arquivo de imagem ativo e chave S3 pertencente ao proprietário. LibraryFile excluído, outro usuário/projeto, chave forjada e URL externa sem objeto durável são rejeitados.
6. A leitura verifica HEAD antes de abrir o stream e impõe o teto também durante o consumo, encerrando o stream. MIME vem da assinatura; tamanho/dimensões vêm dos bytes. Referências legadas sem objeto durável precisam ser salvas na Biblioteca antes de uso.
7. Antes da geração, `result_metadata.inputReferences` registra IDs, SHA-256, MIME, tamanho e dimensões verificados. A contabilização preserva essa proveniência. As referências congeladas e o resultado vinculado à Attempt mantêm a relação entrada → saída.
8. O provedor recebe apenas partes inline; nenhuma URL de S3 privado é entregue ao Google. O resultado é guardado e vinculado pelo fluxo existente. Tentativas antigas não são reescritas.

Sem referência, o corpo enviado ao Gemini permanece idêntico ao T2I existente. Os outros adaptadores continuam recusando referências no servidor; não há descarte silencioso.

## Usage e custo parcial

A normalização já conserva `promptTokenCount` e `promptTokensDetails`, inclusive modalidade IMAGE. O total informado pelo Google inclui tokens de imagem de entrada; não adicionamos uma segunda linha que os contaria novamente. A contabilização e suas chaves por Attempt permanecem as existentes, antes de armazenar o resultado, incluindo resposta recebida mas recusada e falha de storage. Ausência de usage continua desconhecida, sem zero inventado. Preços e completude vêm do registro revisado existente; nenhum preço foi criado.

## Kling: bloqueio preciso

Kling MCP foi avaliado sem chamadas pagas. OAuth, upload por `file_upload` e ledger genérico são reutilizáveis, mas a integração atual executa e recupera somente vídeo. Imagem não foi apresentada como disponível na UI nem no catálogo.

| Contrato faltante | Evidência no repositório |
| --- | --- |
| Discovery/capacidades de imagem por conexão | `lib/provider-connections/kling-mcp.ts` pede somente `text_to_video`/`image_to_video`; `kling-mcp-client.ts` normaliza vídeo; `types.ts` contém `capabilities.video`. Fixtures `who_am_i` locais também cobrem vídeo |
| Mapper/allowlist de submissão de imagem | `kling-mcp-generation.ts` constrói duration/resolution/first_image e aceita apenas ferramentas de vídeo; não há mapper validado para `text_to_image`/`image_to_image` |
| Recuperação persistente assíncrona | `lib/video-generation/polling.ts` arrenda somente `video_generations` e depende de conexão, agenda e contadores próprios. Attempt de imagem tem task ID/status, mas `syncNanoImageAttempt` consulta `generation_tasks` e o GET de Attempt apenas lê a linha |
| Ingestão idempotente de resultado de imagem | `completeVideoGeneration` copia MP4 e atualiza vídeo. O parser atual de task não valida contrato de imagem/count. A policy pronta de imagem remota permite apenas o host NanoBanana, não o resultado Kling |
| Créditos e usage por Attempt de imagem | O ledger genérico suporta MCP/conexão e quantidade desconhecida, mas falta finalizador de imagem com chave por Attempt e funding de créditos Kling. Gemini BYOK não pode receber esse consumo |

A evidência read-only do contrato MCP 1.3.3/OAuth fornecida pelo coordenador indica retorno imediato de `generation_id`, consulta por `query_tasks` e URLs de resultado que expiram em 24 horas. O `file_upload` existente pode transmitir bytes privados; isso não resolve os contratos de submissão, validação de capacidades, polling/lease e cópia de resultado de imagem. Não implementamos um envio que depende de o navegador permanecer aberto. A recuperação precisa ser projetada antes de habilitar Kling imagem; não é uma limitação afirmada do provedor.

## Verificação e canary

Os testes de contrato usam auth/DB/S3/provedor simulados e fixtures locais. Cobrem corpo T2I, partes inline para os dois modelos, MIME/caps, fontes duráveis, isolamento/autorização, IDs/URLs inválidos, seleção/troca/remoção/hidratação, modos, fingerprint/replay/timeout/falha, proveniência e usage parcial. As verificações e os resultados finais são registrados abaixo ao fechar a entrega.

`next build` não pode ser executado neste worktree: `node_modules` é uma junction fora da raiz. Typecheck e lint não substituem um build de deployment.

**Canary real ainda necessário, separado desta entrega:** com autorização do proprietário e a política de execução habilitada no ambiente apropriado, escolher uma referência privada pequena no projeto, executar uma edição em cada alias com BYOK, verificar resultado armazenado/Review/download, bytes e MIME da entrada, Attempt/proveniência, usage de entrada e completude do custo. Reenviar o mesmo pedido deve repetir o resultado sem nova chamada; salvar explicitamente a saída PNG/JPEG na Biblioteca e selecioná-la em Image-to-Video deve manter o ID durável. Também verificar no deployment desktop/mobile a ausência de overflow. Nenhuma dessas chamadas reais foi feita nesta implementação.

### Resultados registrados

| Verifica??o | Resultado |
| --- | --- |
| Backend Gemini existente (client/route/boundary/usage) | 4 arquivos, 236 testes passaram |
| Backend final ap?s corre??o de PNG parcial (reference route/media + client; `--maxWorkers=2`) | 3 arquivos, 147 testes passaram |
| Perfil compartilhado de fontes, upload/browse/trust e regress?o Video I2V | 10 arquivos, 237 testes passaram nos checks focados |
| Workspace/modes/Gemini/Library existentes com refer?ncia | 5 arquivos, 112 testes passaram; refer?ncia final isolada: 10/10 |
| Preflight independente | ?nico P2 validado (pixels truncados) corrigido e reproduzido como rejei??o; nenhuma falha de produ??o aberta |
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.typecheck.json` | Exit 0 no estado final |
| `npm run lint` | Exit 0, zero erros e 57 avisos preexistentes; novos arquivos sem avisos |

Os comandos usaram os runners j? instalados (`node node_modules/vitest/vitest.mjs`, `node node_modules/typescript/bin/tsc`). `pnpm exec` tentou reparo de depend?ncias e foi interrompido sem instalar ou remover nada. N?o foi executado build neste worktree.

A su?te completa foi executada uma vez em background com JSON reporter: **322 arquivos; 6294 testes, 6217 passaram, 9 falharam e 68 ficaram pending/skip** (aproximadamente 12 min 13 s). Relat?rio local: `C:/Users/flavi/.traycer/epics/a200085f-88d6-4b55-b845-3fb4d55a7503/image-i2i-vitest.json`.

Classifica??o das falhas:

- **Baseline confirmado pelo handoff:** `lib/creative/authoring/__tests__/editor-workspace.test.ts` e `lib/creative/video-editor/__tests__/static-parity.test.ts`, uma falha de r?tulo Inspector em cada (`Estilos` versus `Estilo`); arquivos n?o alterados nesta entrega.
- **Carga do runner:** seis casos de `components/videos/video-workspace-parity.test.tsx` e um de `lib/__tests__/supabase-admin-credential.test.ts` ultrapassaram o timeout de 5 s na execu??o paralela. A dura??o registrada do scan de credenciais foi 7979 ms. Reexecu??o isolada dos dois arquivos com `--maxWorkers=1`: **68/68 testes passaram** (36,09 s). As sete falhas foram classificadas como conten??o do runner, sem regress?o reproduz?vel. N?o h? falha nova pendente nesta entrega.
- A valida??o completa iniciou antes do ajuste final de decodifica??o de pixels; os 147 testes focados finais acima cobrem a corre??o e o estado final do backend. Typecheck final passou ap?s corrigir apenas a tipagem do spy no teste novo.
