# Structural Wave 0 — Product UX and navigation consistency V1

Baseline: `origin/main 6a5a046` (o mesmo SHA do diagnóstico, confirmado por `git fetch` antes de implementar). Nenhuma migração, credencial, variável de ambiente, rota de API, roteamento de provedor, capacidade de modelo ou custo foi alterado. Nenhuma chamada paga (geração, Review, assistência ou tradução) foi feita na implementação ou na verificação.

Origem: achados **D4, D5, D6, D9 e D22** do diagnóstico estrutural (`STRUCTURAL_CONSOLIDATION_REVIEW_V1.md`, documento de descoberta local mantido em `docs/discovery/product-map-v1/`, ainda não versionado; este PR não o inclui nem o altera). Os cinco achados foram reconfirmados no código antes da correção.

## Resumo por achado

| ID | Problema comprovado | Correção | Onde |
|---|---|---|---|
| **D5** | `/configuracoes?tab=api` ignorava o parâmetro e abria em Perfil (6 CTAs de credencial de IA levavam à aba errada). | A página lê `?tab=`. Só um valor exato e conhecido é aceito; qualquer outro (ausente, vazio, maiúsculas, espaços, chave de protótipo) cai em Perfil, sem erro. O usuário continua navegando entre abas normalmente; uma navegação posterior para outro `?tab=` é seguida uma vez; remover o parâmetro (limpeza da URL após o OAuth da Kling) não tira o usuário da aba. O link “Configurar provedor” da aba Português passou de `/configuracoes` para `/configuracoes?tab=api`. | `components/settings/settings-tabs.tsx` (`resolveSettingsTab`), `app/(dashboard)/configuracoes/page.tsx`, `components/prompts/prompt-language-panel.tsx` |
| **D4** | `/imagens?project=&production=` (vindo da Produção) abria o hub com Project e Production vazios. | Após carregar os Projects/Productions que o usuário pode ler, o hub pré-seleciona o contexto **uma vez por entrada**. `resolveDraftHubCreateContext` valida: o identificador precisa existir nas listas carregadas e a Production precisa pertencer ao Project. Par incompatível mantém só o Project; uma Production válida sozinha traz o seu Project; identificadores desconhecidos não selecionam nada. **Não cria Session** (a criação continua exigindo o clique em “Criar na Production”). O workspace canônico (`/imagens/geracoes/[id]`) não executa a pré-seleção e continua usando o contexto persistido da Session. | `lib/draft-hub.ts`, `app/(dashboard)/imagens/page.tsx` |
| **D6** | “Ver todos” (cartão compacto de rascunhos do hub de Imagens) levava a `/imagens/rascunhos`, rota de compatibilidade que redireciona de volta ao próprio hub. | A ação agora leva à lista completa e filtrável (“Rascunhos recentes”) da mesma página: rola até a seção e move o foco para ela (`tabIndex=-1`, acessível por teclado). A rota legada **não foi removida** e nenhum sistema de arquivamento foi criado. | `app/(dashboard)/imagens/page.tsx` |
| **D9** | Os status das gerações de vídeo apareciam em inglês cru (`succeeded`, `processing`…) em badge neutro e como texto do botão; o filtro de status do hub só tinha “Rascunho”, então filtrar escondia todas as gerações de IA. | Módulo único `lib/video-generation/status-presentation.ts` (rótulo pt-BR + tom) e `GenerationStatusBadge`, aplicados no hub `/videos`, na aba Vídeos da Produção e no histórico do workspace. O filtro do hub passa a oferecer **Rascunho + todos os estados reais + Sem tentativas**, com os **valores armazenados** como valor da opção; Sessions carregam o status armazenado da última tentativa (ou `no_attempts`). Rascunhos do Creative Editor continuam filtráveis por “Rascunho”. O valor interno do status e a semântica da API não mudaram. | `lib/video-generation/status-presentation.ts`, `components/videos/generation-status-badge.tsx`, `app/(dashboard)/videos/page.tsx`, `app/(dashboard)/videos/geracoes/[sessionId]/page.tsx`, `app/(dashboard)/projetos/[id]/producoes/[productionId]/page.tsx` |
| **D22** | Textos que pressupunham Kling mesmo com Google Veo selecionado. | Mensagens neutras ou com o nome do provedor da conexão **selecionada** (`videoProviderPhrases`). Ver tabela abaixo. | `lib/video-generation/connection-presentation.ts` e arquivos da tabela |

### Estados reais de geração (contrato do banco)

`scripts/039_create_video_generations.sql`: `queued | submitted | processing | succeeded | failed`. Um teste lê esse `CHECK` e exige que a lista do módulo seja idêntica, de modo que um novo estado não possa ser criado sem rótulo. O estado `cancelled` (tratado defensivamente pelo workspace, mas não armazenado hoje) e o estado de Session `no_attempts` também têm rótulo.

| Armazenado | Rótulo | Tom |
|---|---|---|
| `queued` | Na fila | neutro |
| `submitted` | Enviado | info |
| `processing` | Processando | aviso |
| `succeeded` | Concluído | sucesso |
| `failed` | Falhou | perigo |
| `cancelled` (defensivo) | Cancelado | neutro |
| `no_attempts` (Session sem tentativa) | Sem tentativas | neutro |
| outro valor | o próprio valor, neutro (nunca escondido nem mapeado para outro estado) | neutro |

### D22 — textos alterados

| Antes | Depois |
|---|---|
| Hub: “Kling API não configurada” (só verificava a chave Kling) | Aviso baseado nos **descritores de conexão** (ver “Aviso de provedores do hub” abaixo): três situações distintas, e nenhuma afirmação quando as conexões não puderam ser lidas |
| Workspace, automático: “Enviando um vídeo para a Kling.” | “Enviando um vídeo para {a Kling / o Google Veo}.” conforme a conexão selecionada |
| Workspace, envio sem confirmação e sem mensagem do servidor: “…confirmar o envio à Kling.” | “…confirmar o envio {à Kling / ao Google Veo}.” (a mensagem do servidor, quando existe, continua sendo exibida como veio: o servidor já nomeia o provedor correto) |
| Workspace, motivo do automático: “Selecione uma conexão Kling disponível…” | “Selecione uma conexão de vídeo disponível…” |
| Formulário sem conexão utilizável: “…conexão Kling…” (2 textos) | “…conexão de vídeo…” |
| Aviso de custo da assistência: “…usa separadamente a conexão Kling escolhida.” | “…a conexão de vídeo escolhida.” |
| “Assistir” em geração que falhou sem motivo registrado: “A Kling não concluiu esta geração.” | Nomeia o provedor real da geração (`gemini` → “O Google Veo”; linha sem `provider` é anterior ao Veo, logo Kling) |

### Aviso de provedores do hub `/videos` (ajuste de revisão)

A primeira versão desta onda decidia o aviso só pelas chaves de API (`/api/settings/providers`), então uma conta Kling conectada **apenas por MCP** recebia “Nenhum provedor de vídeo configurado” indevidamente. O hub agora usa a autoridade que já existe, `GET /api/video-generations/connections` (somente leitura do banco; sem chamada ao provedor, sem consulta de créditos, sem geração), e classifica os descritores com `summarizeVideoConnections`:

| Situação | Regra (sobre os descritores) | O hub mostra |
|---|---|---|
| **Disponível** | ao menos um descritor com `canGenerate` (Kling API, conta Kling MCP ou Google Veo) | nada |
| **Configurado, mas indisponível** | existe conexão (`status` ≠ `not_configured`), nenhuma gera | “Nenhuma conexão de vídeo disponível para gerar agora” + uma frase por conexão com o **motivo real** do descritor (`authorization_required`, `connection_error`, `generation_authorization_required`, `capabilities_missing`, `capabilities_expired`, `no_supported_models`, `feature_disabled`, `canary_restricted`). “Abrir Configurações” só aparece se algum motivo for resolvível pelo usuário (os dois de liberação do ambiente não são) |
| **Nenhum configurado** | lista vazia, ou todos `not_configured` | “Nenhum provedor de vídeo configurado” (cita Kling, Gemini/Google Veo e a conta Kling) + “Abrir Configurações” (`?tab=api`) |
| **Desconhecido** | a requisição falhou (503, erro de rede, resposta ilegível) | **nada**: o hub carrega normalmente e não afirma que o usuário não tem provedor |

A mesma resposta alimenta os nomes das conexões MCP no histórico; o efeito separado que a buscava apenas quando havia linhas MCP foi removido (uma única requisição). A requisição é melhor-esforço: falha vira “desconhecido” e nunca derruba o hub.

Verificados e **mantidos**, por já serem corretos por ramo de provedor: mensagens do servidor em `app/api/video-generations/route.ts`, `…/[id]/sync/route.ts`, `lib/video-generation/polling.ts` (timeout e conexão indisponível, com ramo `gemini`) e `lib/video-generation/connections.ts`.

## Fora do escopo (não alterado)

Review e seus modelos; novas preferências de geração; seletor API/MCP/VEO; refatoração do workspace de Imagens; migração de `image_drafts`; Creative Editors; Dashboard e Galeria; Supabase; roteamento de provedores, capacidades, custos e credenciais; remoção de rotas legadas.

Observações registradas, sem ação nesta onda:

- `components/videos/create-video-generation-dialog.tsx` (sem consumidor em produção; só testes) mantém seus textos específicos da Kling.
- O selo de procedência do histórico mostra “API” para linhas do Veo (parte do seletor API/MCP/VEO, fora do escopo).
- `lib/creative/video-editor/__tests__/static-parity.test.ts` já falha em `main` (espera a aba “Estilo”, o código publicado diz “Estilos”); não relacionado a esta onda e não tocado.

## Testes

Novos (todos exercitam o código real; só rede, Supabase e router são simulados):

| Arquivo | Cobre |
|---|---|
| `lib/__tests__/structural-wave-0-units.test.ts` | rótulos/tons/filtro de status, contrato do `CHECK` do banco, valores desconhecidos e chaves de protótipo, frases por provedor, aviso “Assistir” por provedor, `resolveDraftHubCreateContext`, `resolveSettingsTab`, e que nenhum CTA de credencial aponte para `/configuracoes` sem `?tab=api` |
| `components/settings/settings-deep-link.test.tsx` | a página real: `?tab=api` e as demais abas, valores inválidos, navegação manual, navegação posterior e remoção do parâmetro |
| `components/images/image-hub-context.test.tsx` | pré-seleção (válida, par incompatível, identificadores desconhecidos, sem parâmetros), nenhuma escrita/navegação automática, criação de exatamente uma Session só no clique, workspace canônico ignora os parâmetros, “Ver todos” (foco, rolagem, sem navegação) |
| `components/videos/video-status-hub.test.tsx` | hub real: estados em pt-BR com valor armazenado preservado, Sessions, rótulo dos botões, opções do filtro, filtro por estado/Rascunho/Sem tentativas/Todos; **aviso de provedores a partir dos descritores**: (1) só conta Kling MCP conectada e utilizável, (2) MCP conectado mas bloqueado — cada motivo real (`generation_authorization_required`, `authorization_required`, `connection_error`, `capabilities_missing`, `capabilities_expired`, `no_supported_models`), (2c) bloqueada ao lado de uma utilizável, (3) só Google Veo disponível e Veo configurado mas não liberado (sem ação inútil), (4) nenhum configurado e lista vazia, (5) falha ao consultar (503 e erro de rede) sem afirmar que não há provedor, uma única requisição às conexões e nenhuma a `/api/settings/providers`, nomes das conexões MCP no histórico a partir da mesma resposta |
| `components/videos/video-multiprovider-language.test.tsx` | workspace real com Veo e com Kling: envio automático, envio sem confirmação, formulário sem conexão, histórico com estados em pt-BR e aviso de falha por provedor |

`lib/__tests__/structural-wave-0-units.test.ts` também cobre `summarizeVideoConnections`, `describeBlockedConnection` (todas as razões de bloqueio) e `isEnvironmentBlockedReason`.

Ajustados: `video-workspace-parity.test.tsx` (aviso de custo agora neutro), `credential-boundary.test.ts` (o módulo puro `status-presentation` entra na lista de módulos que o cliente pode importar; o próprio teste continua provando que ele não importa nada de servidor) e `generation-provenance.test.tsx` (a guarda de “só buscar nomes de conexão quando há geração MCP” passa a garantir que os nomes vêm da **única** resposta de conexões que o hub já lê, de forma melhor-esforço).

Verificação de que os testes não são vácuos (mutações temporárias, revertidas): pré-seleção desligada e filtro reduzido a uma opção derrubaram 9 testes; colapsar “bloqueado” em “nenhum” no classificador de conexões derrubou 8.

## Verificação

| Verificação | Resultado |
|---|---|
| `tsc --noEmit -p tsconfig.typecheck.json` | sem erros |
| ESLint nos arquivos alterados e novos | 0 erros; 13 avisos, todos em código pré-existente não alterado (React Compiler/exhaustive-deps) |
| Testes novos (5 arquivos) | passam (inclui os 5 cenários do aviso de provedores) |
| Suíte completa, código final | 6691 passam, 68 ignorados, 4 falham (abaixo) |

Falhas da suíte completa, nenhuma causada por esta onda:

- `lib/creative/video-editor/__tests__/static-parity.test.ts` e `lib/creative/authoring/__tests__/editor-workspace.test.ts`: já falham em `main` (esperam o rótulo “Estilo”; o código publicado diz “Estilos”). Esta onda não altera `lib/creative`.
- `video-workspace-parity.test.tsx` (1) e `supabase-admin-credential.test.ts` (1): estouraram o limite padrão de 5 s sob a carga da suíte completa (o conjunto de testes que falha muda a cada execução: outros arquivos de vídeo na execução anterior). Rodando os arquivos isoladamente, ou com `--testTimeout=60000`, **passam todos** (68/68). Nenhum deles depende dos textos ou da lógica alterados.

Smoke autenticado e não pago: o preview da Vercel exige login SSO da Vercel (indisponível para o navegador de automação) e não há sessão de aplicativo para `localhost`, então o smoke autenticado é feito em Production após o merge, sem geração, Review ou tradução pagas. O resultado é registrado no PR.
