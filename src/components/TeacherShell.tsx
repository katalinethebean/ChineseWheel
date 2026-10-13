import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'

/** 老师端页面外壳：顶部导航 */
export function TeacherShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="teacher">
      <header className="topbar">
        <Link to="/" className="brand">
          <img src="/favicon.svg" alt="" width={26} height={26} />
          课堂转盘
        </Link>
        <nav className="tabs">
          <NavLink to="/teacher" end>
            上课
          </NavLink>
          <NavLink to="/teacher/roster">名单</NavLink>
          <NavLink to="/teacher/stats">统计</NavLink>
        </nav>
      </header>
      <main className={wide ? 'container wide' : 'container'}>{children}</main>
    </div>
  )
}
