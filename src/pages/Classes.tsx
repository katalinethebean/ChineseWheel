import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { errorText, supabase } from '../lib/supabase'
import type { ClassRow } from '../lib/types'

export function Classes() {
  const [classes, setClasses] = useState<ClassRow[] | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  async function load() {
    const { data, error } = await supabase.from('classes').select('*').order('created_at')
    if (error) setError(errorText(error))
    else setClasses(data)
  }

  useEffect(() => {
    load()
  }, [])

  async function create(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    const { error } = await supabase.from('classes').insert({ name: name.trim() })
    if (error) return setError(errorText(error))
    setName('')
    load()
  }

  return (
    <>
      <h1>我的班级</h1>
      {error && <p className="error">{error}</p>}
      {classes === null ? (
        <p className="muted">加载中…</p>
      ) : classes.length === 0 ? (
        <p className="muted">还没有班级，先在下面新建一个。</p>
      ) : (
        <div className="class-grid">
          {classes.map((c) => (
            <div key={c.id} className="card class-card">
              <h2>{c.name}</h2>
              <p className="muted small">加入码 {c.join_code}</p>
              <div className="row">
                <Link className="btn primary" to={`/class/${c.id}/lesson`}>
                  上课
                </Link>
                <Link className="btn" to={`/class/${c.id}`}>
                  名单
                </Link>
                <Link className="btn" to={`/class/${c.id}/stats`}>
                  统计
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      <form className="card inline-form" onSubmit={create}>
        <input placeholder="新班级名称，比如：三年级二班" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn primary">新建班级</button>
      </form>
    </>
  )
}
