import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link, useParams } from 'react-router-dom'
import { SPIN_MS, Wheel, type Slice } from '../components/Wheel'
import { usePolling } from '../lib/hooks'
import { errorText, rpc, supabase } from '../lib/supabase'
import type { StudentState } from '../lib/types'
import { MIN_WEIGHT, NORMAL_WEIGHT, SLIDER_MAX, pct, posOf, weightAt } from '../lib/slider'
import { layoutArcs, targetRotationInArc } from '../lib/wheel'
import { StudentShell } from '../components/StudentShell'

type RosterEntry = { id: string; name: string; claimed: boolean }

// 每个班级分开记住身份
const tokenKey = (code: string) => `wheel_token_${code}`

function readToken(code: string): string | null {
  try {
    return localStorage.getItem(tokenKey(code))
  } catch {
    return null
  }
}

function writeToken(code: string, token: string | null) {
  try {
    if (token) localStorage.setItem(tokenKey(code), token)
    else localStorage.removeItem(tokenKey(code))
  } catch {
    // 隐私模式下可能无法保存，只是下次需要重新选名字
  }
}

export function Student() {
  const code = (useParams().code ?? '').toUpperCase()
  const [token, setToken] = useState<string | null>(() => readToken(code))

  if (!token) {
    return (
      <PickName
        code={code}
        onClaimed={(t) => {
          writeToken(code, t)
          setToken(t)
        }}
      />
    )
  }
  return (
    <StudentView
      token={token}
      onInvalid={() => {
        writeToken(code, null)
        setToken(null)
      }}
    />
  )
}

function PickName({ code, onClaimed }: { code: string; onClaimed: (token: string) => void }) {
  const [roster, setRoster] = useState<RosterEntry[] | null | undefined>(undefined)
  const [className, setClassName] = useState('')
  const [chosen, setChosen] = useState<{ id: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const cls = await rpc<{ name: string } | null>('class_by_code', { p_code: code })
      if (!cls) return setRoster(null)
      setClassName(cls.name)
      setRoster(await rpc<RosterEntry[]>('class_roster', { p_code: code }))
    } catch (e) {
      setError(errorText(e))
    }
  }, [code])

  useEffect(() => {
    load()
  }, [load])

  async function confirm() {
    if (!chosen) return
    setBusy(true)
    setError('')
    try {
      onClaimed(await rpc<string>('claim_student', { p_student_id: chosen.id }))
    } catch (e) {
      setError(errorText(e))
      setChosen(null)
      load()
    } finally {
      setBusy(false)
    }
  }

  if (roster === undefined) return <StudentShell>{error && <p className="error">{error}</p>}</StudentShell>
  if (roster === null)
    return (
      <StudentShell center>
        <div className="pick narrow">
          <h1>没有这个班级</h1>
          <Link className="btn lg" to="/student">
            重新输入班级码
          </Link>
        </div>
      </StudentShell>
    )

  return (
    <StudentShell title={className}>
      <div className="pick">
        <h1>你是谁？</h1>
        {error && <p className="error">{error}</p>}
        {roster.length === 0 ? (
          <p className="muted">老师还没添加名单</p>
        ) : (
          <div className="name-grid">
            {roster.map((s) => (
              <button
                key={s.id}
                className={chosen?.id === s.id ? 'name-btn selected' : 'name-btn'}
                disabled={s.claimed || busy}
                onClick={() => setChosen({ id: s.id, name: s.name })}
              >
                {s.name}
                {s.claimed && <span className="taken">已选</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={chosen ? 'pick-confirm show' : 'pick-confirm'}>
        <button className="btn primary lg block" onClick={confirm} disabled={!chosen || busy}>
          我是 {chosen?.name ?? '…'}
        </button>
      </div>
    </StudentShell>
  )
}

const EARN_STEP = 5 // 加权被抽中：每 5 赚 1 个 credit
const ME_COLOR = '#e9473b'
const OTHER_COLORS = ['#f4ecea', '#e9dedb']

function StudentView({ token, onInvalid }: { token: string; onInvalid: () => void }) {
  const [state, setState] = useState<StudentState | null>(null)
  const [weight, setWeight] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [rotation, setRotation] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const [spinMs, setSpinMs] = useState(SPIN_MS)
  const [landedIndex, setLandedIndex] = useState<number | null>(null)
  const [revealAt, setRevealAt] = useState(0)
  const [showRules, setShowRules] = useState(false)
  const [, forceTick] = useState(0)
  const latestAdjust = useRef(0)
  const animatedFor = useRef<string | null>(null)
  const sendTimer = useRef<number | undefined>(undefined)
  const lastOthers = useRef<{ id: string; weights: number[] } | null>(null)
  const pokeRef = useRef<() => void>(() => {})
  const onInvalidRef = useRef(onInvalid)
  onInvalidRef.current = onInvalid

  const q = state?.valid ? state.question : null

  const load = useCallback(async () => {
    try {
      const s = await rpc<StudentState>('student_state', { p_token: token })
      if (!s.valid) return onInvalidRef.current()
      setState(s)
      setError('')
    } catch (e) {
      setError(errorText(e))
    }
  }, [token])

  // 出题期间刷新快一点，这样别人调整后自己的扇区大小能及时更新
  usePolling(load, q?.status === 'open' ? 1500 : 4000)

  // 题目变化时，用服务器的权重重置本地显示
  useEffect(() => {
    setWeight(q ? q.weight : null)
  }, [q?.id, q?.status])

  // 题目换了或结束了：丢掉还没发出的权重
  useEffect(() => () => window.clearTimeout(sendTimer.current), [q?.id, q?.status])

  // 实时推送：老师开题 / 转盘时立刻刷新（只听本节课的题目）
  const lessonId = state?.valid ? state.lesson_id : null
  useEffect(() => {
    if (!lessonId) return
    const channel = supabase
      .channel(`questions-${lessonId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'questions', filter: `lesson_id=eq.${lessonId}` },
        () => load(),
      )
      // 有人调了权重：广播一下，其他学生立刻刷新
      .on('broadcast', { event: 'weight' }, () => load())
      .subscribe()
    pokeRef.current = () => channel.send({ type: 'broadcast', event: 'weight', payload: {} })
    return () => {
      pokeRef.current = () => {}
      supabase.removeChannel(channel)
    }
  }, [load, lessonId])

  // 转盘的扇区：每个人按真实占比；其他人灰色、没有名字。转盘后沿用出题时最后看到的大小
  const myWeight = weight ?? q?.weight ?? 10
  if (q?.other_weights) lastOthers.current = { id: q.id, weights: q.other_weights }
  const othersCount = q ? q.candidate_count - (q.is_candidate ? 1 : 0) : 0
  const othersTotal = q ? q.total_weight - (q.is_candidate ? q.weight : 0) : 0
  const known = q && lastOthers.current?.id === q.id ? lastOthers.current.weights : null
  const otherWeights =
    known && known.length === othersCount ? known : Array.from({ length: othersCount }, () => othersTotal / othersCount)
  const slices: Slice[] = []
  if (q && state?.valid) {
    if (q.is_candidate) {
      slices.push({ label: state.student_name, weight: myWeight, color: ME_COLOR, textColor: '#fff' })
    }
    otherWeights.forEach((w, i) => slices.push({ weight: w, color: OTHER_COLORS[i % 2] }))
  }
  const chance = q?.is_candidate ? myWeight / (othersTotal + myWeight) : 0

  // 老师转盘后，学生端同步转动，停在和结果一致的位置
  useEffect(() => {
    if (!q || q.status !== 'spun' || animatedFor.current === q.id || slices.length === 0) return
    animatedFor.current = q.id
    const arcs = layoutArcs(slices.map((sl) => sl.weight))
    const firstOther = q.is_candidate ? 1 : 0
    const index =
      q.is_me && q.is_candidate ? 0 : firstOther + Math.floor(Math.random() * (arcs.length - firstOther))
    const remaining = SPIN_MS - (q.seconds_since_spin ?? 999) * 1000
    setLandedIndex(index)
    if (remaining > 800) {
      setSpinMs(remaining)
      setSpinning(true)
      setRotation((cur) => targetRotationInArc(cur, arcs[index], { spins: Math.max(2, Math.round((6 * remaining) / SPIN_MS)) }))
      setRevealAt(Date.now() + remaining)
      window.setTimeout(() => setSpinning(false), remaining + 50)
    } else {
      setRotation((cur) => targetRotationInArc(cur, arcs[index], { spins: 0 }))
      setRevealAt(0)
    }
  }, [q?.id, q?.status, slices.length])

  // 揭晓倒计时
  useEffect(() => {
    const wait = revealAt - Date.now()
    if (wait <= 0) return
    const id = window.setTimeout(() => forceTick((n) => n + 1), wait + 50)
    return () => window.clearTimeout(id)
  }, [revealAt])

  // 拖动滑块时立即更新显示，停下 200ms 后再发给服务器
  function changeWeight(w: number) {
    if (!q || !q.is_candidate) return
    w = Math.max(q.min_weight, w)  // credits 不够时不能再往下拉
    const questionId = q.id
    setWeight(w)
    window.clearTimeout(sendTimer.current)
    sendTimer.current = window.setTimeout(async () => {
      const ticket = ++latestAdjust.current
      try {
        const saved = await rpc<number>('set_weight', { p_token: token, p_question_id: questionId, p_weight: w })
        if (ticket === latestAdjust.current) setWeight(saved)
        pokeRef.current()
      } catch (e) {
        setError(errorText(e))
        load()
      }
    }, 120)
  }

  if (!state?.valid) return <StudentShell>{error && <p className="error">{error}</p>}</StudentShell>

  const revealed = Date.now() >= revealAt
  const blocked = q?.status === 'open' && q.is_candidate && myWeight <= q.min_weight && q.min_weight > MIN_WEIGHT

  return (
    <StudentShell
      title={state.class_name}
      center={!state.lesson_active || !q}
      right={
        <>
          <div className="student-rules-wrap">
            <button
              className="student-info"
              type="button"
              aria-label="查看 credits 规则"
              aria-expanded={showRules}
              onClick={() => setShowRules((open) => !open)}
            >
              i
            </button>
            {showRules && (
              <div className="student-rules" role="dialog" aria-label="Credits 规则">
                <button className="student-rules-close" type="button" aria-label="关闭规则" onClick={() => setShowRules(false)}>×</button>
                <strong>Credits 规则</strong>
                <p>权重低于平时（10）：每减少 1，消耗 1 credit。</p>
                <p>被抽中：每增加 5 权重，获得 1 credit。</p>
                <p>没被抽中：增加 10 权重，获得 1 credit；此后每再增加 20，获得 1 credit。</p>
                <p className="muted">转盘结束后结算。</p>
              </div>
            )}
          </div>
          <span className="me">{state.student_name}</span>
          <CreditsBadge
            credits={state.credits}
            pending={q?.status === 'open' && q.is_candidate ? creditChange(myWeight - NORMAL_WEIGHT) : null}
          />
        </>
      }
    >
      {!state.lesson_active || !q ? (
        <div className="waiting">
          <p>
            等老师出题<span className="dots" aria-hidden />
          </p>
        </div>
      ) : (
        <div className="play">
          <div className="play-wheel">
            <Wheel
              slices={slices}
              rotation={rotation}
              spinning={spinning}
              spinMs={spinMs}
              winnerIndex={q.status === 'spun' && revealed ? landedIndex : null}
              emptyText=""
            />
          </div>
          <div className="play-panel">
            {q.status === 'open' ? (
              <>
                <div className="chance" aria-live="polite">
                  {q.is_candidate ? (
                    <>
                      <span className="chance-num">{formatChance(chance)}</span>
                      <span className="chance-label">被抽中概率</span>
                    </>
                  ) : (
                    <span className="chance-label">这题你不在转盘上</span>
                  )}
                </div>

                <div className="slider">
                  <input
                    type="range"
                    min={0}
                    max={SLIDER_MAX}
                    step={1}
                    value={posOf(myWeight)}
                    onChange={(e) => changeWeight(weightAt(Number(e.target.value)))}
                    disabled={!q.is_candidate}
                    aria-label="我的权重"
                    aria-valuetext={`权重 ${myWeight}`}
                    style={{ '--fill': `${pct(myWeight)}%`, '--lock': `${pct(q.min_weight)}%` } as CSSProperties}
                  />
                  <div className="slider-labels">
                    <span>不想答</span>
                    <button
                      className="slider-normal"
                      style={{ left: `${pct(NORMAL_WEIGHT)}%` }}
                      onClick={() => changeWeight(NORMAL_WEIGHT)}
                      disabled={!q.is_candidate}
                    >
                      平时
                    </button>
                    <span>想答</span>
                  </div>
                </div>
                <p className={blocked ? 'slider-note warn-text' : 'slider-note'}>
                  {blocked ? (state.credits === 0 ? 'credits 用完了，只能加' : 'credits 不够，不能再减') : `权重 ${myWeight}`}
                </p>
              </>
            ) : !revealed ? (
              <p className="spin-status">转盘中…</p>
            ) : q.is_me ? (
              <div className="result me">
                <span className="result-label">被抽中的是</span>
                <span className="result-name">你！</span>
              </div>
            ) : (
              <div className="result">
                <span className="result-label">被抽中的是</span>
                <span className="result-name">{q.winner_name}</span>
              </div>
            )}
            {error && <p className="error">{error}</p>}
          </div>
        </div>
      )}
    </StudentShell>
  )
}

function CreditsBadge({ credits, pending }: { credits: number; pending: CreditChange | null }) {
  return (
    <div className="credits" title="减权花 credits，加权赚 credits，转盘后结算">
      <span className="credits-num">{credits}</span>
      <span className="credits-label">credits</span>
      {pending && pending.max !== 0 && (
        <span
          className={pending.max > 0 ? 'credits-pending up' : 'credits-pending down'}
          title={pending.max > 0 ? '没抽中 / 抽中' : undefined}
        >
          {pending.max < 0 ? pending.max : pending.min === pending.max ? `+${pending.max}` : `+${pending.min}~${pending.max}`}
        </span>
      )}
    </div>
  )
}

/** 这题结束后 credits 的变化：加权被抽中每 5 赚 1 个；未抽中 +10 给 1 个，此后每 +20 给 1 个；减权每 1 花 1 个 */
type CreditChange = { min: number; max: number }

/**
 * 这题结束后 credits 的变化（和数据库 spin() 的规则一致）：
 * 减权每 1 花 1 个；加权被抽中每 5 赚 1 个，没抽中 +10 给 1 个，此后每 +20 给 1 个
 */
function creditChange(delta: number): CreditChange {
  if (delta <= 0) return { min: delta, max: delta }
  const consolation = delta >= 10 ? 1 + Math.floor((delta - 10) / 20) : 0
  return { min: consolation, max: Math.floor(delta / EARN_STEP) }
}

function formatChance(p: number) {
  const pct = p * 100
  return pct >= 10 ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`
}
