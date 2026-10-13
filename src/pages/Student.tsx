import { useCallback, useEffect, useRef, useState } from 'react'
import { SPIN_MS } from '../components/Wheel'
import { usePolling } from '../lib/hooks'
import { errorText, rpc, supabase } from '../lib/supabase'
import type { StudentState } from '../lib/types'

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
        <p className="muted small">名字显示「已加入」但不是你本人？请告诉老师。</p>
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

function StudentView({ token, onInvalid }: { token: string; onInvalid: () => void }) {
  const [state, setState] = useState<StudentState | null>(null)
  const [weight, setWeight] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [revealAt, setRevealAt] = useState(0)
  const [, forceTick] = useState(0)
  const latestAdjust = useRef(0)
  const onInvalidRef = useRef(onInvalid)
  onInvalidRef.current = onInvalid
  const questionId = state?.valid ? state.question?.id : undefined

  const load = useCallback(async () => {
    try {
      const s = await rpc<StudentState>('student_state', { p_token: token })
      if (!s.valid) return onInvalidRef.current()
      setState(s)
      setError('')
      const q = s.question
      if (q?.status === 'spun' && q.seconds_since_spin != null) {
        // 和老师屏幕的转盘动画同步：转完之前不揭晓结果
        setRevealAt(Date.now() + Math.max(0, SPIN_MS - q.seconds_since_spin * 1000))
      }
    } catch (e) {
      setError(errorText(e))
    }
  }, [token])

  usePolling(load, 4000)

  // 题目变化时，用服务器的权重重置本地显示
  useEffect(() => {
    setWeight(state?.valid && state.question ? state.question.weight : null)
  }, [questionId, state?.valid && state.question?.status])

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

  // 揭晓倒计时
  useEffect(() => {
    const wait = revealAt - Date.now()
    if (wait <= 0) return
    const id = window.setTimeout(() => forceTick((n) => n + 1), wait + 50)
    return () => window.clearTimeout(id)
  }, [revealAt])

  async function step(delta: 1 | -1) {
    if (!questionId) return
    setWeight((w) => (w == null ? w : Math.max(0, w + delta)))
    const ticket = ++latestAdjust.current
    try {
      const w = await rpc<number>('adjust', { p_token: token, p_question_id: questionId, p_step: delta })
      if (ticket === latestAdjust.current) setWeight(w)
    } catch (e) {
      setError(errorText(e))
      load()
    }
  }

  if (!state?.valid) return <div className="student"><p className="muted">{error || '加载中…'}</p></div>

  const q = state.question
  const revealed = Date.now() >= revealAt

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
            <p className="muted small">想回答就加，不想回答就减。转盘前可以随时改。</p>
            <div className="weight-row">
              <button className="step minus" onClick={() => step(-1)} disabled={weight === 0} aria-label="减一">
                −
              </button>
              <div className="weight">
                <span className="weight-num">{weight ?? q.weight}</span>
                <span className="muted small">我的权重</span>
              </div>
              <button className="step plus" onClick={() => step(1)} aria-label="加一">
                +
              </button>
            </div>
            <p className="hint">{hintFor(weight ?? q.weight)}</p>
          </div>
        ) : !revealed ? (
          <div className="waiting">
            <div className="pulse spin" />
            <h1>转盘转动中…</h1>
          </div>
        ) : q.is_me ? (
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
        )}

        {error && <p className="error">{error}</p>}
      </div>
      <p className="privacy-note">
        老师看不到你每道题的选择，只能看到下课后累计加了多少、减了多少。
      </p>
    </div>
  )
}

function hintFor(w: number) {
  if (w === 0) return '你这题不会被抽中。'
  if (w < 10) return '被抽中的机会比平时小。'
  if (w === 10) return '和平时一样的机会。'
  if (w < 20) return '被抽中的机会比平时大。'
  return '被抽中的机会大很多！'
}
