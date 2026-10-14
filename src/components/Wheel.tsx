import { useId } from 'react'
import { layoutArcs, polar } from '../lib/wheel'

// 阳极氧化金属色，和 styles.css 里的 --c1…--c6 一致
const COLORS = ['#d4473a', '#e0a93e', '#2c9a80', '#3a6fc4', '#7656c2', '#d27434']
const TEXT_ON = ['#fff', '#141518', '#fff', '#fff', '#fff', '#fff']

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
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const id = (name: string) => `${name}-${uid}`

  return (
    <div className="wheel">
      <div
        className="wheel-disc"
        style={{
          transform: `rotate(${rotation}deg)`,
          transition: spinning ? `transform ${spinMs}ms cubic-bezier(0.1, 0.65, 0.08, 1)` : 'none',
        }}
      >
        <svg viewBox="-104 -104 208 208" role="img" aria-label="转盘">
          {count === 0 && (
            <>
              <circle r={R} fill="var(--wheel-empty)" />
              <text y={-52} textAnchor="middle" dominantBaseline="central" fontSize={10} fill="var(--muted)">
                {emptyText}
              </text>
            </>
          )}
          {count === 1 && (
            <g className={winnerIndex === 0 ? 'wheel-seg winner' : 'wheel-seg'}>
              <circle r={R} fill={slices[0].color ?? COLORS[0]} />
              {slices[0].label && (
                <text
                  y={-R * 0.6}
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
              const fontSize = Math.max(4.2, Math.min(10.5, ((2 * Math.PI * 62 * seg) / 360) * 0.55))
              return (
                <g key={i} className={winnerIndex === i ? 'wheel-seg winner' : 'wheel-seg'}>
                  <path
                    d={`M0 0 L${x0} ${y0} A${R} ${R} 0 ${seg > 180 ? 1 : 0} 1 ${x1} ${y1} Z`}
                    fill={slice.color ?? fallback.color}
                    stroke="rgba(255,255,255,0.55)"
                    strokeWidth={count > 30 ? 0.3 : 0.6}
                  />
                  {slice.label && (
                    <text
                      transform={`rotate(${flip ? mid + 90 : mid - 90})`}
                      x={flip ? -R * 0.88 : R * 0.88}
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
        </svg>
      </div>

      {/* 不随转盘转动的金属部分：高光、镀铬外圈、中心 logo */}
      <svg className="wheel-overlay" viewBox="-104 -104 208 208" aria-hidden>
        <defs>
          <radialGradient id={id('sheen')} cx="0.32" cy="0.2" r="0.75">
            <stop offset="0" stopColor="#fff" stopOpacity="0.32" />
            <stop offset="0.45" stopColor="#fff" stopOpacity="0.06" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={id('vignette')} r="0.5" cx="0.5" cy="0.5">
            <stop offset="0.82" stopColor="#000" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.22" />
          </radialGradient>
          <linearGradient id={id('chrome')} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fbfcfd" />
            <stop offset="0.22" stopColor="#a8acb3" />
            <stop offset="0.45" stopColor="#f1f2f4" />
            <stop offset="0.62" stopColor="#7c8188" />
            <stop offset="0.8" stopColor="#e4e6e9" />
            <stop offset="1" stopColor="#8e939a" />
          </linearGradient>
          <clipPath id={id('hub')}>
            <circle r={21.5} />
          </clipPath>
        </defs>
        <circle r={R} fill={`url(#${id('sheen')})`} />
        <circle r={R} fill={`url(#${id('vignette')})`} />
        <circle r={101.8} fill="none" stroke={`url(#${id('chrome')})`} strokeWidth={4.6} />
        <circle r={104.1} fill="none" stroke="#2b2d31" strokeWidth={0.7} />
        <circle r={99.4} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth={0.5} />
        <circle r={24.5} fill={`url(#${id('chrome')})`} stroke="#2b2d31" strokeWidth={0.7} />
        <image href="/logo.jpg" x={-21.5} y={-21.5} width={43} height={43} clipPath={`url(#${id('hub')})`} />
      </svg>

      <svg className="wheel-pointer" viewBox="0 0 40 50" aria-hidden>
        <defs>
          <linearGradient id={id('ptr')} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#6b7077" />
            <stop offset="0.42" stopColor="#f6f7f9" />
            <stop offset="0.58" stopColor="#a7abb2" />
            <stop offset="1" stopColor="#40434a" />
          </linearGradient>
        </defs>
        <path d="M3 2 H37 L20 47 Z" fill={`url(#${id('ptr')})`} stroke="#2b2d31" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </div>
  )
}
