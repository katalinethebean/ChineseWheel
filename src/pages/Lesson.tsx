import { QRCodeSVG } from 'qrcode.react'
import { useCallback, useEffect, useState } from 'react'
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
      if (!window.confirm('下课结算后，本节课的结果会计入统计，单题记录会被永久删除。确定结算吗？')) return
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

  if (lesson === undefined) return error ? <p className="error">{error}</p> : <p className="muted">加载中…</p>

  const joinUrl = `${window.location.origin}/student`

  if (!lesson) {
    return (
      <>
        <div className="card start-card">
          <h1>准备上课</h1>
          <p className="muted">开始上课后，学生打开学生页面就会自动出现在在场名单里。</p>
          {settledMsg && (
            <p className="notice">
              已下课结算。<Link to="/teacher/stats">查看统计 →</Link>
            </p>
          )}
          {error && <p className="error">{error}</p>}
          <button className="btn primary big" onClick={startLesson} disabled={busy}>
            开始上课
          </button>
        </div>
      </>
    )
  }

  const winnerIndex =
    phase === 'result' && winner ? wheelPeople.findIndex((p) => p.id === winner.id) : null

  return (
    <div className="lesson">
      <div className="lesson-head">
        <p className="muted small">上课中 · {new Date(lesson.started_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 开始</p>
        <button className="btn" onClick={settle} disabled={busy || phase === 'spinning'}>
          下课结算
        </button>
      </div>

      {!isToday(lesson.started_at) && (
        <p className="warn">
          这节课是 {new Date(lesson.started_at).toLocaleDateString('zh-CN')} 开始的，还没有结算。
          如果是新的一节课，请先点右上角「下课结算」，再重新开始上课。
        </p>
      )}
      {error && <p className="error">{error}</p>}

      <div className="lesson-grid">
        <section className="stage">
          <Wheel
            slices={equalSlices(wheelPeople.map((p) => p.name))}
            rotation={rotation}
            spinning={phase === 'spinning'}
            winnerIndex={winnerIndex}
          />

          <div className="stage-status">
            {phase === 'spinning' ? (
              <p className="status-big">转盘转动中…</p>
            ) : questionOpen ? (
              <p className="status-big">
                学生正在调整 · 已调整 <b>{question!.adjusted_count}</b> / {presentCount} 人
              </p>
            ) : (
              <p className="status-big muted">点「开始新题」后，学生就能在手机上调整权重</p>
            )}
          </div>

          <div className="stage-actions">
            {questionOpen ? (
              <button
                className="btn spin-btn"
                onClick={spin}
                disabled={busy || phase === 'spinning' || candidates.length === 0}
              >
                转！
              </button>
            ) : (
              <button className="btn primary big" onClick={newQuestion} disabled={busy || phase === 'spinning'}>
                开始新题
              </button>
            )}
          </div>
          <p className="muted small center">快捷键：回车 开始新题 · 空格 转</p>
        </section>

        <aside className="side">
          <div className="card join-card">
            <button className="qr" onClick={() => setBigQr(true)} title="放大二维码">
              <QRCodeSVG value={joinUrl} size={132} marginSize={1} />
            </button>
            <div>
              <p className="muted small">学生扫码加入，或打开</p>
              <p className="join-url">{joinUrl.replace(/^https?:\/\//, '')}</p>
              <button className="btn-link" onClick={() => setBigQr(true)}>
                放大二维码
              </button>
            </div>
          </div>

          <div className="card">
            <label className="check">
              <input
                type="checkbox"
                checked={excludePicked}
                onChange={(e) => setExcludePicked(e.target.checked)}
                disabled={busy}
              />
              本节课已抽过的人不再参与
            </label>
          </div>

          <div className="card">
            <h2>
              在场 {presentCount} / {st?.students.length ?? 0}
            </h2>
            <p className="muted small">扫码加入后自动在场。点名字可以手动切换（比如没带手机的同学）。</p>
            <div className="chips">
              {st?.students.map((s) => (
                <button
                  key={s.id}
                  className={['chip', s.present ? 'on' : '', s.picked ? 'picked' : ''].join(' ')}
                  onClick={() => togglePresent(s)}
                  disabled={busy}
                  title={s.picked ? '本节课已被抽中过' : undefined}
                >
                  {s.name}
                  {s.picked && <span className="dot" aria-label="已抽中过" />}
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {phase === 'result' && winner && (
        <div className="overlay" onClick={closeResult}>
          <div className="result-card" onClick={(e) => e.stopPropagation()}>
            <p className="muted">请回答</p>
            <p className="winner-name">{winner.name}</p>
            <div className="row center">
              <button className="btn" onClick={closeResult}>
                关闭
              </button>
              <button className="btn primary" onClick={newQuestion}>
                下一题
              </button>
            </div>
          </div>
        </div>
      )}

      {bigQr && (
        <div className="overlay" onClick={() => setBigQr(false)}>
          <div className="qr-big" onClick={(e) => e.stopPropagation()}>
            <QRCodeSVG value={joinUrl} size={420} marginSize={2} />
            <p className="join-url big">{joinUrl.replace(/^https?:\/\//, '')}</p>
            <button className="btn" onClick={() => setBigQr(false)}>
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
