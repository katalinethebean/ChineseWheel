import { QRCodeSVG } from 'qrcode.react'
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { SPIN_MS, Wheel, equalSlices } from '../components/Wheel'
import { usePolling } from '../lib/hooks'
import { errorText, rpc, supabase } from '../lib/supabase'
import type { LessonRow, TeacherLessonState } from '../lib/types'
import { targetRotation } from '../lib/wheel'

type Person = { id: string; name: string }
type Phase = 'idle' | 'spinning' | 'result'

const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString()

export function Lesson() {
  const [lesson, setLesson] = useState<LessonRow | null | undefined>(undefined)
  const [st, setSt] = useState<TeacherLessonState | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [frozen, setFrozen] = useState<Person[] | null>(null)
  const [rotation, setRotation] = useState(0)
  const [winner, setWinner] = useState<Person | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [bigQr, setBigQr] = useState(false)
  const [settledMsg, setSettledMsg] = useState(false)

  const loadLesson = useCallback(async () => {
    const { data, error } = await supabase.from('lessons').select('*').is('settled_at', null).maybeSingle()
    if (error) return setError(errorText(error))
    setLesson(data)
    if (!data) setSt(null)
  }, [])

  useEffect(() => {
    loadLesson()
  }, [loadLesson])

  const refresh = useCallback(async () => {
    if (!lesson) return
    try {
      setSt(await rpc<TeacherLessonState>('teacher_lesson_state', { p_lesson_id: lesson.id }))
    } catch (e) {
      setError(errorText(e))
    }
  }, [lesson])

  usePolling(refresh, 2000, !!lesson)

  async function act(fn: () => Promise<unknown>) {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const excludePicked = st?.lesson.exclude_picked ?? false
  const candidates: Person[] =
    st?.students.filter((s) => s.present && !(excludePicked && s.picked)).map(({ id, name }) => ({ id, name })) ?? []
  const wheelPeople = frozen ?? candidates
  const presentCount = st?.students.filter((s) => s.present).length ?? 0
  const question = st?.question ?? null
  const questionOpen = question?.status === 'open'

  const startLesson = () =>
    act(async () => {
      await rpc('start_lesson', { p_exclude_picked: false })
      setSettledMsg(false)
      await loadLesson()
    })

  const newQuestion = () =>
    act(async () => {
      setPhase('idle')
      setFrozen(null)
      setWinner(null)
      await rpc('start_question', { p_lesson_id: lesson!.id })
      await refresh()
    })

  async function spin() {
    if (!question || !questionOpen || candidates.length === 0 || phase === 'spinning') return
    const snapshot = candidates
    setFrozen(snapshot)
    setBusy(true)
    setError('')
    try {
      const r = await rpc<{ winner_id: string; winner_name: string }>('spin', { p_question_id: question.id })
      let list = snapshot
      let index = list.findIndex((p) => p.id === r.winner_id)
      if (index < 0) {
        list = [...snapshot, { id: r.winner_id, name: r.winner_name }]
        index = list.length - 1
        setFrozen(list)
      }
      setPhase('spinning')
      setRotation((cur) => targetRotation(cur, list.length, index))
      window.setTimeout(() => {
        setWinner({ id: r.winner_id, name: r.winner_name })
        setPhase('result')
        refresh()
      }, SPIN_MS + 150)
    } catch (e) {
      setFrozen(null)
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  function closeResult() {
    setPhase('idle')
    setFrozen(null)
    setWinner(null)
  }

  const settle = () =>
    act(async () => {
      if (!window.confirm('下课结算？本节课的结果会计入统计，学生下节课需要重新选名字。')) return
      await rpc('settle_lesson', { p_lesson_id: lesson!.id })
      closeResult()
      setSettledMsg(true)
      await loadLesson()
    })

  const togglePresent = (s: TeacherLessonState['students'][number]) =>
    act(async () => {
      const res = s.joined
        ? await supabase
            .from('attendance')
            .update({ present: !s.present })
            .eq('lesson_id', lesson!.id)
            .eq('student_id', s.id)
        : await supabase.from('attendance').insert({ lesson_id: lesson!.id, student_id: s.id, present: true })
      if (res.error) throw res.error
      await refresh()
    })

  const setExcludePicked = (value: boolean) =>
    act(async () => {
      const { error } = await supabase.from('lessons').update({ exclude_picked: value }).eq('id', lesson!.id)
      if (error) throw error
      await refresh()
    })

  // 键盘快捷键：空格 = 转，回车 = 开始新题，Esc = 关闭结果
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'Escape') {
        setBigQr(false)
        if (phase === 'result') closeResult()
      } else if (e.key === ' ' && questionOpen && !busy) {
        e.preventDefault()
        spin()
      } else if (e.key === 'Enter' && !questionOpen && lesson && !busy && phase !== 'spinning') {
        e.preventDefault()
        newQuestion()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (lesson === undefined) return error ? <p className="error">{error}</p> : null

  const joinUrl = `${window.location.origin}/student`
  const joinLabel = joinUrl.replace(/^https?:\/\//, '')

  if (!lesson) {
    return (
      <div className="start">
        {settledMsg && (
          <p className="notice">
            已结算 · <Link to="/teacher/stats">查看统计</Link>
          </p>
        )}
        {error && <p className="error">{error}</p>}
        <button className="btn accent xl" onClick={startLesson} disabled={busy}>
          开始上课
        </button>
      </div>
    )
  }

  const winnerIndex = phase === 'result' && winner ? wheelPeople.findIndex((p) => p.id === winner.id) : null
  const startedAt = new Date(lesson.started_at)

  return (
    <div className="lesson">
      {(!isToday(lesson.started_at) || error) && (
        <div className="lesson-alerts">
          {!isToday(lesson.started_at) && (
            <p className="warn">这节课从 {startedAt.toLocaleDateString('zh-CN')} 开始，还没结算。</p>
          )}
          {error && <p className="error">{error}</p>}
        </div>
      )}

      <div className="lesson-grid">
        <section className="stage">
          <div className="wheel-area">
            <Wheel
              slices={equalSlices(wheelPeople.map((p) => p.name))}
              rotation={rotation}
              spinning={phase === 'spinning'}
              winnerIndex={winnerIndex}
            />
          </div>

          <div className="stage-bar">
            {questionOpen ? (
              <>
                <span className="progress" aria-live="polite">
                  <b>{question!.adjusted_count}</b>/{presentCount} 已调整
                </span>
                <button
                  className="btn accent xl"
                  onClick={spin}
                  disabled={busy || phase === 'spinning' || candidates.length === 0}
                >
                  转！<kbd>空格</kbd>
                </button>
              </>
            ) : (
              <button className="btn primary xl" onClick={newQuestion} disabled={busy || phase === 'spinning'}>
                开始新题<kbd>回车</kbd>
              </button>
            )}
          </div>
        </section>

        <aside className="side">
          <button className="join" onClick={() => setBigQr(true)} title="放大">
            <QRCodeSVG value={joinUrl} size={112} marginSize={0} />
            <span className="join-url">{joinLabel}</span>
          </button>

          <section className="side-block">
            <header className="side-head">
              <h2>在场</h2>
              <span className="count">
                {presentCount}/{st?.students.length ?? 0}
              </span>
            </header>
            <div className="chips">
              {st?.students.map((s) => (
                <button
                  key={s.id}
                  className={['chip', s.present ? 'on' : '', s.picked ? 'picked' : ''].join(' ')}
                  onClick={() => togglePresent(s)}
                  disabled={busy}
                  aria-pressed={s.present}
                  title={s.picked ? '已抽过' : s.present ? '点击设为不在场' : '点击设为在场'}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </section>

          <footer className="side-foot">
            <label className="switch">
              <input
                type="checkbox"
                checked={excludePicked}
                onChange={(e) => setExcludePicked(e.target.checked)}
                disabled={busy}
              />
              <span className="switch-track" aria-hidden />
              抽过的不再抽
            </label>
            <div className="side-meta">
              <span>
                {startedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 开始
              </span>
              <button className="btn ghost sm" onClick={settle} disabled={busy || phase === 'spinning'}>
                下课结算
              </button>
            </div>
          </footer>
        </aside>
      </div>

      {phase === 'result' && winner && (
        <div className="overlay" onClick={closeResult}>
          <div className="winner" onClick={(e) => e.stopPropagation()}>
            <Confetti />
            <p className="winner-name">{winner.name}</p>
            <button className="btn primary lg" onClick={newQuestion} autoFocus>
              下一题
            </button>
          </div>
        </div>
      )}

      {bigQr && (
        <div className="overlay" onClick={() => setBigQr(false)}>
          <div className="qr-big" onClick={(e) => e.stopPropagation()}>
            <QRCodeSVG value={joinUrl} size={400} marginSize={0} />
            <p className="join-url big">{joinLabel}</p>
          </div>
        </div>
      )}
    </div>
  )
}

const CONFETTI_COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)']

/** 抽中时的一圈彩色纸屑（纯 CSS 动画，减少动效时不显示） */
function Confetti() {
  return (
    <div className="confetti" aria-hidden>
      {Array.from({ length: 18 }, (_, i) => (
        <span
          key={i}
          style={
            {
              '--a': `${(i / 18) * 360}deg`,
              '--d': `${140 + (i % 3) * 50}px`,
              background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
            } as CSSProperties
          }
        />
      ))}
    </div>
  )
}
