import { describe, expect, it } from 'vitest'
import { arcIndexAt, layoutArcs, pointerIndex, targetRotation, targetRotationInArc } from './wheel'

describe('targetRotation', () => {
  it('指针总是停在目标扇区，并且至少转满指定圈数', () => {
    for (let trial = 0; trial < 2000; trial++) {
      const count = 1 + Math.floor(Math.random() * 45)
      const index = Math.floor(Math.random() * count)
      const current = (Math.random() - 0.5) * 10000
      const jitter = Math.random()
      const r = targetRotation(current, count, index, { spins: 6, jitter })
      expect(pointerIndex(r, count)).toBe(index)
      expect(r).toBeGreaterThanOrEqual(current + 6 * 360)
      expect(r).toBeLessThan(current + 7 * 360)
    }
  })

  it('扇区边缘的抖动也不会越界', () => {
    for (const jitter of [0, 0.999999]) {
      for (let index = 0; index < 7; index++) {
        expect(pointerIndex(targetRotation(123, 7, index, { jitter }), 7)).toBe(index)
      }
    }
  })
})

describe('pointerIndex', () => {
  it('未旋转时指针指向第 0 个扇区', () => {
    expect(pointerIndex(0, 4)).toBe(0)
  })
  it('顺时针转 90 度时，4 个扇区中指针指向第 3 个', () => {
    expect(pointerIndex(90, 4)).toBe(3)
  })
})

describe('不等大扇区', () => {
  it('layoutArcs 按权重分配角度', () => {
    expect(layoutArcs([1, 3])).toEqual([
      { start: 0, end: 90 },
      { start: 90, end: 360 },
    ])
  })

  it('指针总是停在目标扇区内，哪怕扇区很小', () => {
    for (let trial = 0; trial < 2000; trial++) {
      const weights = Array.from({ length: 1 + Math.floor(Math.random() * 30) }, () => 1 + Math.floor(Math.random() * 25))
      const arcs = layoutArcs(weights)
      const index = Math.floor(Math.random() * arcs.length)
      const current = (Math.random() - 0.5) * 10000
      const r = targetRotationInArc(current, arcs[index], { spins: 3, jitter: Math.random() })
      expect(arcIndexAt(r, arcs)).toBe(index)
      expect(r).toBeGreaterThanOrEqual(current + 3 * 360)
    }
  })
})
