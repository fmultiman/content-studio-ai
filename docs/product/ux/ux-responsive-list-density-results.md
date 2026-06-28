# UX-H4B1 - Listas e densidade responsiva

Data: 2026-06-27  
Branch: `feat/ux-responsive-list-density-h4b1`  
Status: implementado, validado no smoke autenticado e pronto para PR

## Contexto

A auditoria UX-H4A classificou como P1 a colisao e compressao horizontal nos modos Lista de:

- Imagens;
- Videos;
- Galeria.

O problema estava concentrado na apresentacao das linhas, nao nas queries, filtros, ordenacao, rotas ou modelos de dados.

## Problema anterior

Imagens e Videos usavam uma grade tabular equivalente a:

```text
Titulo | Project | Production | Status | Atualizado | Acoes
```

com tracks minimas proximas de:

```text
minmax(220px,1.4fr)
minmax(140px,0.9fr)
minmax(140px,0.9fr)
96px
120px
170px
```

Galeria usava uma grade ainda mais densa:

```text
Imagem | Titulo | Project | Production | Status | Atualizado | Acoes
```

com thumbnail fixa e tres acoes possiveis na mesma linha.

## Causa

- O modo tabular era ativado cedo demais.
- O cabecalho de colunas aparecia em larguras que ja pediam layout compacto.
- As acoes competiam com metadata e titulo.
- Em Imagens e Videos, a largura do viewport nao refletia a largura real do conteiner.
- Na Galeria, filtros e acoes ainda dependiam de largura interna mais folgada do que a disponivel.

## Estrategia responsiva aplicada

O contrato deste lote permanece:

```text
desktop largo:
colunas alinhadas quando houver largura real

desktop estreito:
duas faixas

tablet:
duas faixas compactas

mobile:
item empilhado
```

## Primeira correcao do lote

- Imagens e Videos passaram a reservar a tabela completa apenas para `2xl`.
- Galeria tambem passou a reservar a tabela completa para `2xl`.
- As acoes da Lista da Galeria deixaram de depender de uma grade rigida e passaram a usar wrap seguro.
- A barra de filtros da Galeria deixou de usar cinco colunas rigidas em larguras intermediarias.

## Segunda retomada do smoke

Na retomada autenticada surgiram dois bloqueios independentes.

### Imagens e Videos

Evidencia observada:

- em `1536px` e `1600px`, o modo tabular ainda era ativado;
- com Sidebar aberta, a largura util observada ficava perto de `894px`;
- o conteudo principal dessas paginas permanece dentro de `max-w-4xl`;
- a grade tabular exigia cerca de `962px` ou mais.

Resultado:

```text
scrollWidth > clientWidth
```

ou seja, o breakpoint de viewport nao resolvia a limitacao real do conteiner.

### Galeria

Evidencia observada:

- a pagina ficou presa em `Carregando Galeria...`;
- `isLoading` e ligado no inicio de `fetchGallery`;
- `isLoading` so volta para `false` no `finally`;
- as queries principais estavam dentro do `try/finally`, mas a etapa de URLs assinadas ficava entre elas e o `finally`.

Fluxo problematico:

```text
queries principais
-> Promise.all(getSignedImageUrls(...))
-> setImages(...)
-> finally setIsLoading(false)
```

Cada `getSignedImageUrls` fazia:

```text
fetch('/api/images/[id]/signed-url')
```

sem timeout, abort ou fallback temporal.

Se uma unica requisicao de URL assinada ficasse pendente:

```text
Promise.all nao resolve
-> finally nao executa
-> isLoading permanece true
```

## Decisao final sobre o modo tabular

### Imagens e Videos

Decisao:

- remover o modo tabular completo;
- manter Lista sempre em duas faixas no desktop/tablet;
- manter empilhamento no mobile.

Justificativa:

- o conteiner `max-w-4xl` torna o tabular estruturalmente fragil;
- o modo de duas faixas preserva densidade, contexto e acoes sem overflow;
- o ganho de alinhamento tabular nao compensa a largura util limitada.

Resultado esperado:

- `1280px`: duas faixas;
- `1536px`: duas faixas;
- `1600px`: duas faixas;
- sem cabecalho tabular;
- sem overflow interno.

### Galeria

Decisao nesta rodada:

- preservar a estrategia de duas faixas em larguras comuns;
- preservar tabular apenas para larguras realmente amplas, sem mexer na definicao visual mais do que o necessario;
- corrigir primeiro o bloqueio de loading.

## Correcao aplicada

### Imagens e Videos

- o cabecalho tabular foi removido;
- a linha da Lista deixou de usar a grade `2xl:grid-cols[...]`;
- metadata permanece em `md:grid-cols-2`;
- labels de `Project`, `Production`, `Status` e `Atualizado` ficam sempre presentes;
- acoes continuam equivalentes e legiveis.

### Galeria

- a resolucao de imagens assinadas foi encapsulada em helper com timeout e fallback;
- uma imagem lenta ou travada nao bloqueia mais a lista inteira;
- em caso de erro ou timeout, o item volta para a URL original;
- o `finally` volta a ser alcancavel por caminho conhecido.

## Estado seguro da Galeria

- sucesso: loading termina e a Galeria renderiza normalmente;
- falha ao assinar uma imagem: loading termina e o output usa fallback;
- falha estrutural das queries principais: loading termina e a pagina mostra erro seguro com tentativa novamente.

## Imagens

Preservado:

- titulo;
- Project;
- Production;
- status;
- atualizacao;
- `Abrir`;
- `Ver Production`, quando valido.

Mudanca:

- a Lista nao tenta mais virar tabela completa.

## Videos

Videos segue o mesmo padrao de Imagens:

- mesma hierarquia de metadata;
- mesmas acoes;
- mesma estrategia de duas faixas;
- mesmo contrato de retomada.

## Galeria

Preservado:

- Cards como modo padrao;
- Lista como alternativa;
- preview;
- download condicional;
- `Ver Production` condicional;
- filtros e ordenacao;
- definicao de output.

Mudanca:

- o loading nao pode mais ficar preso por uma unica URL assinada pendente.

## Cabecalhos

- Imagens e Videos nao exibem mais cabecalho tabular.
- Galeria continua reservando cabecalho tabular apenas quando a linha correspondente tambem puder existir com conforto.

## Metadata

Ordem preservada:

```text
Project
Production
Status
Atualizado
```

Project permanece antes de Production em todos os layouts compactos.

## Acoes

O contrato nao mudou:

- Imagens/Videos: `Abrir`, `Ver Production`;
- Galeria: `Visualizar`, `Ver Production`, `Baixar`.

Mudou apenas a disposicao para evitar compressao ou bloqueio de layout.

## Acessibilidade

- ordem de leitura permanece coerente;
- labels de metadata continuam visiveis fora de qualquer cabecalho tabular;
- botoes mantem labels completos;
- nenhuma solucao depende de esconder overflow para mascarar problema.

## Testes

Testes focados atualizados:

- `lib/__tests__/draft-hub.test.ts`
- `lib/__tests__/gallery-output-library.test.ts`
- `lib/__tests__/view-mode-preference.test.ts`

Cobertura adicionada:

- Imagens e Videos nao dependem mais de grade tabular em `2xl`;
- labels de metadata permanecem no layout compacto;
- Galeria resolve imagens assinadas com fallback seguro;
- uma promise pendente de URL assinada nao bloqueia a resolucao da lista;
- falha ao assinar imagem nao quebra o carregamento.

Validacao executada:

```text
pnpm.cmd test -- lib/__tests__/draft-hub.test.ts lib/__tests__/gallery-output-library.test.ts lib/__tests__/view-mode-preference.test.ts
pnpm.cmd typecheck
```

Resultado observado:

```text
14 arquivos de teste passaram
260 testes passaram
typecheck aprovado
```

## Smoke autenticado final

Resultado consolidado do smoke:

- Imagens validadas em `1280px`, `1536px`, `1600px`, `768px` e `390px`;
- Videos validados nas mesmas larguras;
- desktop e tablet em duas faixas;
- mobile empilhado;
- ausencia de modo tabular residual em Imagens e Videos;
- `scrollWidth == clientWidth` nos containers e linhas observados;
- ausencia de overflow interno e global;
- Project antes de Production;
- acoes integralmente legiveis;
- Cards, Lista e preferencias preservados;
- Galeria saindo sempre de `Carregando Galeria...`;
- timeout e fallback por item nas assinaturas de URL;
- filtros da Galeria responsivos em `1024px`, `768px` e `390px`;
- preview funcional;
- `Abrir origem` preservando draft, Project e Production;
- spot-check humano confirmando `Ver Production` e `Baixar` sem quebrar a pagina.

### Imagens e Videos

- o modo tabular foi efetivamente abandonado;
- `1280px`, `1536px` e `1600px` continuam em duas faixas sem cabecalho tabular;
- `768px` permanece como duas faixas compactas;
- `390px` usa empilhamento sem scroll horizontal;
- Cards seguiram funcionando sem regressao funcional;
- filtros, ordenacao, rotas e preferencias permaneceram preservados.

### Galeria

- a pagina sempre deixou o estado `Carregando Galeria...`;
- o loading global nao voltou a travar por depender de uma unica assinatura de URL;
- tempos observados para estado terminal ficaram na faixa de aproximadamente `5s` a `8s` nos testes autenticados;
- filtros permaneceram utilizaveis em larguras intermediarias e mobile;
- preview continuou funcional;
- `Abrir origem` preservou draft, Project e Production;
- `Ver Production` e `Baixar` foram reconfirmados em spot-check humano.

## Loading infinito da Galeria

Causa confirmada:

```text
fetchGallery
-> Promise.all(getSignedImageUrls(...))
-> uma assinatura lenta ou pendente
-> Promise.all nao resolvia
-> finally nao era alcancado
-> isLoading permanecia true
```

Correcao aplicada:

- timeout de assinatura limitado por item;
- fallback por item para a URL original;
- nenhuma imagem individual bloqueia o encerramento do loading global;
- falha individual nao impede preview, filtros ou renderizacao da biblioteca;
- nenhum fallback exposto na UI revelou token, URL assinada completa ou segredo.

## Limitacoes

- o `h1` duplicado da Galeria permanece fora de escopo para UX-H4B2;
- PageHeader, callouts, cards, estados e formularios permanecem fora de escopo;
- nenhuma mudanca foi feita em Conteudos, Arquivos, Dashboard, Configuracoes ou Sidebar.

## Itens adiados

- UX-H4B2: PageHeader e mensagens contextuais.
- UX-H4B3: Cards, metadata e acoes em outros modulos.
- UX-H4B4: estados, formularios e polish final.

## Conclusao

O UX-H4B1 foi fechado com validacao pratica e tecnica:

- Imagens e Videos abandonam o tabular estruturalmente inviavel dentro de `max-w-4xl`;
- desktop e tablet usam duas faixas consistentes e legiveis;
- mobile usa empilhamento sem overflow;
- Galeria deixa de depender de `Promise.all` sem timeout para assinar todas as imagens antes de sair do loading;
- a biblioteca continua utilizavel mesmo quando uma assinatura individual demora ou falha.

```text
UX-H4B1 APROVADO - READY FOR PR
```
