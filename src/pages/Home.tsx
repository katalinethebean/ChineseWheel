import { Link } from 'react-router-dom'

export function Home() {
  return (
    <div className="home">
      <img className="home-logo" src="/logo.jpg" alt="硅雞科技 Silicon Chicken Technologies" width={240} height={240} />
      <h1 className="home-title">课堂转盘</h1>
      <nav className="home-choices">
        <Link to="/teacher" className="btn primary xl">
          老师
        </Link>
        <Link to="/student" className="btn xl">
          学生
        </Link>
      </nav>
    </div>
  )
}
