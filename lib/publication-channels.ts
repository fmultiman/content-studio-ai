// Valores canônicos de canal e formato para ChannelPiece.
// Estes arrays são a fonte de verdade em runtime — usados pela API em P2
// para validar os campos channel e format antes de persistir no banco.
//
// Os tipos PublicationChannel e PublicationFormat em lib/types.ts devem
// permanecer sincronizados com estes arrays. O banco aplica o mesmo conjunto
// via CHECK constraint (scripts/021_create_publication_entities.sql).
//
// A validade da combinação channel × format não é imposta pelo banco —
// é responsabilidade da API (P2). Use isValidChannelFormat() para isso.

import type { PublicationChannel, PublicationFormat } from '@/lib/types'

export const PUBLICATION_CHANNELS: PublicationChannel[] = [
  'instagram',
  'youtube',
  'whatsapp',
  'linkedin',
  'x',
  'tiktok',
]

export const PUBLICATION_FORMATS: PublicationFormat[] = [
  'feed',
  'story',
  'reel',
  'short',
  'video_description',
  'post',
  'channel_message',
  'carousel',
  'article',
]

// Combinações válidas de channel × format.
// Chave: 'channel:format'. Valor: true.
// Novos canais e formatos exigem: (1) migration no banco, (2) atualização dos
// tipos em lib/types.ts, (3) adição à constante correspondente acima, e (4)
// adição das combinações válidas neste Set.
const VALID_COMBINATIONS = new Set<string>([
  // Instagram
  'instagram:feed',
  'instagram:story',
  'instagram:reel',
  'instagram:carousel',

  // YouTube
  'youtube:video_description',
  'youtube:short',
  'youtube:post',

  // WhatsApp
  'whatsapp:story',
  'whatsapp:channel_message',

  // LinkedIn
  'linkedin:feed',
  'linkedin:post',
  'linkedin:carousel',
  'linkedin:article',

  // X (Twitter)
  'x:post',

  // TikTok
  'tiktok:reel',
])

export function isValidChannelFormat(channel: string, format: string): boolean {
  return VALID_COMBINATIONS.has(`${channel}:${format}`)
}

export function isValidChannel(value: string): value is PublicationChannel {
  return PUBLICATION_CHANNELS.includes(value as PublicationChannel)
}

export function isValidFormat(value: string): value is PublicationFormat {
  return PUBLICATION_FORMATS.includes(value as PublicationFormat)
}
