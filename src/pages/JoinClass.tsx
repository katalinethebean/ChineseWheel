import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { errorText, supabase } from '../lib/supabase'

/** 学生输入 6 位班级码 */
export function JoinClass() {
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    const c = code.trim().toUpperCase()
    if (c.length !== 6) return
    setBusy(true)
    setError('')
    const { data, error } = await supabase.from('classes').select('join_code').eq('join_code', c).maybeSingle()
    setBusy(false)
    if (error) return setError(errorText(error))
    if (!data) return setError('没有这个班级码')
    navigate(`/student/${c}`)
  }

  return (
    <div className="student">
      <header className="student-head">
        <img className="logo" src="/logo.jpg" alt="硅雞科技" width={28} height={28} />
      </header>
      <form className="join-class" onSubmit={submit}>
        <h1>班级码</h1>
        <input
          className="code-input"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          autoFocus
          aria-label="班级码"
          placeholder="ABC123"
        />
        {error && <p className="error">{error}</p>}
        <button className="btn primary lg block" disabled={code.length !== 6 || busy}>
          加入
        </button>
      </form>
    </div>
  )
}
