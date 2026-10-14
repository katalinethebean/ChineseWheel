import { Link } from 'react-router-dom'

export function Home() {
  return (
    <div className="home">
      <header className="home-head">
        <img className="logo" src="/logo.jpg" alt="硅雞科技" width={32} height={32} />
      </header>
      <main className="home-main">
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
