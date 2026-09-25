import { describe, expect, it } from 'vitest'
import { visibleSlideIndexes } from './pagination'

describe('visibleSlideIndexes', () => {
  it('keeps a maximum five-button window around the active slide', () => {
    expect(visibleSlideIndexes(10, 0)).toEqual([0, 1, 2, 3, 4])
    expect(visibleSlideIndexes(10, 4)).toEqual([2, 3, 4, 5, 6])
    expect(visibleSlideIndexes(10, 9)).toEqual([5, 6, 7, 8, 9])
  })

  it('supports a narrower three-button desktop window at the boundary', () => {
    expect(visibleSlideIndexes(10, 0, 3)).toEqual([0, 1, 2])
    expect(visibleSlideIndexes(10, 5, 3)).toEqual([4, 5, 6])
    expect(visibleSlideIndexes(10, 9, 3)).toEqual([7, 8, 9])
  })

  it('keeps the active slide visible and preserves simple numbering', () => {
    for (let current = 0; current < 20; current += 1) {
      const indexes = visibleSlideIndexes(20, current)
      expect(indexes).toContain(current)
      expect(indexes).toEqual(indexes.map((index, position) => indexes[0] + position))
    }
    expect(visibleSlideIndexes(2, 1)).toEqual([0, 1])
    expect(visibleSlideIndexes(0, 0)).toEqual([])
  })
})
