# Phase 2D-A — Primitive Transform Round-Trip

## 1. Objective

Provar que os transforms editáveis de `paper` e `tape` percorrem, de forma reproduzível, o caminho:

`AuthoringState → render request → render preparation → DocumentaryCard → PNG`.

O escopo foi limitado a `offsetX`, `offsetY`, `rotation`, `scale` e `opacity`, em static render e em pelo menos um frame timeline. Não houve promoção para `ChannelPiece`, `VideoDraft` ou para um shell de produto.

## 2. Pre-flight

**FACT.** A branch de trabalho partiu de `9ae8c29` (`docs: assess Creative Workspace product architecture`), com `89a1888` (`feat: add project primitive authoring proof`) na história. O worktree estava limpo antes das alterações.

Foram lidos os documentos das fases 2D0, 2C e 2B e inspecionados `AuthoringState`, `primitiveTransforms`, a request de authoring, `DocumentaryCard`, materiais de primitives, `CoverVariant` e os limites Remotion static/timeline.

## 3. Existing transform path

**FACT.** A UI de `/dev/creative-preview` já mantinha `primitiveTransforms` por slot em `AuthoringState`, com controles para paper e tape. O preview já conseguia refletir esses valores, mas `derivePrimitiveSelectionRequest` só serializava a seleção semântica. A request de render, a preparação de materiais e as props de `DocumentaryCard` não carregavam transforms; portanto, o render final continuava no comportamento default.

## 4. Break point found

**FACT.** O ponto de perda era o boundary entre authoring e render preparation: a seleção chegava ao script `render-authoring-request.ts`, era resolvida para `LibraryFile`/`AssetRef`/`ResolvedAsset`, mas os valores de transform não atravessavam a request. O componente não tinha como receber o override.

## 5. Effective transform model

Foi criado um modelo neutro reutilizável por static e timeline:

```ts
type PrimitiveTransform = {
  offsetX: number;   // pixels, no canvas
  offsetY: number;   // pixels, no canvas
  rotation: number;  // degrees
  scale: number;     // scalar determinístico
  opacity: number;   // normalizado 0..1
}
```

Os limites da request permanecem os já usados pela UI: offsets `-120..120`, rotação `-15..15`, escala `0.5..2` e opacidade `0..1`. Não foram adicionados skew, crop, masks, blend modes, matrizes arbitrárias, curvas ou z-index.

**FACT.** O modelo é `PrimitiveTransforms` por slot (`paper`/`tape`) e é compartilhado pelo componente static e pelo caminho timeline. Não há branch de transform exclusivo para vídeo.

## 6. Defaults ownership

**FACT.** O template/componente continua sendo o dono do comportamento visual default. O authoring state é dono dos valores temporários editáveis e só emite overrides não-default. A preparação de render recebe esses overrides; quando ausentes, o componente preserva exatamente seu comportamento anterior.

Assim, a regra efetiva é: `effectiveTransform = authoringOverride ?? template/default behavior`. Não há persistência redundante de defaults e o neutral manifest não ganhou referência de primitive.

## 7. Authoring → render request

`derivePrimitiveTransformsRequest` compara cada slot com os defaults neutros. Para um estado default, retorna `undefined`; para um estado ajustado, serializa somente `paper` e/ou `tape` alterados. A request valida os valores e os mantém ao lado de `primitiveSelection`, sem URLs assinadas e sem inserir dados de catálogo no manifest.

**FACT.** A request ajustada usada na prova preservou exatamente:

- paper: `{ offsetX: 64, offsetY: -38, rotation: 11, scale: 1.24, opacity: 0.8 }`;
- tape: `{ offsetX: -27, offsetY: 19, rotation: -8, scale: 0.82, opacity: 0.63 }`.

## 8. Render preparation

Durante `render-authoring-request.ts`, a seleção semântica continua sendo resolvida para os dois primitives reais (`paper-card-light-01` e `tape-kraft-short-01`) via Library/S3. Os transforms seguem como valores reproduzíveis na input do Remotion, enquanto os materiais seguem como `ResolvedAsset`.

**FACT.** A prova confirmou `paper` e `tape` resolvidos a partir de S3 nos renders default e adjusted. O resumo redigido não contém signed URLs.

## 9. Component application

`DocumentaryCard` recebe apenas material visual resolvido e transform resolvido. `PaperPlane` e `MaterialTape` aplicam offsets, rotação, escala e opacidade nos slots de paper/tape; não conhecem Project, Primitive Catalog, Supabase ou S3. `CoverVariant` e `InfoVariant` encaminham o mesmo modelo aos materiais correspondentes.

## 10. Static default proof

**FACT.** Foi renderizado o canvas static `1080x1350` sem override. O PNG está em `.tmp/creative/productization/phase-2d-a/primitive-transforms-default.png`. A request não carregou transforms e o comportamento visual equivale ao template default. O render terminou sem diagnostics.

## 11. Static adjusted proof

**FACT.** Foi renderizado um segundo PNG com os valores ajustados acima: `.tmp/creative/productization/phase-2d-a/primitive-transforms-adjusted.png`. A diferença é deliberadamente visível: paper e tape mudam posição, rotação, escala e opacidade. O resumo registra requested/effective transforms idênticos, sem alteração silenciosa.

O resumo redigido está em `.tmp/creative/productization/phase-2d-a/execution-summary-redacted.json`.

## 12. Timeline regression

**FACT.** Um frame timeline (`frame 90`) foi renderizado em `.tmp/creative/productization/phase-2d-a/primitive-transforms-timeline-frame.png` usando exatamente o mesmo `PrimitiveTransforms` ajustado. O caminho timeline recebe o modelo compartilhado através de `TimelineComposition`/`TemplateSegment`; não foi criado um sistema paralelo.

## 13. Preview limitation

**FACT.** O browser preview de `/dev/creative-preview` continua usando material fixture/proxy, conforme a restrição conhecida da Phase 2C. Esta fase não tentou corrigir a paridade de assets. Os valores e unidades de transform são compartilhados entre preview e render, mas a imagem do preview não deve ser declarada pixel-identical ao PNG final S3.

## 14. Tests

Foram adicionados testes de alto valor para:

- defaults, reset, isolamento paper/tape e serialização sem URLs;
- validação de bounds e ausência de override default;
- aplicação de transform em paper/tape (`translate`, `rotate`, `scale`, `opacity`);
- propagação do mesmo modelo para um frame timeline;
- preservação do neutral manifest sem `PrimitiveRef`.

## 15. Baseline

**FACT.** Validação final:

- `pnpm test`: **503/503** testes passando em 40 arquivos;
- `pnpm typecheck`: PASS;
- `pnpm lint`: PASS, 0 errors e 45 warnings (baseline preservada);
- `pnpm build`: PASS.

Não houve alteração de banco, schema, migration ou storage persistente.

## 16. Remaining constraints

- browser preview ainda não usa os mesmos primitives S3 do render final;
- Project loading ainda não foi contextualizado em entidade real;
- transforms ainda não foram promovidos para `ChannelPiece` ou `VideoDraft`;
- não existe ainda uma entidade `ContentVersion` no domínio auditado;
- primitives continuam project-scoped e system/shared primitives permanecem deferred.

Essas limitações não impedem a prova de round-trip final, mas devem ser consideradas antes de chamar o shell de produto.

## 17. Phase Verdict

**PASS_WITH_CONSTRAINTS.**

**FACT.** Paper e tape, offsets, rotação, escala e opacidade chegam ao render final; defaults permanecem compatíveis; o PNG adjusted comprova diferença; o frame timeline reutiliza o mesmo modelo; o neutral manifest permanece limpo; e não houve mutação de DB/schema/storage.

**CONSTRAINT.** O único condicionante aceito nesta fase é a limitação já conhecida do browser preview com fixture/proxy assets. O próximo slice deve absorver o carregamento real de Project/contexto no shell correto antes de promover esta superfície a authoring de produto.
