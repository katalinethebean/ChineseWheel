import { describe, expect, it } from 'vitest'
import { pointerIndex, targetRotation } from './wheel'

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
