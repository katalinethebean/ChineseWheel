import type { ReactNode } from 'react'
import { Link, NavLink, useParams } from 'react-router-dom'
import { useClass, useSession } from '../lib/hooks'
import { supabase } from '../lib/supabase'
import { Login } from '../pages/Login'
import { Brand } from './Brand'

/** 老师端页面外壳：需要登录；顶部导航。fit：页面固定为一屏高，不滚动（上课页用） */
export function TeacherShell({ children, fit = false }: { children: ReactNode; fit?: boolean }) {
  const session = useSession()
  if (session === undefined) return null
  if (session === null) return <Login />
  return (
    <Shell fit={fit} email={session.user.email ?? ''}>
      {children}
    </Shell>
  )
}

function Shell({ children, fit, email }: { children: ReactNode; fit: boolean; email: string }) {
  const { classId } = useParams()
  const cls = useClass(classId)

  return (
    <div className={fit ? 'teacher fit' : 'teacher'}>
      <header className="topbar">
        <div className="topbar-left">
          <Link to="/" className="brand">
            <Brand />
          </Link>
          <span className="class-switch">{classId ? (cls?.name ?? '') : '课堂转盘'}</span>
          {classId && (
            <Link to="/teacher" className="btn sm leave-class">
              退出班级
            </Link>
          )}
        </div>
        <div className="topbar-right">
          {classId && (
            <nav className="tabs">
              <NavLink to={`/teacher/${classId}`} end>
                上课
              </NavLink>
              <NavLink to={`/teacher/${classId}/roster`}>名单</NavLink>
              <NavLink to={`/teacher/${classId}/stats`}>统计</NavLink>
            </nav>
          )}
          {!classId && <span className="account">{email}</span>}
          <button className="btn-link" onClick={() => supabase.auth.signOut()}>
            退出登录
          </button>
        </div>
      </header>
      <main className={fit ? 'container wide fit' : 'container'}>
        {classId && cls === null ? <p className="empty">找不到这个班级</p> : children}
      </main>
    </div>
  )
}
