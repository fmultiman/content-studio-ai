# Creative Primitive Harness V0


**Status:** Implementation-prep draft
**Produto:** Content Agent Studio
**Escopo:** pipeline/tooling para ingestão, geração, normalização e preparação de visual primitives


---


## 1. Objetivo


Definir o mecanismo que alimenta a Visual Primitive Library.


O Harness não é, por definição, um agente.


Ele pode começar como tooling determinístico do próprio Studio e ganhar agentes/adapters depois.


---


## 2. Responsabilidade


~~~
input source
→ inspect
→ validate
→ sanitize
→ normalize
→ transform/derive
→ metadata
→ preview
→ publish/register
→ Visual Primitive Library
~~~


---


## 3. Implementação inicial


Direção preferida:


- TypeScript/Node como base, por proximidade com o stack Next/React;
- reutilizar convenções e infra existentes do repo;
- Python apenas quando houver vantagem clara em processamento raster/vector;
- agentes apenas onde descoberta, classificação ou geração assistida realmente ajudarem.


A Wave 0 do spike deve auditar o repo antes de escolher bibliotecas.


---


## 4. Modos de entrada


~~~
project_upload
system_curated
external_import
generated
derived
~~~


### project_upload


Usuário envia PNG/WebP/SVG etc. pelo front-end.


### system_curated


Equipe do Studio adiciona primitive aprovada.


### external_import


Primitive vem de fonte externa licenciada.


### generated


Primitive criada com modelo generativo ou generator procedural.


### derived


Primitive obtida a partir de asset autorizado existente.


---


## 5. Upload flow


~~~
UI Upload
→ temporary ingest
→ file inspection
→ sanitize/validate
→ metadata extraction
→ user/project metadata
→ preview
→ publish
→ Library
~~~


No spike inicial, esse fluxo pode ser simulado com fixtures locais.


---


## 6. External source flow


~~~
source discovery
→ candidate list
→ license/provenance review
→ download/import
→ normalize
→ metadata
→ publish
~~~


Um agente pode fazer source discovery e sugerir tags.


Não deve automaticamente assumir que qualquer asset público é reutilizável.


---


## 7. Generated primitive flow


~~~
primitive request
→ generator
→ candidate(s)
→ visual review
→ normalize
→ metadata
→ publish
~~~


Geração não precisa ser infinita.


Para o Portal e o primeiro V0, uma pequena biblioteca curada é suficiente.


---


## 8. Vector harness


Para SVG, o Harness deve conseguir:


- validar XML/SVG;
- sanitizar active content;
- normalizar viewBox;
- identificar fill/stroke;
- permitir recoloração quando seguro;
- gerar preview;
- detectar dimensões/bounds;
- registrar version/hash.


Não é obrigatório construir um editor SVG no V0.


---


## 9. Raster harness


Para PNG/WebP/JPEG:


- validar decode;
- ler width/height;
- detectar alpha;
- normalizar orientation;
- gerar thumbnail/preview;
- opcionalmente otimizar tamanho;
- preservar original quando necessário;
- registrar checksum.


---


## 10. Transparent asset support


PNG/WebP com fundo transparente é um caso de uso de primeira classe.


Exemplos:


- botanical cutout;
- tape;
- torn paper;
- object cutout;
- icon raster;
- client-uploaded decoration.


---


## 11. Primitive recipe


Hybrid primitives podem ser descritas como recipes de composição.


Exemplo conceitual:


~~~
fact-card-pinned
  base: paper-card
  treatment: lifted-paper
  accessory: pin
  text_slot: true
~~~


Recipe não precisa virar schema de domínio no primeiro spike.


---


## 12. Treatment presets


Treatments são efeitos aplicáveis pelo renderer/template.


Starter candidates:


~~~
soft-shadow
outline
lifted-paper
grain-overlay
archival-fade
muted-fade
cutout-photo
paper-edge
~~~


Treatments devem ser versionáveis e determinísticos.


---


## 13. Photoshop analogy


A inspiração é semelhante a efeitos de layer, mas o produto V0 não deve virar um Photoshop.


O usuário pode futuramente escolher presets de tratamento.


Exemplo:


~~~
Artifact Style
[ none ]
[ archival-paper ]
[ pinned-card ]
[ taped-fragment ]
[ soft-shadow ]
[ cutout-photo ]
~~~


Internamente, cada preset mapeia para um conjunto controlado de effects.


---


## 14. Renderer boundary


O Harness prepara e registra primitives.


O renderer executa a composição visual.


~~~
Primitive Library
→ Primitive Resolver
→ Template props
→ Remotion/renderer
~~~


O Harness não deve acoplar manifests neutros a APIs Remotion.


---


## 15. Primitive Resolver


Uma primitive solicitada pelo template pode ser resolvida por:


- id/version;
- scope;
- project override;
- format;
- role compatibility;
- style family;
- density affinity.


O resolver entrega um asset/runtime representation pronto para o renderer.


---


## 16. Suggested API shape


Conceitualmente:


~~~
ingest(file, context)
inspect(file)
sanitize(file)
normalize(file)
derive(source, recipe)
generate(request)
buildPreview(asset)
register(metadata, asset)
resolve(ref, context)
~~~


Os nomes finais dependem da arquitetura real do repo.


---


## 17. Agent-assisted mode


Agente é opcional.


Possíveis usos:


- descobrir assets em providers permitidos;
- sugerir tags;
- classificar style family;
- sugerir role;
- detectar duplicatas aproximadas;
- gerar prompts para primitives;
- produzir candidate sets.


O agente não deve ser autoridade final para:


- licença;
- provenance;
- evidence status;
- aprovação visual final.


---


## 18. Starter harness target — Pack B


O primeiro harness precisa conseguir suportar pelo menos:


### vector-native


~~~
sequence marker
network/celestial line
simple botanical line
scribble underline
simple frame
~~~


### raster-native


~~~
paper texture
torn paper
tape
grain
botanical cutout
~~~


### hybrid


~~~
headline paper stack
fact card pinned
detail note taped
hero evidence frame
collage field
~~~


---


## 19. Minimal validation output


Cada ingestão deve produzir status estruturado.


Exemplo:


~~~
valid
warnings[]
errors[]
metadata
preview_ref
published_ref?
~~~


Warnings possíveis:


- oversized_asset;
- missing_alpha;
- svg_external_reference;
- unknown_license;
- unsupported_format;
- duplicate_candidate.


---


## 20. First implementation waves


### Wave H0 — repo audit


Auditar LibraryFile/assets atuais, upload existente, storage, image tooling e convenções.


### Wave H1 — local primitive fixtures


Resolver primitives locais para o Documentary Card.


### Wave H2 — metadata/registry


Registrar um pequeno catálogo em memória/código.


### Wave H3 — upload proof


Provar upload de PNG transparente e seu uso em slot de template, sem construir Library UI completa.


### Wave H4 — SVG proof


Provar ingest/sanitização/render de um SVG simples.


### Wave H5 — treatment proof


Aplicar pelo menos soft-shadow/outline ou equivalente como effect controlado.


### Wave H6 — external/import proof


Opcional após o spike principal: importar um asset autorizado com provenance/licensing metadata.


---


## 21. Não objetivos V0


- crawler geral da web;
- scraping massivo;
- editor SVG;
- geração procedural avançada;
- Photoshop completo;
- marketplace;
- thousands-of-assets catalog;
- auto-approval de licença;
- distributed asset processing.


---


## 22. Decisões V0


1. Harness e Library são separados.
2. Harness não precisa ser agente.
3. TypeScript/Node é direção inicial preferida, sujeita à auditoria do repo.
4. Python pode ser adapter especializado, não requisito.
5. Upload de cliente é um fluxo oficial futuro.
6. PNG transparente e SVG são first-class inputs.
7. External acquisition exige licensing/provenance gate.
8. Agentes ajudam discovery/classification, não governam licença.
9. Treatments pertencem ao renderer/style layer.
10. Starter harness deve ser pequeno e suficiente para o Pack B.
11. O objetivo é preparar primitives reutilizáveis, não gerar variedade infinita.
12. O hardcode inicial serve ao spike, mas deve convergir para resolver assets por Library/AssetRef.