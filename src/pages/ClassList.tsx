import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { renameClass } from '../lib/hooks'
import { errorText, supabase } from '../lib/supabase'
import type { ClassRow } from '../lib/types'

export function ClassList() {
  const navigate = useNavigate()
  const [classes, setClasses] = useState<ClassRow[] | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase
      .from('classes')
      .select('*')
      .order('created_at')
      .then(({ data, error }) => (error ? setError(errorText(error)) : setClasses(data)))
  }, [])

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

      {classes && classes.length > 0 && (
        <ul className="class-list">
          {classes.map((c) => (
            <li key={c.id}>
              <Link to={`/teacher/${c.id}`}>
                <span className="class-name">{c.name}</span>
                <span className="count">{c.join_code}</span>
              </Link>
              <button className="btn-link" onClick={() => rename(c)}>
                改名
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="add-names new-class" onSubmit={create}>
        <input placeholder="新班级名称" value={name} onChange={(e) => setName(e.target.value)} aria-label="新班级名称" />
        <button className="btn primary" disabled={!name.trim() || busy}>
          新建
        </button>
      </form>
    </>
  )
}
