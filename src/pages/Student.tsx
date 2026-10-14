import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { SPIN_MS, Wheel, type Slice } from '../components/Wheel'
import { usePolling } from '../lib/hooks'
import { errorText, rpc, supabase } from '../lib/supabase'
import type { StudentState } from '../lib/types'
import { layoutArcs, targetRotationInArc } from '../lib/wheel'

type RosterEntry = { id: string; name: string; claimed: boolean }

const TOKEN_KEY = 'wheel_token'

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

function writeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // 隐私模式下可能无法保存，只是下次需要重新选名字
  }
}

export function Student() {
  const [token, setToken] = useState<string | null>(() => readToken())

  if (!token) {
    return (
      <PickName
        onClaimed={(t) => {
          writeToken(t)
          setToken(t)
        }}
      />
    )
  }
  return (
    <StudentView
      token={token}
      onInvalid={() => {
        writeToken(null)
        setToken(null)
      }}
    />
  )
}

function PickName({ onClaimed }: { onClaimed: (token: string) => void }) {
  const [roster, setRoster] = useState<RosterEntry[] | undefined>(undefined)
  const [chosen, setChosen] = useState<{ id: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('students').select('id, name, claimed').order('seq')
    if (error) setError(errorText(error))
    else setRoster(data)
  }, [])

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

  if (roster === undefined) return <div className="student">{error && <p className="error">{error}</p>}</div>

  return (
    <div className="student">
      <header className="student-head">
        <img className="logo" src="/logo.jpg" alt="硅雞科技" width={28} height={28} />
      </header>
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
    </div>
  )
}

const MIN_WEIGHT = 1
const MAX_WEIGHT = 30
const NORMAL_WEIGHT = 10
const ME_COLOR = '#e9473b'
const OTHER_COLORS = ['#ededed', '#e0e0e0']

function StudentView({ token, onInvalid }: { token: string; onInvalid: () => void }) {
  const [state, setState] = useState<StudentState | null>(null)
  const [weight, setWeight] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [rotation, setRotation] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const [spinMs, setSpinMs] = useState(SPIN_MS)
  const [landedIndex, setLandedIndex] = useState<number | null>(null)
  const [revealAt, setRevealAt] = useState(0)
  const [, forceTick] = useState(0)
  const latestAdjust = useRef(0)
  const animatedFor = useRef<string | null>(null)
  const sendTimer = useRef<number | undefined>(undefined)
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
  usePolling(load, q?.status === 'open' ? 2000 : 4000)

  // 题目变化时，用服务器的权重重置本地显示
  useEffect(() => {
    setWeight(q ? q.weight : null)
  }, [q?.id, q?.status])

  // 实时推送：老师开题 / 转盘时立刻刷新
  useEffect(() => {
    const channel = supabase
      .channel('questions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'questions' }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load])

  // 转盘的扇区：自己的按真实占比，其他人灰色、没有名字、平均分
  const myWeight = weight ?? q?.weight ?? 10
  const othersCount = q ? q.candidate_count - (q.is_candidate ? 1 : 0) : 0
  const othersTotal = q ? q.total_weight - (q.is_candidate ? q.weight : 0) : 0
  const slices: Slice[] = []
  if (q && state?.valid) {
    if (q.is_candidate) {
      slices.push({ label: state.student_name, weight: myWeight, color: ME_COLOR, textColor: '#fff' })
    }
    for (let i = 0; i < othersCount; i++) {
      slices.push({ weight: othersTotal / othersCount, color: OTHER_COLORS[i % 2] })
    }
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
      } catch (e) {
        setError(errorText(e))
        load()
      }
    }, 200)
  }

  if (!state?.valid) return <div className="student">{error && <p className="error">{error}</p>}</div>

  const revealed = Date.now() >= revealAt
  const blocked = q?.status === 'open' && q.is_candidate && myWeight <= q.min_weight && q.min_weight > MIN_WEIGHT

  return (
    <div className="student">
      <header className="student-head">
        <span className="me">
          <img className="logo" src="/logo.jpg" alt="硅雞科技" width={28} height={28} />
          {state.student_name}
        </span>
        <CreditsBadge
          credits={state.credits}
          pending={q?.status === 'open' && q.is_candidate ? myWeight - NORMAL_WEIGHT : 0}
        />
      </header>

      {!state.lesson_active || !q ? (
        <div className="waiting">
          <p>
            等老师出题<span className="dots" aria-hidden />
          </p>
        </div>
      ) : (
        <main className="play">
          <Wheel
            slices={slices}
            rotation={rotation}
            spinning={spinning}
            spinMs={spinMs}
            winnerIndex={q.status === 'spun' && revealed ? landedIndex : null}
            emptyText=""
          />

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
                  min={MIN_WEIGHT}
                  max={MAX_WEIGHT}
                  step={1}
                  value={myWeight}
                  onChange={(e) => changeWeight(Number(e.target.value))}
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
        </main>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  )
}

function CreditsBadge({ credits, pending }: { credits: number; pending: number }) {
  return (
    <div className="credits" title="减权花 credits，加权赚 credits，转盘后结算">
      <span className="credits-num">{credits}</span>
      <span className="credits-label">credits</span>
      {pending !== 0 && (
        <span className={pending > 0 ? 'credits-pending up' : 'credits-pending down'}>
          {pending > 0 ? `+${pending}` : pending}
        </span>
      )}
    </div>
  )
}

const pct = (w: number) => ((w - MIN_WEIGHT) / (MAX_WEIGHT - MIN_WEIGHT)) * 100

function formatChance(p: number) {
  const pct = p * 100
  return pct >= 10 ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`
}
