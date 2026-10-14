import { Link } from 'react-router-dom'

export function Home() {
  return (
    <div className="home">
      <h1 className="home-title">
        <img src="/favicon.svg" alt="" width={44} height={44} />
        课堂转盘
      </h1>
      <nav className="home-choices">
        <Link to="/teacher" className="choice teacher-choice">
          老师
        </Link>
        <Link to="/student" className="choice student-choice">
          学生
        </Link>
      </nav>
    </div>
  )
}
