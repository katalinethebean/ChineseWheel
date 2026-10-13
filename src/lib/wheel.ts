// 转盘几何：角度从正上方（指针位置）开始，顺时针增加。
// 转盘顺时针转过 rotation 度后，指针下方是转盘坐标中的 (-rotation) 度。

export type Arc = { start: number; end: number }

const mod360 = (a: number) => ((a % 360) + 360) % 360

/** 按权重把 360° 分成连续的扇区 */
export function layoutArcs(weights: number[]): Arc[] {
  const total = weights.reduce((a, b) => a + b, 0)
  let at = 0
  return weights.map((w) => {
    const start = at
    at += total > 0 ? (w / total) * 360 : 360 / weights.length
    return { start, end: at }
  })
}

/** 指针当前指向哪个扇区 */
export function arcIndexAt(rotation: number, arcs: Arc[]): number {
  const a = mod360(-rotation)
  const i = arcs.findIndex((arc) => a >= arc.start && a < arc.end)
  return i === -1 ? arcs.length - 1 : i
}

/**
 * 计算让指针停在 arc 扇区内的最终旋转角度（至少转 spins 圈）。
 * jitter ∈ [0, 1)：在扇区内的随机落点，避开边缘。
 */
export function targetRotationInArc(
  current: number,
  arc: Arc,
  { spins = 6, jitter = Math.random() } = {},
): number {
  const width = arc.end - arc.start
  const landing = arc.start + width / 2 + (jitter - 0.5) * width * 0.7
  const delta = mod360(mod360(-landing) - mod360(current))
  return current + spins * 360 + delta
}

/** 等大扇区的版本 */
export function pointerIndex(rotation: number, count: number): number {
  return arcIndexAt(rotation, layoutArcs(Array(count).fill(1)))
}

export function targetRotation(current: number, count: number, index: number, opts?: { spins?: number; jitter?: number }) {
  const seg = 360 / count
  return targetRotationInArc(current, { start: index * seg, end: (index + 1) * seg }, opts)
}

/** 极坐标（角度从正上方顺时针）→ SVG 坐标 */
export function polar(angleDeg: number, r: number): [number, number] {
  const a = (angleDeg * Math.PI) / 180
  return [r * Math.sin(a), -r * Math.cos(a)]
}
