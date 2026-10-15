import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { EditIcon } from '../components/Icons'
import { renameClass } from '../lib/hooks'
import { errorText, rpc, supabase } from '../lib/supabase'
import type { ClassRow } from '../lib/types'

type ClassWithCount = ClassRow & { count: number }

// 每个班卡片左上角的色块，和转盘的六色轮流
const CARD_COLORS = ['var(--c1)', 'var(--c4)', 'var(--c3)', 'var(--c5)', 'var(--c2)', 'var(--c6)']
const CARD_TEXT = ['#fff', '#fff', '#fff', '#fff', 'var(--gold-ink)', 'var(--gold-ink)']

export function ClassList() {
  const navigate = useNavigate()
  const [classes, setClasses] = useState<ClassWithCount[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [unowned, setUnowned] = useState<ClassRow[]>([])

  async function load() {
    const [c, s] = await Promise.all([
      supabase.from('classes').select('*').order('created_at'),
      supabase.from('students').select('class_id'),
    ])
    const err = c.error || s.error
    if (err) return setError(errorText(err))
    const counts = new Map<string, number>()
    for (const { class_id } of s.data) counts.set(class_id, (counts.get(class_id) ?? 0) + 1)
    setClasses(c.data.map((cls) => ({ ...cls, count: counts.get(cls.id) ?? 0 })))
    setUnowned(await rpc<ClassRow[]>('unowned_classes').catch(() => []))
  }

  useEffect(() => {
    load()
  }, [])

  async function adopt(c: ClassRow) {
    try {
      await rpc('adopt_class', { p_class_id: c.id })
      await load()
    } catch (e) {
      setError(errorText(e))
    }
  }

  async function rename(c: ClassRow) {
    const name = window.prompt('班级名称', c.name)?.trim()
    if (!name || name === c.name) return
    try {
      await renameClass(c.id, name)
      setClasses((list) => list && list.map((x) => (x.id === c.id ? { ...x, name } : x)))
    } catch (e) {
      setError(errorText(e))
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    const { data, error } = await supabase.from('classes').insert({ name: name.trim() }).select().single()
    setBusy(false)
    if (error) return setError(errorText(error))
    navigate(`/teacher/${data.id}/roster`)
  }

  return (
    <>
      <header className="page-head">
        <h1>班级</h1>
      </header>

      {error && <p className="error">{error}</p>}

      {unowned.map((c) => (
        <div key={c.id} className="adopt">
          <span>
            以前建的班级「{c.name}」还没有老师
          </span>
          <button className="btn sm primary" onClick={() => adopt(c)}>
            归到我名下
          </button>
        </div>
      ))}

      {classes && (
        <div className="class-grid">
          {classes.map((c, i) => (
            <div key={c.id} className="class-card">
              <Link to={`/teacher/${c.id}`} className="class-card-link">
                <span
                  className="class-card-dot"
                  style={{ background: CARD_COLORS[i % 6], color: CARD_TEXT[i % 6] }}
                  aria-hidden
                >
                  {[...c.name][0]}
                </span>
                <span className="class-card-name">{c.name}</span>
                <span className="class-card-meta">
                  <span className="class-card-code">{c.join_code}</span>
                  <span>{c.count} 人</span>
                </span>
              </Link>
              <button className="icon-btn class-card-rename" onClick={() => rename(c)} title="改名" aria-label="改名">
                <EditIcon />
              </button>
            </div>
          ))}

          {adding ? (
            <form className="class-card new" onSubmit={create}>
              <input
                placeholder="班级名称"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && (setAdding(false), setName(''))}
                aria-label="新班级名称"
                autoFocus
                maxLength={40}
              />
              <div className="row">
                <button type="button" className="btn ghost sm" onClick={() => (setAdding(false), setName(''))}>
                  取消
                </button>
                <button className="btn primary sm" disabled={!name.trim() || busy}>
                  创建
                </button>
              </div>
            </form>
          ) : (
            <button className="class-card add" onClick={() => setAdding(true)}>
              <span className="plus" aria-hidden>
                +
              </span>
              新建班级
            </button>
          )}
        </div>
      )}
    </>
  )
}
