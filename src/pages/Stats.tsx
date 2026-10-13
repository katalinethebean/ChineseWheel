import { useEffect, useMemo, useState } from 'react'
import { errorText, supabase } from '../lib/supabase'
import type { StudentRow } from '../lib/types'

type SortKey = 'seq' | 'plus' | 'minus' | 'net'

export function Stats() {
  const [students, setStudents] = useState<StudentRow[] | null>(null)
  const [lastSettled, setLastSettled] = useState<string | null>(null)
  const [sort, setSort] = useState<SortKey>('net')
  const [asc, setAsc] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    ;(async () => {
      const [s, l] = await Promise.all([
        supabase.from('students').select('id, name, seq, claimed, total_plus, total_minus'),
        supabase
          .from('lessons')
          .select('settled_at')
          .not('settled_at', 'is', null)
          .order('settled_at', { ascending: false })
          .limit(1),
      ])
      const err = s.error || l.error
      if (err) return setError(errorText(err))
      setStudents(s.data)
      setLastSettled(l.data[0]?.settled_at ?? null)
    })()
  }, [])

  const rows = useMemo(() => {
    const value = (s: StudentRow) =>
      sort === 'seq' ? s.seq : sort === 'plus' ? s.total_plus : sort === 'minus' ? s.total_minus : s.total_plus + s.total_minus
    return [...(students ?? [])].sort((a, b) => (asc ? 1 : -1) * (value(a) - value(b)) || a.seq - b.seq)
  }, [students, sort, asc])

  const maxAbs = Math.max(1, ...(students ?? []).flatMap((s) => [s.total_plus, -s.total_minus]))

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
              setAsc(key !== 'plus')
            }
          }}
        >
          {label}
          {active ? (asc ? ' ↑' : ' ↓') : ''}
        </button>
      </th>
    )
  }

  if (!students) return error ? <p className="error">{error}</p> : <p className="muted">加载中…</p>

  return (
    <>
      <h1>统计</h1>
      <p className="muted">
        {lastSettled
          ? `数据更新到 ${new Date(lastSettled).toLocaleString('zh-CN')} 下课结算时。`
          : '还没有结算过的课。每节课点「下课结算」后，数据才会出现在这里。'}
        只显示累计结果，看不到每道题的选择。
      </p>

      {students.length === 0 ? (
        <p className="muted">还没有学生，先去「名单」添加。</p>
      ) : (
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
                    <td className={net < 0 ? 'net neg' : net > 0 ? 'net pos' : 'net'}>{net > 0 ? `+${net}` : net}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}
    </>
  )
}
