import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { errorText, supabase } from '../lib/supabase'
import { Brand } from '../components/Brand'

/** 老师登录 / 注册 */
export function Login() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (error) setError(errorText(error))
    } else {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: `${window.location.origin}/teacher` },
      })
      if (error) setError(errorText(error))
      // 开启了邮箱确认时，注册后没有 session，需要先去邮箱点确认链接
      else if (!data.session) setNotice('注册成功，请去邮箱点确认链接，然后回来登录')
    }
    setBusy(false)
  }

  return (
    <div className="login">
      <header className="topbar">
        <Link to="/">
          <Brand />
        </Link>
      </header>
      <form className="login-form" onSubmit={submit}>
        <h1>{mode === 'login' ? '老师登录' : '注册老师账号'}</h1>
        <input
          type="email"
          autoComplete="email"
          placeholder="邮箱"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label="邮箱"
        />
        <input
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          placeholder={mode === 'login' ? '密码' : '密码（至少 6 位）'}
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-label="密码"
        />
        {error && <p className="error">{error}</p>}
        {notice && <p className="notice">{notice}</p>}
        <button className="btn primary lg block" disabled={busy}>
          {mode === 'login' ? '登录' : '注册'}
        </button>
        <button
          type="button"
          className="btn-link login-switch"
          onClick={() => {
            setMode(mode === 'login' ? 'signup' : 'login')
            setError('')
            setNotice('')
          }}
        >
          {mode === 'login' ? '没有账号？注册' : '已有账号？登录'}
        </button>
      </form>
    </div>
  )
}
