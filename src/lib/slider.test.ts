import { describe, expect, it } from 'vitest'
import { MAX_WEIGHT, MIN_WEIGHT, NORMAL_WEIGHT, SLIDER_MAX, posOf, weightAt } from './slider'

describe('权重滑块刻度', () => {
  it('每个权重都能精确拖到，位置换算回来不变', () => {
    for (let w = MIN_WEIGHT; w <= MAX_WEIGHT; w++) expect(weightAt(posOf(w))).toBe(w)
  })
  it('两端和「平时」的位置', () => {
    expect(posOf(MIN_WEIGHT)).toBe(0)
    expect(posOf(NORMAL_WEIGHT)).toBe(SLIDER_MAX * 0.3)
    expect(posOf(MAX_WEIGHT)).toBe(SLIDER_MAX)
  })
  it('拖动时权重单调不减', () => {
    let prev = 0
    for (let p = 0; p <= SLIDER_MAX; p++) {
      const w = weightAt(p)
      expect(w).toBeGreaterThanOrEqual(prev)
      prev = w
    }
  })
})
