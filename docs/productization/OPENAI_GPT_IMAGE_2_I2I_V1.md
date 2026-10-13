# OpenAI GPT Image 2 — Image-to-Image V1

Contrato documental verificado em **13/10/2026**. Somente **`gpt-image-2`** foi habilitado para edição com referência. `gpt-image-1.5`, `gpt-image-1`, `gpt-image-1-mini` e NanoBananaAPI.ai continuam sem referências nesta aplicação. A disponibilidade de edição no provedor não amplia automaticamente o catálogo liberado aqui.

Nenhuma chamada real de geração foi feita, nenhuma credencial/variável de ambiente foi alterada e nenhuma migração/SQL de alteração foi criada ou aplicada. A única consulta de dados remotos foi um **SELECT de leitura do registro de preços**, descrito abaixo. Os testes de geração são integralmente simulados.

## Fontes oficiais

Os links antigos de `platform.openai.com` redirecionam para `developers.openai.com`; as páginas efetivamente consultadas foram:

- [Guia de geração/edição](https://developers.openai.com/api/docs/guides/image-generation), seção específica de GPT Image 2: tamanhos padrão/customizados, `auto`, qualidade, fidelidade alta automática e cobrança de imagem de entrada. A seção de máscaras menciona imagem/máscara abaixo de 50 MB; não há máscaras nesta V1.
- [Referência `POST /images/edits`](https://developers.openai.com/api/reference/resources/images/methods/edit): exemplo multipart com `image[]`, modelo, opções e resposta; a apresentação padrão atual também documenta a variante JSON `images` com File ID/URL, que não usamos.
- [Modelo GPT Image 2](https://developers.openai.com/api/docs/models/gpt-image-2): entrada texto/imagem, saída imagem, suporte ao endpoint de edição e alias/snapshot.
- [Requisitos de imagem](https://developers.openai.com/api/docs/guides/images-vision): tipos de imagem aceitos. Os limites gerais dessa página para Responses/Chat não são transportados para o endpoint de edição.

**Limitação documental explícita:** a variante JSON da referência atual não explicita o teto por arquivo multipart nem sua lista de MIME. O guia cita 50 MB no contexto de imagem/máscara e o guia de visão confirma PNG/JPEG/WebP; não registramos 50 MB como um teto multipart por arquivo verificado para GPT Image 2. A V1 aplica a política conservadora abaixo, distinta dos limites oficiais de saída e dos limites Gemini. A aceitação real do multipart para este alias continua parte do canary obrigatório.

`package.json` não possui a dependência `openai`; o adaptador existente usa `fetch`. A edição mantém esse transporte, com `FormData`/`Blob` nativos no servidor. Não foi instalada nem atualizada uma SDK; a API oficial também apresenta `images.edit` com arquivos em SDKs, mas compatibilidade de versão instalada não se aplica ao repositório.

## Contrato entregue

Quando existe referência na Attempt, o servidor faz **um POST** para `https://api.openai.com/v1/images/edits`, com Authorization somente no header e o boundary multipart criado por `fetch`.

| Parte multipart | Valor |
| --- | --- |
| `model` | `gpt-image-2` explícito |
| `image[]` | Um arquivo de bytes privados autorizados; MIME e extensão verificados |
| `prompt` | Prompt de geração canônico, sem a tradução de leitura |
| `size` | `1024x1024`, `1536x1024` ou `1024x1536` |
| `quality` | `low`, `medium` ou `high` |
| `n` | `1` |
| `output_format` | `png` |
| `background` | `opaque` |
| `moderation` | `auto` |

Não enviamos `input_fidelity`: GPT Image 2 processa referências em alta fidelidade automaticamente e a documentação pede omitir o parâmetro. Não há `mask`, URLs de entrada, `response_format`, streaming, saída múltipla ou redução de moderação na V1. Transparência em GPT Image 2 é descrita como preview; permanece fora deste escopo.

Sem referência, os corpos JSON de texto→imagem para **todos** os modelos OpenAI continuam os existentes, incluindo `n:1`, parâmetros e comportamento de armazenamento. A UI mantém os valores anteriores `1024x1024`/`medium` para esse caminho; os controles específicos de edição só aparecem com referência. O contrato de geração Gemini I2I e Review permanecem; a correção de identidade de retry descrita abaixo também se aplica ao caminho Gemini.

## Capacidades por modelo e limites

`lib/providers/openai/image-models.ts` concentra a política de GPT Image 2. O helper seguro para o navegador resolve a capacidade pelo modelo; servidor, UI e perfil de upload não liberam outros aliases ou modelos novos.

| Limite | GPT Image 2 — V1 | Gemini — preservado |
| --- | --- | --- |
| Referências | Uma; referência oficial de GPT Image informa até 16, não habilitadas aqui | Uma |
| Entrada | PNG/JPEG/WebP | PNG/JPEG/WebP |
| Bytes privados de entrada | Até **20 MiB** (20 × 1024²), teto conservador da aplicação para multipart | Até 10 MiB |
| Decodificação da aplicação | Até **16384 px por lado** e **67.108.864 pixels** no total; imagem estática decodificável | Até 8192 px por lado; orçamento anterior mantido |
| Pedido | Multipart binário, sem teto JSON Gemini aplicado | Inline JSON até 20.000.000 bytes |
| Saída entregue | PNG nas três dimensões padrão acima | 1K conforme contrato existente |
| Resposta e imagem de saída | JSON até 32 MiB; PNG decodificado até 16 MiB, dentro do teto de saída do modelo | Contrato anterior |

O teto de pixels da aplicação é o orçamento de decodificação já utilizado no servidor, com limite por lado maior para OpenAI; não é um limite afirmado do provedor. Imagens animadas, MIME/assinatura incompatíveis, cabeçalhos completos com pixels truncados e objetos acima do limite são recusados antes da submissão paga.

O GPT Image 2 documenta `auto` e dimensões customizadas: lados múltiplos de 16, lado máximo de 3840, proporção até 3:1 e total entre 655.360 e 8.294.400 pixels. Resoluções acima de 2560×1440 são experimentais. A V1 registra essas capacidades documentadas, mas entrega somente as três opções padrão. `auto`/resolução arbitrária/2K/4K, qualidade `auto` e modelos 2.5 não foram adicionados à UI ou ao contrato de edição liberado.

## Referências privadas, modos e persistência

A seleção reutiliza o mesmo navegador de fontes e as origens projeto/IA, Galeria, Arquivos e upload do computador. O perfil explícito `openai-image-reference` permite 20 MiB; `image-reference` conserva o teto Gemini de 10 MiB e Video I2V conserva PNG/JPEG e seu comportamento anterior. O upload precisa virar um LibraryFile durável por S3→registro autorizado antes da seleção. O endpoint de registro valida o tamanho real por HEAD, independentemente do tamanho declarado pelo cliente.

`loadImageReferences` recebe capacidades como parâmetro; os wrappers Gemini mantêm chamadas, limites e mensagens anteriores. Ambos usam a mesma autorização Video `deliver:'bytes'`: proprietário, projeto, arquivo ativo e chave S3 pertencente ao proprietário. O HEAD antecede a leitura; o stream também aplica o limite e é encerrado. A assinatura identifica o MIME, Sharp verifica metadados/dimensões e `stats()` decodifica todos os pixels. Nenhuma URL pública, assinada de S3 ou fornecida pelo cliente é entregue à OpenAI.

| Modo | Comportamento |
| --- | --- |
| Manual | Prompt direto + referência + tamanho/qualidade → geração explícita |
| Assistido | Descrição → uma sugestão textual aplicada explicitamente → prompt final + referência → geração explícita |
| Automático | Descrição + referência → uma assistência → uma submissão; retry de resultado incerto não repete a assistência nem a cobrança |

A assistência textual não recebe imagem. A nota existente continua visível com referência: **A IA de texto não vê a imagem de referência; ela só é enviada ao modelo de imagem**. A tradução opcional **Português (leitura)** permanece somente leitura. O aviso BYOK explica que imagens de entrada também consomem tokens cobrados e que a alta fidelidade é automática.

IDs sobrevivem a troca de modo/modelo, substituição/remoção e hidratação da Session. `working_state.sourceReferences` e `generationConfig` guardam a escolha editável. Antes do POST, o autosave confirma o estado exato; conflito 409 bloqueia a submissão. A Attempt congela referência, prompt, modelo e tamanho/qualidade. Seu fingerprint usa a identidade da referência; mesmo `clientRequestId` com referência diferente conflita, e replay explícito original continua válido após edições da Session. A UI inclui prompt/modelo/tamanho/qualidade/IDs na identidade de retry.

O claim exclusivo impede geração concorrente duplicada. Replay não relê os bytes nem chama o provedor. Deadline, erro de rede ou falha de servidor com resultado incerto preservam o estado apropriado e não fazem retry automático de geração. A proveniência em `result_metadata.inputReferences` inclui IDs, SHA-256, MIME, bytes e dimensões, sem reescrever Attempts antigas.

**Correção após revisão independente de `0cc5358`:** erros e replays expõem `outcome_unknown`. Manual (novo clique) e Automático (**Tentar só a imagem**) conservam o mesmo `clientRequestId` após timeout, resposta perdida, falha de storage depois da execução paga ou replay de tentativa incerta. Para servidores/respostas anteriores sem a flag, 5xx, 408 e replay falho permanecem conservadores. Somente rejeição definitiva (`outcome_unknown:false` ou 4xx conhecido sem timeout) permite renovar a identidade automaticamente. Alterar prompt/modelo/referência/configuração ou clicar explicitamente em **Gerar Novamente** cria um novo pedido. O mesmo defeito de rotação existia no caminho Gemini e recebeu a correção mínima; seus contratos de imagem não foram ampliados. A mensagem de resultado incerto informa que a cobrança pode ter ocorrido.

Falhas ao vincular a saída ou gravar a falha da Attempt também conservam a incerteza depois da submissão, inclusive no T2I canônico OpenAI. A indisponibilidade do store ao verificar/criar/reivindicar a mesma identidade não prova que ela nunca foi executada e não autoriza trocá-la. O claim permanece exclusivo; depois que o store volta, uma Attempt já submetida faz replay, mesmo se o registro terminal não pôde ser salvo. Rejeições conhecidas antes da execução e recusas definitivas do provedor conservam sua flag negativa.

## Resultado e Usage

A resposta de edição exige uma imagem `data[0].b64_json` PNG, valida base64 estrito, assinatura, dimensões e pixels. URLs de resultado não são buscadas. Guardar a saída em S3 e vincular à Attempt é obrigatório para I2I; falha de storage fecha a tentativa com indicação de resultado incerto, preservando o consumo já registrado. Resultado/histórico, download, Review, **Salvar na Biblioteca** explícito e **Usar como referência** continuam compartilhados. A saída PNG salva na Biblioteca continua selecionável em Video I2V. Não há criação automática de rascunho de vídeo.

A resposta pode trazer `usage.input_tokens`, `input_tokens_details.text_tokens/image_tokens`, `output_tokens`, `output_tokens_details` e `total_tokens`. Normalizamos somente inteiros válidos informados pelo provedor. O total de entrada já inclui imagem: uma linha de entrada e uma linha de saída evitam contar os detalhes novamente. Os detalhes ficam como evidência. Campos ausentes não viram zero; sem quantidades agregadas, uma linha desconhecida conserva os detalhes disponíveis.

Usage é registrado **antes de guardar a saída**, inclusive em resposta 2xx recebida mas inutilizável. Erro HTTP sem resposta de execução provada/rede não inventa consumo. As chaves por Attempt impedem linhas duplicadas. Retry existe apenas para gravação do ledger; falha de contabilização mantém fatos normalizados e proveniência na Attempt, sem repetir OpenAI.

O recebimento HTTP 2xx é marcado antes de ler o corpo. JSON malformado/truncado, envelope não objeto, corpo acima do limite ou deadline/erro de leitura após os headers preservam essa evidência e o identificador de resposta limitado. Sem usage legível, grava-se exatamente um evento de execução com quantidade/unidade desconhecidas; isso não significa custo zero. A Attempt permanece com `outcome_unknown:true` e seu replay não repete geração nem evento. Erro de rede antes dos headers ou HTTP não 2xx não cria quantidades ou evento de execução sem essa evidência.

**Registro de preços verificado somente por SELECT em 13/10/2026:** `provider_pricing_versions` possui três versões OpenAI para `gpt-4o-mini` Standard (`input`, `cached_input`, `output`) e nenhuma para GPT Image 2. Portanto, a lembrança de “nenhuma linha OpenAI” não descreve o estado observado; não há tarifas de **imagem GPT Image 2**. A derivação impede aplicar tarifas Chat a tokens de imagem/mistos. Custo permanece indisponível; quando agregado a execuções precificadas, o subtotal continua parcial. Nenhuma tarifa ou SQL de preços foi proposta/aplicada nesta entrega.

## Verificação e canary pendente

Os testes simulam provider/fetch, auth, DB e storage e cobrem multipart real, MIME/bytes/caps, autenticação/isolamento, erros de moderação/4xx/5xx/deadline, replay/concorrência, provenance/storage/usage, modos/hidratação e regressão T2I/Gemini. Os resultados finais são registrados ao fechar a branch.

`next build` não foi executado: `node_modules` é uma junction fora da raiz deste worktree. Typecheck/lint e testes não são um build de deployment. A cobertura de layout é de classes responsivas/fluxos simulados; viewport real desktop/mobile permanece para canary.

| Verificação da entrega original (`0cc5358`) | Resultado |
| --- | --- |
| OpenAI route/client/T2I existente, após ajustes finais de autenticação e deadline | 3 arquivos, 114/114 testes passaram |
| Capacidade por modelo e extração/contabilização de uso | 2 arquivos, 18/18 passaram |
| Pricing, derivação Gemini e fronteira de imports | 4 arquivos, 97/97 passaram |
| Gemini route/client/decoder e workspace integrado | 6 arquivos, 278/278 passaram |
| Perfil de fontes/upload/browse/trust/Video/Gemini | 7 arquivos, 196/196 passaram |
| Workspace OpenAI final (modos, parâmetros, retry, hidratação) | 19/19 passaram |
| Preflight independente | Nenhum achado acionável; artefato `artifacts/openai-gpt-image-2-i2i-review/index.md` no epic |
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.typecheck.json` | Exit 0 no estado final |
| `npm run lint` | Exit 0, zero erros e 51 avisos; baseline informado era 57, nenhum novo aviso |

Os comandos usaram os runners instalados (`node node_modules/vitest/vitest.mjs ... --maxWorkers=2`), sem reparo/instalação de dependências. A entrega original executou a suíte completa uma vez em background, também com dois workers e JSON reporter; seu resultado histórico está abaixo.

**Suíte completa:** `node node_modules/vitest/vitest.mjs run --maxWorkers=2 --reporter=json --outputFile=<relatório-local>`; 326 arquivos, **6449 testes: 6377 passaram, 4 falharam e 68 pending/skip**, em aproximadamente 11 min 52 s. Relatório: `C:/Users/flavi/.traycer/epics/a200085f-88d6-4b55-b845-3fb4d55a7503/openai-gpt-image-2-i2i-vitest.json`.

Classificação e fechamento das quatro falhas:

- **Duas baseline informadas no handoff:** `lib/creative/authoring/__tests__/editor-workspace.test.ts` e `lib/creative/video-editor/__tests__/static-parity.test.ts`, rótulos Inspector `Estilos` versus `Estilo`; não foram alteradas.
- **Duas verificações estáticas novas que precisavam atualizar sua lista fechada:** `lib/__tests__/credential-boundary.test.ts` não reconhecia `lib/providers/openai/image-edit-client.ts` como transporte server-side nem `lib/usage/openai-image-usage.ts` como contabilização server-side. Foram adicionados apenas esses caminhos exatos, junto de uma verificação de que seus imports estão exclusivamente na rota OpenAI autenticada. Não foi permitida importação por componente cliente.
- **Reexecução final após ajuste somente de teste:** credential-boundary + provider-execution-guard-generation + openai-image-reference-route: **3 arquivos, 168/168 passaram**. Nenhuma falha nova pendente; não foi necessária outra suíte completa nem mudança de produção após o preflight. Os timeouts conhecidos em Video/environment/scan de credenciais não se reproduziram nesta execução com dois workers.

### Verificação das correções da revisão de `0cc5358`

A revisão independente posterior identificou os defeitos de identidade de retry e uso desconhecido descritos acima; o preflight inicial não os havia detectado. O recheck estreito validou também falhas de vínculo/persistência pós-provedor e indisponibilidade dos SELECTs de escopo. Todos foram corrigidos; evidência no artefato `artifacts/openai-gpt-image-2-i2i-fix-review/index.md` do epic.

- **Regressões integradas iniciais:** nove arquivos, 433/433 passaram, cobrindo OpenAI client/route/T2I, Gemini route/usage e workspace Manual/Assistido/Automático.
- **Repro externo da revisão fria:** `--config <openai-i2i-cold-review.config.mjs> --maxWorkers=2 -t 'cold-review:'`: 3/3 passaram, incluindo as duas assertions originais e a regressão tracked do JSON ilegível.
- **Repro externo das falhas de persistência:** `--config <artifacts/openai-gpt-image-2-i2i-fix-review/reproduction.config.mjs> --maxWorkers=2 -t 'fix-review:'`: 4/4 passaram, incluindo as duas assertions externas e suas versões tracked.
- **Gemini após a correção de persistência:** três arquivos, 173/173 passaram. **Leituras de recuperação indisponíveis** em Session/projeto/produção/Attempt: 4/4 regressões OpenAI passaram. A fixture desses últimos testes foi corrigida após uma execução com nomes de constantes incorretos; não era falha de produção.

Uma execução completa anterior ao último ajuste de persistência registrou 326 arquivos, 6499 testes: 6429 passaram, duas falhas baseline e 68 pending/skip. A solicitação de parada só retornou depois da escrita do JSON completo, sob carga da máquina; a verificação no estado final foi repetida por haver alteração adicional de produção. Nenhuma geração real foi chamada para reproduzir os erros.

**Canary real necessário: exatamente uma chamada paga**, depois de autorização do proprietário, no ambiente de execução autorizado, com BYOK OpenAI. Selecionar um PNG privado pequeno e conhecido no projeto, Manual, GPT Image 2, `1024x1024`/`low`, prompt de alteração simples; verificar multipart aceito sem `input_fidelity`, uma saída PNG armazenada, referência/hash/params/Attempt vinculados, tokens de texto/imagem e custo indisponível sem taxas de imagem. Reenviar **o mesmo pedido** deve fazer apenas replay, sem segunda chamada paga. Depois verificar download, Review, salvar explicitamente na Biblioteca, escolher como nova referência e fonte Video I2V, reabrir Session e viewport de 320 px. Não executar uma segunda geração nem I2V paga para essa verificação de seleção. Nenhum passo desse canary foi realizado nesta implementação.
