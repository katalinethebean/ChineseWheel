export const MIN_WEIGHT = 1
export const NORMAL_WEIGHT = 10
export const MAX_WEIGHT = 100

// 滑块刻度：左边 30% 是 1–10（减权要精细），右边 70% 是 10–100
export const SLIDER_MAX = 1000
const SPLIT = 0.3

export function posOf(w: number) {
  const f =
    w <= NORMAL_WEIGHT
      ? ((w - MIN_WEIGHT) / (NORMAL_WEIGHT - MIN_WEIGHT)) * SPLIT
      : SPLIT + ((w - NORMAL_WEIGHT) / (MAX_WEIGHT - NORMAL_WEIGHT)) * (1 - SPLIT)
  return Math.round(f * SLIDER_MAX)
}

export function weightAt(pos: number) {
  const f = pos / SLIDER_MAX
  return f <= SPLIT
    ? MIN_WEIGHT + Math.round((f / SPLIT) * (NORMAL_WEIGHT - MIN_WEIGHT))
    : NORMAL_WEIGHT + Math.round(((f - SPLIT) / (1 - SPLIT)) * (MAX_WEIGHT - NORMAL_WEIGHT))
}

export const pct = (w: number) => (posOf(w) / SLIDER_MAX) * 100

