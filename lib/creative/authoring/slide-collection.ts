/**
 * Authored slide collection operations (Static Detail Polish V1 — Remove Slide).
 *
 * Pure: they only reshape the in-memory authored collection. Stable slide ids
 * are never renumbered or reused; `order` is normalized to 0..n-1 so the visible
 * sequence (1 2 3 …) follows the new position. Durable outputs (LibraryFile,
 * ChannelPieceMedia, render executions, Gallery media) are out of scope here and
 * are never touched by removing a slide.
 */

export type OrderedSlide = { id: string; order: number }

export type RemoveSlideResult<T extends OrderedSlide> = {
  slides: T[]
  /** The slide to select next: the one now at the same position, else the new last one. */
  selectedIndex: number
  removedId: string | null
}

/** Removes the slide at `index`. The last remaining slide can never be removed. */
export function removeSlideFromCollection<T extends OrderedSlide>(slides: readonly T[], index: number): RemoveSlideResult<T> {
  if (slides.length <= 1 || index < 0 || index >= slides.length) {
    return { slides: [...slides], selectedIndex: Math.min(Math.max(index, 0), Math.max(slides.length - 1, 0)), removedId: null }
  }
  const removedId = slides[index].id
  const remaining = slides.filter((_, position) => position !== index).map((slide, order) => ({ ...slide, order }))
  return { slides: remaining, selectedIndex: Math.min(index, remaining.length - 1), removedId }
}

/** Visible page label: the number only ("3"); the total lives in accessible names and render metadata. */
export function slidePageNumber(index: number): string {
  return String(index + 1)
}

/** Accessible name for a slide/page position, e.g. "Slide 3 de 10". */
export function slideAccessibleLabel(index: number, total: number, noun: 'Slide' | 'Página' = 'Slide'): string {
  return `${noun} ${index + 1} de ${total}`
}
