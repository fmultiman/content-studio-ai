/** The bounded page-number window used by the Static Carousel toolbar. */
export function visibleSlideIndexes(total: number, current: number, maxVisible = 5): number[] {
  const count = Math.max(0, Math.floor(total))
  if (count === 0) return []
  const windowSize = Math.max(1, Math.min(count, Math.floor(maxVisible)))
  const active = Math.max(0, Math.min(count - 1, Math.floor(current)))
  const half = Math.floor(windowSize / 2)
  const start = Math.max(0, Math.min(count - windowSize, active - half))
  return Array.from({ length: windowSize }, (_, offset) => start + offset)
}

