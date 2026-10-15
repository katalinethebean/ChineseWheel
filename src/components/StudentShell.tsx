import type { ReactNode } from 'react'
import { Brand } from './Brand'

/** 学生端页面外壳：和老师端一样的顶栏，内容区按笔记本宽度排版 */
export function StudentShell({
  title,
  right,
  center = false,
  children,
}: {
  title?: string
  right?: ReactNode
  center?: boolean
  children: ReactNode
}) {
  return (
    <div className="student">
      <header className="topbar">
        <div className="topbar-left">
          <Brand />
          {title && <span className="class-switch">{title}</span>}
        </div>
        {right && <div className="topbar-right">{right}</div>}
      </header>
      <main className={center ? 'student-main center' : 'student-main'}>{children}</main>
    </div>
  )
}
