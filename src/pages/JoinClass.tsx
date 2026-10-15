import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { errorText, rpc } from '../lib/supabase'
import { StudentShell } from '../components/StudentShell'

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
    try {
      const cls = await rpc<{ id: string } | null>('class_by_code', { p_code: c })
      if (!cls) return setError('没有这个班级码')
    } catch (e) {
      return setError(errorText(e))
    } finally {
      setBusy(false)
    }
    navigate(`/student/${c}`)
  }

  return (
    <StudentShell center>
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
    </StudentShell>
  )
}
