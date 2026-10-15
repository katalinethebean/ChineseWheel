import { Link } from 'react-router-dom'
import { Brand } from '../components/Brand'
import { Wheel, type Slice } from '../components/Wheel'

// 首页装饰用的转盘：六种颜色各一块，没有名字
const DECOR: Slice[] = Array.from({ length: 6 }, () => ({ weight: 1 }))

export function Home() {
  return (
    <div className="home">
      <header className="topbar">
        <Brand />
      </header>
      <main className="home-hero">
        <div className="home-text">
          <h1 className="home-title">课堂转盘</h1>
          <nav className="home-entries">
            <Link to="/teacher" className="home-entry">
              <span>老师</span>
              <span className="home-arrow" aria-hidden>
                →
              </span>
            </Link>
            <Link to="/student" className="home-entry">
              <span>学生</span>
              <span className="home-arrow" aria-hidden>
                →
              </span>
            </Link>
          </nav>
        </div>
        <div className="home-art" aria-hidden>
          <Wheel slices={DECOR} rotation={0} spinning={false} />
        </div>
      </main>
    </div>
  )
}
