import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'

/** 老师端页面外壳：顶部导航。fit：页面固定为一屏高，不滚动（上课页用） */
export function TeacherShell({ children, fit = false }: { children: ReactNode; fit?: boolean }) {
  return (
    <div className={fit ? 'teacher fit' : 'teacher'}>
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
      <main className={fit ? 'container wide fit' : 'container'}>{children}</main>
    </div>
  )
}
