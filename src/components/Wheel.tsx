import { layoutArcs, polar } from '../lib/wheel'

// 和 styles.css 里的 --c1…--c6 一致
const COLORS = ['#f25f4c', '#ffc23c', '#2bb58c', '#3d8bfd', '#8f6bef', '#ff8a3d']
const TEXT_ON = ['#fff', '#1e1b2e', '#1e1b2e', '#fff', '#fff', '#1e1b2e']

export const SPIN_MS = 5200

export type Slice = {
  label?: string
  weight: number
  color?: string
  textColor?: string
}

type Props = {
  slices: Slice[]
  rotation: number
  spinning: boolean
  /** 本次转动的时长（学生端中途加入时会更短） */
  spinMs?: number
  winnerIndex?: number | null
  emptyText?: string
}

/** 老师端：每人一个等大的扇区 */
export const equalSlices = (names: string[]): Slice[] => names.map((label) => ({ label, weight: 1 }))

function defaultColor(i: number, count: number) {
  // 避免最后一个扇区和第一个扇区同色
  const ci = count > 1 && i === count - 1 && i % COLORS.length === 0 ? 2 : i % COLORS.length
  return { color: COLORS[ci], textColor: TEXT_ON[ci] }
}

// 中文字占 1 个宽度，英文字母约占一半；超过 6 个宽度就截断
const charWidth = (ch: string) => (/[⺀-￿]/.test(ch) ? 1 : 0.55)

function shorten(name: string, max = 6) {
  let width = 0
  const chars = [...name]
  for (let i = 0; i < chars.length; i++) {
    width += charWidth(chars[i])
    if (width > max) return chars.slice(0, i).join('').trimEnd() + '…'
  }
  return name
}

export function Wheel({ slices, rotation, spinning, spinMs = SPIN_MS, winnerIndex, emptyText = '暂无在场学生' }: Props) {
  const count = slices.length
  const arcs = layoutArcs(slices.map((s) => s.weight))
  const R = 100

  return (
    <div className="wheel">
      <div className="wheel-pointer" aria-hidden />
      <div
        className="wheel-disc"
        style={{
          transform: `rotate(${rotation}deg)`,
          transition: spinning ? `transform ${spinMs}ms cubic-bezier(0.1, 0.65, 0.08, 1)` : 'none',
        }}
      >
        <svg viewBox="-104 -104 208 208" role="img" aria-label="转盘">
          <circle r={104} fill="var(--ink)" />
          {count === 0 && (
            <>
              <circle r={R} fill="var(--wheel-empty)" />
              <text y={-48} textAnchor="middle" dominantBaseline="central" fontSize={11} fill="var(--muted)">
                {emptyText}
              </text>
            </>
          )}
          {count === 1 && (
            <g className={winnerIndex === 0 ? 'wheel-seg winner' : 'wheel-seg'}>
              <circle r={R} fill={slices[0].color ?? COLORS[0]} />
              {slices[0].label && (
                <text
                  y={-R * 0.55}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={14}
                  fill={slices[0].textColor ?? '#fff'}
                  fontWeight={700}
                >
                  {shorten(slices[0].label)}
                </text>
              )}
            </g>
          )}
          {count > 1 &&
            slices.map((slice, i) => {
              const { start, end } = arcs[i]
              const seg = end - start
              const [x0, y0] = polar(start, R)
              const [x1, y1] = polar(end, R)
              const fallback = defaultColor(i, count)
              const mid = start + seg / 2
              // 左半边的文字翻转 180°，保证名字不会倒着读
              const flip = mid > 180
              const fontSize = Math.max(4.2, Math.min(11, ((2 * Math.PI * 62 * seg) / 360) * 0.55))
              return (
                <g key={i} className={winnerIndex === i ? 'wheel-seg winner' : 'wheel-seg'}>
                  <path
                    d={`M0 0 L${x0} ${y0} A${R} ${R} 0 ${seg > 180 ? 1 : 0} 1 ${x1} ${y1} Z`}
                    fill={slice.color ?? fallback.color}
                    stroke="#fff"
                    strokeWidth={count > 30 ? 0.4 : 0.9}
                    strokeLinejoin="round"
                  />
                  {slice.label && (
                    <text
                      transform={`rotate(${flip ? mid + 90 : mid - 90})`}
                      x={flip ? -R * 0.9 : R * 0.9}
                      textAnchor={flip ? 'start' : 'end'}
                      dominantBaseline="central"
                      fontSize={fontSize}
                      fontWeight={700}
                      fill={slice.textColor ?? fallback.textColor}
                    >
                      {shorten(slice.label)}
                    </text>
                  )}
                </g>
              )
            })}
          <circle r={14} fill="#fff" stroke="var(--ink)" strokeWidth={3} />
          <circle r={4.5} fill="var(--ink)" />
        </svg>
      </div>
    </div>
  )
}
