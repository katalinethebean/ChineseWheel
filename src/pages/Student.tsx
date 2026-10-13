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

  if (roster === undefined) return <div className="student"><p className="muted">{error || '加载中…'}</p></div>

  return (
    <div className="student">
      <div className="student-card">
        <h1>你是谁？</h1>
        <p className="muted small">选择自己的名字。选好后这台手机会记住你。</p>
        {error && <p className="error">{error}</p>}
        <div className="name-grid">
          {roster.length === 0 && <p className="muted">老师还没有添加名单。</p>}
          {roster.map((s) => (
            <button
              key={s.id}
              className="name-btn"
              disabled={s.claimed || busy}
              onClick={() => setChosen({ id: s.id, name: s.name })}
            >
              {s.name}
              {s.claimed && <span className="small">已加入</span>}
            </button>
          ))}
        </div>
        <p className="muted small">名字显示「已加入」但不是你本人？请老师在「名单」里解绑。</p>
      </div>

      {chosen && (
        <div className="overlay" onClick={() => setChosen(null)}>
          <div className="result-card" onClick={(e) => e.stopPropagation()}>
            <p className="muted">确认你是</p>
            <p className="winner-name small-name">{chosen.name}</p>
            <p className="muted small">选错了的话需要找老师解绑。</p>
            <div className="row center">
              <button className="btn" onClick={() => setChosen(null)}>
                取消
              </button>
              <button className="btn primary" onClick={confirm} disabled={busy}>
                是我
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const MIN_WEIGHT = 1
const MAX_WEIGHT = 30
const NORMAL_WEIGHT = 10
const ME_COLOR = '#d9483b'
const OTHER_COLORS = ['#ddd5c4', '#cbc2ae']

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
    if (!q) return
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

  if (!state?.valid) return <div className="student"><p className="muted">{error || '加载中…'}</p></div>

  const revealed = Date.now() >= revealAt
  const wheel = (
    <Wheel
      slices={slices}
      rotation={rotation}
      spinning={spinning}
      spinMs={spinMs}
      winnerIndex={q?.status === 'spun' && revealed ? landedIndex : null}
      emptyText="转盘上暂时没有人"
    />
  )

  return (
    <div className="student">
      <div className="student-card">
        <p className="muted small">
          我是 <b>{state.student_name}</b>
        </p>

        {!state.lesson_active || !q ? (
          <div className="waiting">
            <div className="pulse" />
            <h1>等待老师出题…</h1>
            <p className="muted small">老师开始新题后，这里会自动出现。</p>
          </div>
        ) : q.status === 'open' ? (
          <div className="adjuster">
            <h1>这道题你想回答吗？</h1>
            {wheel}
            {q.is_candidate ? (
              <p className="chance">
                被抽中的机会约 <b>{formatChance(chance)}</b>
              </p>
            ) : (
              <p className="muted small">你这题不在转盘上（老师标记你不在场，或本节课你已经被抽过）。</p>
            )}
            <div className="weight">
              <span className="muted small">我的权重</span>
              <span className="weight-num">{myWeight}</span>
            </div>
            <div className="slider">
              <input
                type="range"
                min={MIN_WEIGHT}
                max={MAX_WEIGHT}
                step={1}
                value={myWeight}
                onChange={(e) => changeWeight(Number(e.target.value))}
                aria-label="我的权重"
                style={{ '--fill': `${pct(myWeight)}%` } as CSSProperties}
              />
              <div className="slider-labels" aria-hidden>
                <span>不想答</span>
                <button className="slider-normal" style={{ left: `${pct(NORMAL_WEIGHT)}%` }} onClick={() => changeWeight(NORMAL_WEIGHT)}>
                  平时
                </button>
                <span>很想答</span>
              </div>
            </div>
            <p className="hint">{hintFor(myWeight)}</p>
          </div>
        ) : (
          <div className="adjuster">
            <h1>{revealed ? '结果' : '转盘转动中…'}</h1>
            {wheel}
            {revealed &&
              (q.is_me ? (
                <div className="result me">
                  <p>被抽中的是</p>
                  <p className="winner-name">你！</p>
                  <p>请准备回答 🙋</p>
                </div>
              ) : (
                <div className="result">
                  <p className="muted">被抽中的是</p>
                  <p className="winner-name">{q.winner_name}</p>
                  <p className="muted small">等待下一题…</p>
                </div>
              ))}
          </div>
        )}

        {error && <p className="error">{error}</p>}
      </div>
      <p className="privacy-note">
        转盘上只显示你自己的部分，看不到别人的名字。老师看不到你每道题的选择，只能看到下课后累计加了多少、减了多少。
      </p>
    </div>
  )
}

const pct = (w: number) => ((w - MIN_WEIGHT) / (MAX_WEIGHT - MIN_WEIGHT)) * 100

function formatChance(p: number) {
  const pct = p * 100
  return pct >= 10 ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`
}

function hintFor(w: number) {
  if (w <= MIN_WEIGHT) return '已经是最低了，被抽中的机会很小。'
  if (w < 10) return '被抽中的机会比平时小。'
  if (w === 10) return '和平时一样的机会。'
  if (w < 20) return '被抽中的机会比平时大。'
  if (w < MAX_WEIGHT) return '被抽中的机会大很多！'
  return '已经是最高了！'
}
