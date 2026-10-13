import { useState, type FormEvent } from 'react'
import { errorText, supabase } from '../lib/supabase'

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) setError(errorText(error))
    setBusy(false)
  }

  return (
    <div className="login">
      <form className="card login-card" onSubmit={submit}>
        <img src="/favicon.svg" alt="" width={56} height={56} />
        <h1>课堂转盘</h1>
        <p className="muted">老师登录</p>
        <label>
          邮箱
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          密码
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={busy}>
          {busy ? '登录中…' : '登录'}
        </button>
        <p className="muted small">学生请扫描老师屏幕上的二维码加入，不需要登录。</p>
      </form>
    </div>
  )
}
