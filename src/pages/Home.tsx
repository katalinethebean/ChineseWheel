import { Link } from 'react-router-dom'

export function Home() {
  return (
    <div className="home">
      <img src="/favicon.svg" alt="" width={72} height={72} />
      <h1>课堂转盘</h1>
      <div className="home-choices">
        <Link to="/teacher" className="choice teacher-choice">
          <span className="choice-icon" aria-hidden>
            🧑‍🏫
          </span>
          <span className="choice-title">我是老师</span>
          <span className="choice-desc">投屏转盘、管理名单、查看统计</span>
        </Link>
        <Link to="/student" className="choice student-choice">
          <span className="choice-icon" aria-hidden>
            🙋
          </span>
          <span className="choice-title">我是学生</span>
          <span className="choice-desc">选择名字，给自己加减权重</span>
        </Link>
      </div>
    </div>
  )
}
