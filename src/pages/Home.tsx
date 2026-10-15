import { Link } from 'react-router-dom'
import { Wheel, type Slice } from '../components/Wheel'

// 首页装饰用的小转盘：六种颜色各一块，没有名字
const DECOR: Slice[] = Array.from({ length: 6 }, () => ({ weight: 1 }))

export function Home() {
  return (
    <div className="home">
      <header className="home-head">
        <img className="logo" src="/logo.jpg" alt="硅雞科技" width={32} height={32} />
      </header>
      <main className="home-main">
        <div className="home-wheel" aria-hidden>
          <Wheel slices={DECOR} rotation={0} spinning={false} />
        </div>
        <h1 className="home-title">课堂转盘</h1>
        <nav className="home-choices">
          <Link to="/teacher" className="btn primary lg">
            老师
          </Link>
          <Link to="/student" className="btn lg">
            学生
          </Link>
        </nav>
      </main>
    </div>
  )
}
