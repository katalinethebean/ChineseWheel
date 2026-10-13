import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../lib/hooks'
import { supabase } from '../lib/supabase'
import { Login } from '../pages/Login'

/** 老师端页面外壳：未登录时显示登录页 */
export function TeacherShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const session = useSession()

  if (session === undefined) return <div className="page-loading">加载中…</div>
  if (session === null) return <Login />

  return (
    <div className="teacher">
      <header className="topbar">
        <Link to="/" className="brand">
          <img src="/favicon.svg" alt="" width={26} height={26} />
          课堂转盘
        </Link>
        <div className="topbar-right">
          <span className="muted">{session.user.email}</span>
          <button className="btn-link" onClick={() => supabase.auth.signOut()}>
            退出登录
          </button>
        </div>
      </header>
      <main className={wide ? 'container wide' : 'container'}>{children}</main>
    </div>
  )
}
