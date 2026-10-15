import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { errorText, supabase } from '../lib/supabase'
import type { StudentRow } from '../lib/types'

type SortKey = 'seq' | 'plus' | 'minus' | 'net'

export function Stats() {
  const { classId = '' } = useParams()
  const [students, setStudents] = useState<StudentRow[] | null>(null)
  const [lastSettled, setLastSettled] = useState<string | null>(null)
  const [sort, setSort] = useState<SortKey>('net')
  const [asc, setAsc] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    ;(async () => {
      const [s, l] = await Promise.all([
        supabase.from('students').select('id, name, seq, claimed, total_plus, total_minus').eq('class_id', classId),
        supabase
          .from('lessons')
          .select('settled_at')
          .eq('class_id', classId)
          .not('settled_at', 'is', null)
          .order('settled_at', { ascending: false })
          .limit(1),
      ])
      const err = s.error || l.error
      if (err) return setError(errorText(err))
      setStudents(s.data)
      setLastSettled(l.data[0]?.settled_at ?? null)
    })()
  }, [classId])

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

  if (!students) return error ? <p className="error">{error}</p> : null

  return (
    <>
      <header className="page-head">
        <h1>统计</h1>
        {lastSettled && (
          <span className="count">更新于 {new Date(lastSettled).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
        )}
      </header>

      {students.length === 0 || !lastSettled ? (
        <p className="empty">{students.length === 0 ? '还没有学生' : '下课结算后显示'}</p>
      ) : (
        <table className="stats">
          <thead>
            <tr>
              {header('seq', '名字')}
              {header('plus', '加')}
              {header('minus', '减')}
              {header('net', '净')}
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
                      <span className="num">{s.total_plus ? `+${s.total_plus}` : '0'}</span>
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
      )}
    </>
  )
}
