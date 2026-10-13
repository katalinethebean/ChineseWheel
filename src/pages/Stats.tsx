import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { errorText, supabase } from '../lib/supabase'
import type { ClassRow, LessonRow, StudentRow } from '../lib/types'

type SortKey = 'seq' | 'plus' | 'minus' | 'net'

export function Stats() {
  const { classId } = useParams()
  const [cls, setCls] = useState<ClassRow | null>(null)
  const [students, setStudents] = useState<StudentRow[]>([])
  const [lastSettled, setLastSettled] = useState<string | null>(null)
  const [sort, setSort] = useState<SortKey>('net')
  const [asc, setAsc] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    ;(async () => {
      const [c, s, l] = await Promise.all([
        supabase.from('classes').select('*').eq('id', classId!).single(),
        supabase.from('students').select('*').eq('class_id', classId!),
        supabase
          .from('lessons')
          .select('*')
          .eq('class_id', classId!)
          .not('settled_at', 'is', null)
          .order('settled_at', { ascending: false })
          .limit(1),
      ])
      const err = c.error || s.error || l.error
      if (err) return setError(errorText(err))
      setCls(c.data)
      setStudents(s.data)
      setLastSettled((l.data as LessonRow[])[0]?.settled_at ?? null)
    })()
  }, [classId])

  const rows = useMemo(() => {
    const value = (s: StudentRow) =>
      sort === 'seq' ? s.seq : sort === 'plus' ? s.total_plus : sort === 'minus' ? s.total_minus : s.total_plus + s.total_minus
    return [...students].sort((a, b) => (asc ? 1 : -1) * (value(a) - value(b)) || a.seq - b.seq)
  }, [students, sort, asc])

  const maxAbs = Math.max(1, ...students.flatMap((s) => [s.total_plus, -s.total_minus]))

  function header(key: SortKey, label: string) {
    const active = sort === key
    return (
      <th>
        <button
          className={active ? 'sort active' : 'sort'}
          onClick={() => {
            if (active) setAsc(!asc)
            else {
              setSort(key)
              setAsc(key === 'seq' || key === 'minus' || key === 'net')
            }
          }}
        >
          {label}
          {active ? (asc ? ' ↑' : ' ↓') : ''}
        </button>
      </th>
    )
  }

  if (!cls) return error ? <p className="error">{error}</p> : <p className="muted">加载中…</p>

  return (
    <>
      <p className="crumbs">
        <Link to="/">我的班级</Link> / <Link to={`/class/${cls.id}`}>{cls.name}</Link> / 统计
      </p>
      <h1>{cls.name} · 统计</h1>
      <p className="muted">
        {lastSettled
          ? `数据更新到 ${new Date(lastSettled).toLocaleString('zh-CN')} 下课结算时。`
          : '还没有结算过的课。每节课点「下课结算」后，数据才会出现在这里。'}
        只显示累计结果，看不到每道题的选择。
      </p>

      <section className="card">
        <table className="table stats">
          <thead>
            <tr>
              {header('seq', '名字')}
              {header('plus', '累计加')}
              {header('minus', '累计减')}
              {header('net', '净积分')}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const net = s.total_plus + s.total_minus
              return (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>
                    <div className="bar-cell">
                      <span className="bar plus" style={{ width: `${(s.total_plus / maxAbs) * 100}%` }} />
                      <span className="num">+{s.total_plus}</span>
                    </div>
                  </td>
                  <td>
                    <div className="bar-cell">
                      <span className="bar minus" style={{ width: `${(-s.total_minus / maxAbs) * 100}%` }} />
                      <span className="num">{s.total_minus}</span>
                    </div>
                  </td>
                  <td className={net < 0 ? 'net neg' : net > 0 ? 'net pos' : 'net'}>
                    {net > 0 ? `+${net}` : net}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>
    </>
  )
}
