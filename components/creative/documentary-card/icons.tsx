import type { ReactNode } from 'react'
import type { DocumentaryCardIcon } from '@/lib/schemas/creative/documentary-card'

/**
 * The closed, code-drawn icon set (DOCUMENTARY_CARD_ICONS): simple line
 * drawings on a 48px grid, stroked in the caller's ink so they follow the
 * appearance. Renderer-shared (Editor preview + VPS worker).
 */
const DRAWINGS: Record<DocumentaryCardIcon, (thin: { strokeWidth: number }) => ReactNode> = {
  microphone: (thin) => <>
    <rect x="17" y="5" width="14" height="23" rx="7" />
    <path d="M20 11h8M20 16h8M20 21h8" {...thin} />
    <path d="M11 22c0 8 6 13 13 13s13-5 13-13M24 35v7M16 43h16" />
  </>,
  pencil: () => <path d="M33 6l9 9-24 24-12 3 3-12zM28 11l9 9M9 30l9 9" />,
  book: (thin) => <>
    <path d="M24 13c-5-4-12-5-19-4v27c7-1 14 0 19 4 5-4 12-5 19-4V9c-7-1-14 0-19 4zM24 13v27" />
    <path d="M9 16c4 0 8 1 11 3M9 22c4 0 8 1 11 3M28 19c3-2 7-3 11-3M28 25c3-2 7-3 11-3" {...thin} />
  </>,
  dot: () => <circle cx="24" cy="24" r="8" fill="currentColor" />,
  nuclear: () => <path d="M14 20c-4 0-6-3-5-6 1-4 5-5 8-3 1-4 5-6 9-5 4 1 6 4 6 7 3-1 7 1 7 5 0 3-3 5-6 4H14zM20 20v4h8v-4M22 24l-3 12M26 24l3 12M12 38h24M16 36c2-2 5-3 8-3s6 1 8 3" />,
  globe: (thin) => <>
    <circle cx="24" cy="24" r="17" />
    <path d="M24 7v34M7 24h34M11 14c8 4 18 4 26 0M11 34c8-4 18-4 26 0" {...thin} />
    <circle cx="24" cy="24" r="3" fill="currentColor" />
  </>,
  factory: (thin) => <>
    <path d="M6 41V24l9-6v6l9-6v6l9-6v23zM33 18V7h6v34" />
    <path d="M11 30h4v5h-4zM20 30h4v5h-4zM29 30h4v5h-4z" {...thin} />
    <path d="M4 41h40" />
  </>,
  cart: () => <path d="M5 8h6l5 22h22l4-15H13M18 30l-2 5h24M19 41a2 2 0 1 0 0-.1M36 41a2 2 0 1 0 0-.1M21 20l4 4 4-4M31 20l3 3" />,
  leaf: () => <path d="M24 42V22M24 30c-9 0-15-6-15-16 10 0 15 6 15 16zM24 26c8 0 14-6 14-14-9 0-14 5-14 14z" />,
  tree: (thin) => <>
    <path d="M24 42V24M24 30l-6-4M24 28l6-4M14 22c-4-1-6-4-5-8 1-3 4-5 7-4 1-4 5-6 9-5 4 1 6 4 6 7 4 0 6 3 6 6s-3 5-6 5H16" />
    <path d="M4 42c8-4 14-5 20-5s12 1 20 5" {...thin} />
  </>,
  buildings: (thin) => <>
    <path d="M6 42V18h11v24M17 42V6h13v36M30 42V22h12v20M3 42h42" />
    <path d="M10 23h3M10 29h3M10 35h3M21 11h5M21 17h5M21 23h5M21 29h5M21 35h5M34 27h4M34 33h4" {...thin} />
  </>,
  harvest: (thin) => <>
    <path d="M24 30V10M24 16c-4 0-7-3-7-7 4 0 7 3 7 7zM24 16c4 0 7-3 7-7-4 0-7 3-7 7zM12 30v-8M12 24c-3 0-5-2-5-5 3 0 5 2 5 5zM36 30v-8M36 24c3 0 5-2 5-5-3 0-5 2-5 5z" />
    <path d="M4 34h40M8 40c2-4 6-6 8-6s6 2 8 6M24 40c2-4 6-6 8-6s6 2 8 6" {...thin} />
  </>,
  house: (thin) => <>
    <path d="M6 22L24 7l18 15M10 19v23h28V19M20 42V30h8v12" />
    <path d="M31 12V7h5v9M31 27h4v4h-4z" {...thin} />
  </>,
  star: () => <path d="M24 4l4 12 12-4-7 11 11 5-12 3 3 12-11-7-11 7 3-12-12-3 11-5-7-11 12 4zM24 18c-3 4-3 8 0 12 3-4 3-8 0-12z" />,
  people: () => <path d="M24 12a5 5 0 1 0 0-.1M13 17a4 4 0 1 0 0-.1M35 17a4 4 0 1 0 0-.1M17 42V28c0-4 3-7 7-7s7 3 7 7v14M7 42V31c0-3 2-6 6-6 2 0 3 1 4 2M41 42V31c0-3-2-6-6-6-2 0-3 1-4 2" />,
  consensus: (thin) => <>
    <path d="M24 6l3 5 6-1 1 6 5 3-3 5 3 5-5 3-1 6-6-1-3 5-3-5-6 1-1-6-5-3 3-5-3-5 5-3 1-6 6 1z" />
    <circle cx="24" cy="24" r="5" {...thin} />
  </>,
  gear: (thin) => <>
    <path d="M21 5h6l1 5 4 2 5-3 4 4-3 5 2 4 5 1v6l-5 1-2 4 3 5-4 4-5-3-4 2-1 5h-6l-1-5-4-2-5 3-4-4 3-5-2-4-5-1v-6l5-1 2-4-3-5 4-4 5 3 4-2z" />
    <circle cx="24" cy="24" r="7" {...thin} />
  </>,
  community: (thin) => <>
    <circle cx="24" cy="24" r="19" />
    <path d="M24 17a4 4 0 1 0 0-.1M15 22a3 3 0 1 0 0-.1M33 22a3 3 0 1 0 0-.1M18 35v-4c0-3 3-6 6-6s6 3 6 6v4M10 33v-3c0-2 2-4 5-4M38 33v-3c0-2-2-4-5-4" {...thin} />
  </>,
  lock: () => <path d="M14 22v-7a10 10 0 0 1 20 0v7M11 22h26v20H11zM24 29a3 3 0 1 0 0 .1M24 32v5" />,
  sprout: () => <path d="M24 42V20M24 26c-8 0-12-5-12-12 8 0 12 5 12 12zM24 22c7 0 11-5 11-11-7 0-11 4-11 11zM14 42h20" />,
  radio: (thin) => <>
    <path d="M6 18h36v22H6zM12 18L34 8" />
    <circle cx="16" cy="31" r="5" /><circle cx="32" cy="31" r="5" />
    <path d="M22 23h4M36 22h2" {...thin} />
  </>,
  magazine: (thin) => <>
    <path d="M10 6h24l4 4v32H10zM34 6v4h4" />
    <path d="M15 14h14M15 34h18M18 30c2-6 5-10 9-12-1 5-4 9-9 12z" {...thin} />
  </>,
  newspaper: (thin) => <>
    <path d="M8 8h26v34H12a4 4 0 0 1-4-4zM34 16h6v22a4 4 0 0 1-4 4h-2" />
    <path d="M13 14h16M13 20h16M13 25h16M13 30h16M13 35h10" {...thin} />
  </>,
  bulletin: (thin) => <>
    <path d="M11 5h19l8 8v30H11zM30 5v8h8" />
    <path d="M16 19h17M16 24h17M16 29h17M16 34h12" {...thin} />
  </>,
  tape: (thin) => <>
    <path d="M5 12h38v26H5z" />
    <circle cx="16" cy="24" r="5" /><circle cx="32" cy="24" r="5" />
    <path d="M16 29h16M12 38l3-5h18l3 5" {...thin} />
  </>,
  photo: (thin) => <>
    <path d="M6 10h36v28H6z" />
    <path d="M6 32l10-10 8 8 6-6 12 12M33 18a3 3 0 1 0 0-.1" {...thin} />
    <path d="M12 42h30V16" {...thin} />
  </>,
  envelope: () => <path d="M5 13h38v24H5zM5 13l19 14 19-14M5 37l14-12M43 37L29 25" />,
}

export function DocumentaryIcon({ icon, color, size, strokeWidth = 2.4 }: { icon: DocumentaryCardIcon; color: string; size: number; strokeWidth?: number }) {
  const draw = DRAWINGS[icon] ?? DRAWINGS.dot
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" width={size} height={size} style={{ color, flexShrink: 0 }} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth}>
      {draw({ strokeWidth: strokeWidth * 0.62 })}
    </svg>
  )
}
