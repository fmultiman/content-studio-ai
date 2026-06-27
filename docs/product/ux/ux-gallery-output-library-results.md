# UX-H3C — Galeria como biblioteca de outputs visuais gerados

Data: 2026-06-27  
Branch: `feat/ux-gallery-output-library`  
Status: smoke autenticado aprovado; pronto para revisão humana

## Contexto

O UX-H3 Discovery definiu a separação entre:

```text
Imagens = criação contextual e retomada de rascunhos
Galeria = biblioteca de outputs visuais gerados
```

Depois do UX-H3B, `/imagens` passou a funcionar como hub de criação e rascunhos. O UX-H3C aplica a fronteira complementar em `/galeria`.

## Estado Anterior

A Galeria já consultava a tabela `images`, não `image_drafts`, mas a apresentação ainda misturava linguagem de outputs com linguagem de rascunhos:

- filtros `Todas / Aprovadas / Rascunhos`;
- copy "resultados gerados, aprovados e ainda em rascunho";
- cards sem Production visível;
- CTA `Nova Imagem` sem explicar a passagem pelo hub contextual de Imagens;
- estado vazio genérico.

Isso criava sobreposição conceitual com `/imagens`, que agora é o lugar correto para rascunhos e criação.

## Modelo de Dados Real

Nesta rodada não houve alteração de banco, schema ou storage.

A Galeria usa:

- `images`: fonte dos outputs visuais;
- `image_drafts.current_image_id`: associação opcional entre output e draft de origem;
- `projects`: nome do Project;
- `productions`: contexto da Production quando o draft de origem possui `production_id`;
- `/api/images/[id]/signed-url`: URL temporária para assets armazenados.

## Definição de Output

Um item entra na Galeria somente quando o registro de `images` possui asset visual verificável:

- `image_url`;
- `thumbnail_url`;
- `storage_path`;
- ou `thumbnail_path`.

Um registro sem asset visual não é tratado como output e não aparece como item principal da Galeria.

## Itens Incluídos

- imagens geradas com URL persistida;
- imagens geradas com thumbnail;
- imagens armazenadas em storage com caminho disponível;
- outputs associados a draft, Project e Production quando essa relação existe.

## Itens Excluídos

- `ImageDraft` sem imagem gerada;
- prompt isolado;
- formulário de criação;
- upload genérico de Arquivos;
- `VideoDraft`;
- placeholders sem asset visual.

Dados legados sem Production continuam seguros: aparecem com `Sem Production associada`, sem inventar contexto.

## Título e Descrição

Título principal:

```text
Galeria
```

Descrição:

```text
Explore imagens geradas nos seus Projects e Productions.
```

A criação não aparece como CTA permanente no cabeçalho da Galeria.

Motivo:

- criação pertence ao hub `/imagens`;
- a Galeria é biblioteca de outputs;
- um CTA permanente no topo enfraquece a distinção entre criar e consultar outputs;
- esse CTA também criaria expectativa indevida de criação de vídeo na Galeria.

No estado vazio, a orientação usa:

```text
Nenhuma imagem gerada ainda
Crie uma imagem dentro de uma Production para que ela apareça na Galeria.
Ir para Imagens
```

O CTA leva para `/imagens`, onde o hub de Imagens continua responsável por Project → Production → criação.

## Cards

Cards são o modo padrão da Galeria porque a biblioteca é visual e thumbnails são o principal sinal de comparação.

Cada card mostra:

- imagem ou thumbnail;
- título/fallback humano;
- Project;
- Production;
- data de geração;
- status;
- ação `Visualizar`;
- ação `Ver Production`, quando há Production;
- ação `Baixar`, quando há URL baixável.

O prompt completo não é usado como título. O título vem do draft de origem quando disponível ou de uma versão curta da intenção.

## Lista

A Galeria também oferece `Lista` como modo alternativo compacto.

O padrão compartilhado do UX-H3B foi reutilizado:

- `ViewModeToggle`;
- `useViewModePreference`;
- chave própria `gallery-output-view`;
- fallback seguro para `Cards`;
- persistência local sem alteração de banco.

A Lista mostra o mesmo conteúdo essencial dos Cards:

- thumbnail;
- título;
- Project;
- Production;
- status;
- data de atualização;
- ações `Visualizar`, `Ver Production` e `Baixar`.

Em mobile, a Lista não usa tabela horizontal; cada output vira um bloco compacto empilhado.

## Preview

O preview usa modal e mostra:

- imagem ampliada;
- título;
- Project;
- Production;
- status;
- datas;
- prompt associado, quando disponível;
- ações `Abrir origem`, `Ver Production` e `Baixar`.

Não foi criado editor de imagem nem duplicação do workspace de Imagens.

## Status

A Galeria usa somente estados sustentados pela tabela `images`:

- `approved` → `Aprovada`;
- `rejected` → `Rejeitada`;
- `generating` → `Gerando`;
- `draft` com asset visual → `Gerada`.

O termo `Rascunho` foi removido da Galeria para não confundir output visual com `ImageDraft`.

## Filtros

Filtros implementados:

- busca;
- Project;
- Production;
- status.

Production acompanha o Project selecionado. Filtro sem resultado usa estado próprio e não se confunde com Galeria vazia.

## Ordenação

Ordenação padrão:

```text
updated_at desc
```

Isso mantém os outputs mais recentemente atualizados no topo sem criar analytics novo.

## Contadores

Os contadores refletem outputs, não drafts:

- outputs visuais;
- aprovadas;
- geradas;
- rejeitadas quando houver.

Não foi criado contador de "final" porque o modelo atual não sustenta esse estado.

## Download

O download aparece somente quando há URL de imagem baixável.

Para itens que existem apenas com `storage_path` antes da assinatura local resolver uma URL, a ação permanece indisponível em vez de expor caminho interno ou prometer download sem asset acessível.

## Relação com Imagens

`/imagens` continua sendo:

```text
criação contextual + retomada de rascunhos
```

`/galeria` passa a ser:

```text
biblioteca de outputs visuais gerados
```

O CTA do estado vazio encaminha para `/imagens`, preservando a exigência de contexto Project → Production para novas criações.

## Relação com Arquivos

Arquivos permanecem fora de escopo.

A Galeria não virou biblioteca geral de uploads, documentos ou insumos. Essa fronteira fica para UX-H3D / Arquivos.

## Estados

Estados cobertos:

- carregando Galeria;
- erro seguro com tentativa novamente;
- sem Project;
- sem outputs;
- filtros sem resultado;
- output legado sem Production;
- imagem indisponível ou quebrada no card/preview.

## Acessibilidade

- imagens usam alt text contextual;
- ações têm texto explícito;
- modal usa componente de diálogo existente;
- badges têm texto;
- download não depende só de ícone;
- loading usa `role="status"` e `aria-live`;
- cards não aninham links interativos.

## Responsividade

A grade usa cards responsivos, com filtros empilháveis em telas estreitas.

O preview limita altura e permite rolagem interna para evitar overflow em mobile.

## Testes

Teste focado:

```text
lib/__tests__/gallery-output-library.test.ts
```

Cobertura:

- lista apenas outputs reais;
- exclui registro sem asset;
- Project e Production visíveis;
- status verdadeiro;
- ordenação recente;
- filtros por Project, Production, status e busca;
- estado sem Project;
- estado sem outputs;
- filtro sem resultado;
- download condicionado a URL;
- item legado sem Production;
- Galeria não usa linguagem de rascunhos;
- helpers não mutam entradas.

## Smoke Autenticado

Data: 2026-06-27  
Ambiente: `http://localhost:3000/galeria`, sessão autenticada no browser local

Resultado:

```text
UX-H3C SMOKE APROVADO — READY FOR FINAL VALIDATION
```

Validado no browser:

- título `Galeria` e descrição sobre imagens geradas em Projects e Productions;
- ausência de CTA permanente `Criar nova imagem` no cabeçalho;
- ausência de ação permanente de criação de vídeo;
- Cards como experiência visual principal;
- Lista como alternativa compacta;
- persistência local da preferência de visualização;
- chave própria `gallery-output-view`;
- 23 outputs visuais reais listados;
- contadores observados: 23 outputs, 4 aprovadas, 19 geradas;
- Project e Production visíveis quando disponíveis;
- fallback seguro `Sem Production associada`;
- preview funcional com imagem ampliada, contexto, status, prompt associado e ações;
- `Ver Production` abrindo rota nested correta;
- `Abrir origem` preservando `draft`, `project` e `production` em `/imagens`;
- download acionado sem erro de interface e sem expor URL sensível no texto da página;
- filtro sem resultado diferente de Galeria vazia;
- filtro por Project funcionando;
- Production acompanhando o Project selecionado;
- Cards e Lista responsivos em 390px e 768px;
- sem overflow horizontal em mobile;
- modal e toggle com comportamento acessível;
- console sem erros ou warnings relevantes ao final do smoke.

Cenários não reproduzidos por falta de dados visíveis, mas cobertos por helpers/testes:

- status `Rejeitada`;
- status `Gerando`;
- estado sem outputs;
- imagem quebrada;
- ausência completa de Project.

Limitação de automação:

- a seleção direta do filtro de status ficou instável no conector do browser, mas a exibição dos status reais e o contrato do helper foram validados por testes.

## Limitações

- A associação com Production depende de `image_drafts.current_image_id`; outputs sem draft de origem preservado podem ficar sem Production.
- Não há estado `Final` sustentado pelo modelo atual.
- Não foi criada paginação nova.
- Não foi implementada biblioteca de Arquivos.
- Não houve alteração de storage ou geração de thumbnails.

## Itens Adiados

- UX-H3D: reconciliação da Sidebar e nomenclatura global.
- UX-H3D / Arquivos: separar uploads, insumos e outputs finais.
- Galeria futura: paginação, lista alternativa, filtros visuais e status final somente se o modelo passar a sustentar esses dados.

## Checklist de Smoke

```text
Galeria
→ filtrar por busca, Project, Production e status
→ abrir output
→ visualizar imagem ampliada
→ baixar quando disponível
→ Ver Production
→ Abrir origem
→ Ir para Imagens apenas no estado vazio
→ confirmar que /imagens exige Project e Production
→ validar item sem thumbnail ou imagem quebrada
→ validar filtro sem resultado
→ validar mobile
→ checar console/network
```

## Conclusão

O UX-H3C implementa a Galeria como biblioteca de outputs visuais gerados e remove a sobreposição direta com o hub global de Imagens.

```text
UX-H3C APROVADO — READY FOR PR
```
