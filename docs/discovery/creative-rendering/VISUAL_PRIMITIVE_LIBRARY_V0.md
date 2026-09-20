# Visual Primitive Library V0


**Status:** Implementation-prep draft
**Produto:** Content Agent Studio
**Escopo:** catálogo reutilizável de primitives visuais para still e vídeo


---


## 1. Objetivo


Definir o catálogo que fornece elementos visuais reutilizáveis aos templates e renderers.


A Library não é uma pasta solta de PNGs nem um diretório de cliparts sem metadata. É um acervo controlado, versionável e pesquisável.


---


## 2. Library versus Harness


~~~
Visual Primitive Library = o que existe e pode ser usado
Creative Primitive Harness = como algo entra, é preparado, validado e publicado
~~~


---


## 3. Classes de primitive


### vector-native


Preferência: SVG.


Exemplos: ícones lineares, networks, constelações, setas, dividers, frames, botanical linework, scribbles, badges.


### raster-native


Preferência: PNG/WebP com alpha quando necessário.


Exemplos: textura de papel, borda rasgada, fita realista, grão, folha recortada, scan, mancha, fragmento archival.


### hybrid-composed


Composta em runtime por SVG, raster, texto e effects.


Exemplos: headline-paper-stack, fact-card-pinned, detail-note-taped, hero-evidence-frame, annotation-note, collage-field.


---


## 4. Escopos


~~~
system
project
~~~


`system`: fornecida pelo Content Studio.


`project`: enviada ou criada para um Project específico.


---


## 5. Origens


~~~
system_curated
project_upload
external_licensed
generated
derived
~~~


Um agente pode ajudar a descobrir candidates, mas não substitui licensing/provenance gate.


---


## 6. Upload pelo cliente


Fluxo desejado:


~~~
Front-end
→ Upload
→ Library ingest
→ Validation
→ Storage
→ Metadata
→ Preview
→ AssetRef / PrimitiveRef
→ Template slot
→ Renderer
~~~


Formatos úteis: PNG transparente, WebP, SVG, fotografia, scan e ornament asset.


No spike inicial fixtures locais podem substituir este fluxo. O hardcode inicial não vira contrato permanente.


---


## 7. Studio Library versus Project Library


~~~
Library
├── Studio
└── My Project
~~~


Studio contém primitives curadas e versionadas.


My Project contém uploads, brand assets, private motifs e elementos específicos.


Ambos chegam ao template pelo mesmo contrato neutro.


---


## 8. Aquisição externa


É permitido considerar importação assistida de fontes externas.


Não baixar indiscriminadamente qualquer imagem encontrada na internet.


Quando aplicável, registrar: source URL, provider, license, author, attribution requirement, modification permission, redistribution permission, acquisition date e hash do original.


---


## 9. Metadata mínima


Exemplo conceitual:


~~~json
{
  "id": "torn-paper-fragment-01",
  "version": "0.1.0",
  "scope": "system",
  "source_type": "system_curated",
  "format_class": "raster-native",
  "mime_type": "image/png",
  "transparent": true,
  "category": "paper",
  "roles": ["decoration", "context"],
  "style_families": ["organic-collage"],
  "palette_modes": ["light", "dark"],
  "density_affinity": ["balanced", "dense"],
  "effects_allowed": ["soft-shadow", "grain-overlay"]
}
~~~


O schema definitivo deve ser reconciliado com AssetRef/LibraryFile reais do repo.


---


## 10. Role compatibility


~~~
hero
evidence
context
decoration
annotation
brand
~~~


Decoration não se promove automaticamente a evidence.


Evidence exige provenance apropriada.


---


## 11. SVG safety


SVG enviado ou importado deve ser sanitizado.


Bloquear/remover scripts, event handlers, referências externas inseguras, active content e network fetches inesperados.


---


## 12. Raster validation


Validar pelo menos mime real, dimensions, alpha/transparency, file size, decode, orientation e corruption.


---


## 13. Treatments


Separar o source asset do tratamento quando o renderer puder aplicar o efeito de modo controlado.


Exemplo:


~~~
source primitive: paper-card
treatment: soft-shadow
~~~


Treatments possíveis futuramente: soft-shadow, outline, grain-overlay, lifted-paper, muted-fade, cutout-photo.


---


## 14. Template slot constraints


Um template pode declarar o que cada slot aceita.


Exemplo:


~~~
hero:
  accepts: image
  roles: hero | evidence


decoration:
  accepts: svg | png | webp
  roles: decoration
~~~


O front-end pode filtrar a Library com base nessas constraints.


---


## 15. Starter Library — organic collage


### vector-native


~~~
sequence-marker-base
constellation-lines-01
network-lines-01
simple-botanical-line-01
underline-scribble-01
corner-ornament-01
simple-frame-01
~~~


### raster-native


~~~
paper-texture-dark-01
paper-texture-light-01
torn-paper-fragment-01
torn-paper-fragment-02
tape-beige-01
tape-beige-02
botanical-cutout-01
botanical-cutout-02
grain-overlay-01
~~~


### hybrid-composed


~~~
headline-paper-stack
fact-card-pinned
detail-note-taped
hero-evidence-frame
annotation-note
collage-field-dark
collage-field-light
~~~


---


## 16. Versioning e reprodutibilidade


System primitives relevantes devem ser versionadas.


Um template aprovado não deve mudar visualmente porque um arquivo foi substituído silenciosamente.


Evitar referências persistentes do tipo `latest` como única identidade de um output aprovado.


---


## 17. Não objetivos V0


- marketplace;
- milhares de assets;
- scraping amplo;
- geração infinita;
- editor SVG;
- DAM completo;
- gestão jurídica automatizada;
- venda de packs;
- freeform asset canvas.


---


## 18. Decisões V0


1. Library e Harness são conceitos separados.
2. Primitive pode ser vector-native, raster-native ou hybrid-composed.
3. System e Project são os escopos principais.
4. Upload do cliente é requisito de produto.
5. Fixtures locais bastam no primeiro spike.
6. Aquisição externa precisa de licensing/provenance.
7. Agente pode descobrir candidates, não aprovar licença sozinho.
8. SVG exige sanitização.
9. Evidence tem requisitos mais fortes que decoration.
10. Treatments devem ser separados do source quando possível.
11. Template slots podem filtrar primitives compatíveis.
12. Starter Library começa pequena e curada.