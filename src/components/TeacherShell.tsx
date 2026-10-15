import type { ReactNode } from 'react'
import { Link, NavLink, useParams } from 'react-router-dom'
import { useClass } from '../lib/hooks'

/** 老师端页面外壳：顶部导航。fit：页面固定为一屏高，不滚动（上课页用） */
export function TeacherShell({ children, fit = false }: { children: ReactNode; fit?: boolean }) {
  const { classId } = useParams()
  const cls = useClass(classId)

  return (
    <div className={fit ? 'teacher fit' : 'teacher'}>
      <header className="topbar">
        <div className="topbar-left">
          <Link to="/" className="brand">
            <img className="logo" src="/logo.jpg" alt="硅雞科技" width={28} height={28} />
          </Link>
          <Link to="/teacher" className="class-switch" title="切换班级">
            {classId ? (cls?.name ?? '') : '课堂转盘'}
            {classId && <span aria-hidden> ▾</span>}
          </Link>
        </div>
        {classId && (
          <nav className="tabs">
            <NavLink to={`/teacher/${classId}`} end>
              上课
            </NavLink>
            <NavLink to={`/teacher/${classId}/roster`}>名单</NavLink>
            <NavLink to={`/teacher/${classId}/stats`}>统计</NavLink>
          </nav>
        )}
      </header>
      <main className={fit ? 'container wide fit' : 'container'}>
        {classId && cls === null ? <p className="empty">这个班级不存在了</p> : children}
      </main>
    </div>
  )
}
