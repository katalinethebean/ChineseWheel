// 转盘几何：角度从正上方（指针位置）开始，顺时针增加。
// 扇区 i 覆盖转盘自身坐标中的 [i * seg, (i + 1) * seg)。
// 转盘顺时针转过 rotation 度后，指针下方是转盘坐标中的 (-rotation) 度。

const mod360 = (a: number) => ((a % 360) + 360) % 360

export function pointerIndex(rotation: number, count: number): number {
  const seg = 360 / count
  return Math.floor(mod360(-rotation) / seg) % count
}

/**
 * 计算让指针停在第 index 个扇区的最终旋转角度。
 * jitter ∈ [0, 1)：在扇区内的随机落点，避免每次都停在正中间。
 */
export function targetRotation(
  current: number,
  count: number,
  index: number,
  { spins = 6, jitter = Math.random() } = {},
): number {
  const seg = 360 / count
  const landing = index * seg + seg / 2 + (jitter - 0.5) * seg * 0.7
  const delta = mod360(mod360(-landing) - mod360(current))
  return current + spins * 360 + delta
}

/** 极坐标（角度从正上方顺时针）→ SVG 坐标 */
export function polar(angleDeg: number, r: number): [number, number] {
  const a = (angleDeg * Math.PI) / 180
  return [r * Math.sin(a), -r * Math.cos(a)]
}
