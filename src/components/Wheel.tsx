import { polar } from '../lib/wheel'

const COLORS = ['#d9483b', '#e9b949', '#3f8f7a', '#3a6ea5', '#c4677d', '#7a8b3a']
const TEXT_ON = ['#fff', '#2b2a33', '#fff', '#fff', '#fff', '#fff']

export const SPIN_MS = 5200

type Props = {
  names: string[]
  rotation: number
  spinning: boolean
  winnerIndex?: number | null
}

function colorIndex(i: number, count: number) {
  // 避免最后一个扇区和第一个扇区同色
  if (count > 1 && i === count - 1 && i % COLORS.length === 0) return 2
  return i % COLORS.length
}

function shorten(name: string) {
  return [...name].length > 6 ? [...name].slice(0, 5).join('') + '…' : name
}

export function Wheel({ names, rotation, spinning, winnerIndex }: Props) {
  const count = names.length
  const seg = count > 0 ? 360 / count : 360
  const R = 100
  const fontSize = Math.max(4.2, Math.min(11, (2 * Math.PI * 62) / Math.max(count, 1) * 0.55))

  return (
    <div className="wheel">
      <div className="wheel-pointer" aria-hidden />
      <div
        className="wheel-disc"
        style={{
          transform: `rotate(${rotation}deg)`,
          transition: spinning ? `transform ${SPIN_MS}ms cubic-bezier(0.1, 0.65, 0.08, 1)` : 'none',
        }}
      >
        <svg viewBox="-104 -104 208 208" role="img" aria-label="转盘">
          <circle r={103} fill="var(--ink)" />
          {count === 0 && (
            <>
              <circle r={R} fill="var(--paper-2)" />
              <text textAnchor="middle" dominantBaseline="central" fontSize={10} fill="var(--muted)">
                暂无在场学生
              </text>
            </>
          )}
          {count === 1 && (
            <g>
              <circle r={R} fill={COLORS[0]} />
              <text y={-R * 0.55} textAnchor="middle" dominantBaseline="central" fontSize={14} fill="#fff" fontWeight={700}>
                {shorten(names[0])}
              </text>
            </g>
          )}
          {count > 1 &&
            names.map((name, i) => {
              const a0 = i * seg
              const a1 = (i + 1) * seg
              const [x0, y0] = polar(a0, R)
              const [x1, y1] = polar(a1, R)
              const ci = colorIndex(i, count)
              const mid = a0 + seg / 2
              const isWinner = winnerIndex === i
              return (
                <g key={i} className={isWinner ? 'wheel-seg winner' : 'wheel-seg'}>
                  <path
                    d={`M0 0 L${x0} ${y0} A${R} ${R} 0 ${seg > 180 ? 1 : 0} 1 ${x1} ${y1} Z`}
                    fill={COLORS[ci]}
                    stroke="var(--ink)"
                    strokeWidth={count > 30 ? 0.3 : 0.6}
                  />
                  <text
                    transform={`rotate(${mid - 90})`}
                    x={R * 0.9}
                    textAnchor="end"
                    dominantBaseline="central"
                    fontSize={fontSize}
                    fontWeight={700}
                    fill={TEXT_ON[ci]}
                  >
                    {shorten(name)}
                  </text>
                </g>
              )
            })}
          <circle r={13} fill="var(--ink)" />
          <circle r={5} fill="var(--paper)" />
        </svg>
      </div>
    </div>
  )
}
