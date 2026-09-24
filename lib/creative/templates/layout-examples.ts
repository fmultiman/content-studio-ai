/**
 * Template example content for the editorial-documentary-collage-v1 layouts
 * that were reconstructed from Pack A (docs/discovery/creative-rendering/
 * visual-reference-pack/pack-a/00N.png): each layout's example is its
 * reference slide's text, verbatim. A new slide of a layout starts from this
 * (see createTemplateSlide), exactly as Cover/Info start from Pack B 1/2.
 * Emphasis runs of the reference are marked with **…**.
 *
 * Pure data (no imports) so the authoring layer, dev fixtures and tests share
 * one copy.
 */

export const LIST_EXAMPLE_CONTENT = {
  title: 'Quem estava fazendo essa pergunta?',
  intro: '**Carlos A. P. Tavares** (1956–) escrevia sobre aquele universo no momento em que ele se organizava.',
  items: [
    { icon: 'microphone', text: 'Apresentava o programa **Sociedade Alternativa,** na Rádio Gazeta AM de São Paulo.' },
    { icon: 'pencil', text: 'Escrevia a coluna **Anarquismo Vivo,** na revista **Planeta.**' },
    { icon: 'book', text: 'Formado em Jornalismo pela Faculdade Cásper Líbero. Trabalhou como bancário e livreiro.' },
  ],
  image_caption: 'Revista Planeta, março de 1983, texto “Anarquismo vivo”.',
} as const

/** Pack A Slide 6. */
export const GRID_EXAMPLE_CONTENT = {
  title: '“Comunidade alternativa” já era um termo longo',
  intro: 'O livro percorre experiências muito diversas, que compartilhavam algumas ideias em comum.',
  tiles: [
    { icon: 'tree', label: 'rurais' },
    { icon: 'buildings', label: 'urbanas' },
    { icon: 'harvest', label: 'produtivas' },
    { icon: 'house', label: 'residenciais' },
    { icon: 'star', label: 'religiosas/místicas' },
    { icon: 'people', label: 'políticas' },
  ],
  ideas_title: 'Ideias que atravessavam muitas delas:',
  ideas: [
    { icon: 'consensus', label: 'consenso' },
    { icon: 'gear', label: 'autonomia' },
    { icon: 'community', label: 'vida coletiva' },
    { icon: 'lock', label: 'liberdade individual' },
    { icon: 'leaf', label: 'preocupação ambiental' },
    { icon: 'sprout', label: 'busca de autossuficiência' },
  ],
} as const

/** Pack A Slide 7 (UFs as printed in Pack A). */
export const MAP_EXAMPLE_CONTENT = {
  title: 'Um “Brasil alternativo” estava sendo desenhado',
  intro: 'Tavares dedica uma seção ao “movimento alternativo tupiniquim” e menciona várias comunidades espalhadas pelo país.',
  places: [
    { name: 'Comunicampo', uf: 'MT' },
    { name: 'Vale das Flores', uf: 'MG' },
    { name: 'Coonatura', uf: 'GO' },
    { name: 'Arca', uf: 'SP' },
    { name: 'Aurora Espiritual', uf: 'RJ' },
    { name: 'Sol e Terra', uf: 'SP' },
    { name: 'Atma Charya', uf: 'SP' },
    { name: 'Ashram Atmanpur', uf: 'MG' },
    { name: 'Aldeia Velha', uf: 'MG' },
    { name: 'Tribo da Terra', uf: 'RS' },
  ],
  places_more: 'e muitas outras…',
  note: 'Não se trata de um censo ou mapa oficial. São experiências mencionadas na obra.',
} as const

/** Pack A Slide 8. */
export const NETWORK_EXAMPLE_CONTENT = {
  title: 'Como essas ideias circulavam?',
  kicker: 'Antes da internet, uma rede de informação',
  intro: 'Nas indicações de leitura do livro, Tavares aponta as publicações que acompanhavam ou eram produzidas pelo próprio movimento alternativo.',
  nodes: [
    { title: 'Planeta', subtitle: '(coluna “Comunidades em Aquário”)' },
    { title: 'Transe', subtitle: '(revista)' },
    { title: 'Pensamento Ecológico' },
    { title: 'Informativo Projeto Alvorada' },
    { title: 'Jornal Comum-Unidade (ABRASCA)' },
    { title: 'Aquarius', subtitle: '(Comunicampo)' },
    { title: 'Boletim Aurora Espiritual' },
    { title: 'Boletim Sol e Terra' },
    { title: 'Boletim dos Sarvas' },
  ],
  callout: {
    icon: 'radio',
    text: 'Entre as fontes utilizadas no livro estavam também gravações do programa SOCIEDADE ALTERNATIVA, da Rádio Gazeta AM de São Paulo, com debates sobre:',
    bullets: ['grupos pacifistas', 'astrologia', 'comunidades rurais', 'medicina alternativa', 'imprensa alternativa', 'crise mundial e brasileira', 'rock e costumes'],
  },
} as const

/** Pack A Slide 9. */
export const QUOTE_EXAMPLE_CONTENT = {
  title: 'O retrato não era definitivo',
  intro: 'Décadas depois, outras pesquisas trouxeram contrapontos ao entusiasmo encontrado em descrições daquela época.',
  bullets: ['muitas experiências foram breves', 'dificuldades materiais e pouca experiência agrícola', 'conflitos internos e alta rotatividade'],
  quote: 'Isso não diminui o valor do livro. Muda a forma de lê-lo.',
  callout: 'Além de falar das comunidades, ele registra as expectativas de uma época sobre elas.',
} as const

/** Pack A Slide 10. `brand_label` is filled from the live Project name (like Cover). */
export const CLOSING_EXAMPLE_CONTENT = {
  title: 'Um livro.\nMuitos caminhos\npara seguir.',
  body: [
    'Quatro décadas depois, alguns desses lugares permanecem. Outros mudaram. Outros desapareceram.',
    'E muita memória desse percurso continua espalhada.',
  ],
  items: [
    { icon: 'magazine', label: 'revistas' },
    { icon: 'newspaper', label: 'jornais' },
    { icon: 'bulletin', label: 'boletins mimeografados' },
    { icon: 'tape', label: 'fitas de rádio' },
    { icon: 'book', label: 'livros' },
    { icon: 'photo', label: 'fotografias e cartas' },
  ],
  cta_title: 'Tem algum desses materiais?',
  cta_text: 'Compartilhe com a gente e ajude a preservar essa história!',
  contact: 'memoria@comunidadesalternativas.com.br',
  tagline: 'Memória • Conhecimento • Conexão',
} as const

/** Deep, mutable copy — authored content must never alias the shared examples. */
export function cloneExample<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
