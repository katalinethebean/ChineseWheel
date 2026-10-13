import { useEffect, useState } from 'react'
import { errorText, rpc, supabase } from '../lib/supabase'
import type { StudentRow } from '../lib/types'

const STUDENT_COLUMNS = 'id, name, seq, claimed, total_plus, total_minus'

/** 粘贴的名单：按换行、逗号、顿号、分号拆分 */
function parseNames(text: string): string[] {
  const names = text
    .split(/[\n,，、;；\t]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  return [...new Set(names)]
}

export function Roster() {
  const [students, setStudents] = useState<StudentRow[] | null>(null)
  const [paste, setPaste] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function load() {
    const { data, error } = await supabase.from('students').select(STUDENT_COLUMNS).order('seq')
    if (error) return setError(errorText(error))
    setStudents(data)
  }

  useEffect(() => {
    load()
  }, [])

  async function run(action: () => PromiseLike<{ error: unknown } | void>, ok?: string) {
    setError('')
    setNotice('')
    try {
      const res = await action()
      if (res && res.error) throw res.error
      if (ok) setNotice(ok)
      await load()
    } catch (e) {
      setError(errorText(e))
    }
  }

  async function addStudents() {
    const names = parseNames(paste)
    if (names.length === 0) return
    const existing = new Set((students ?? []).map((s) => s.name))
    const fresh = names.filter((n) => !existing.has(n))
    await run(
      () => supabase.from('students').insert(fresh.map((name) => ({ name }))),
      fresh.length === names.length
        ? `已添加 ${fresh.length} 人`
        : `已添加 ${fresh.length} 人，跳过 ${names.length - fresh.length} 个重复名字`,
    )
    setPaste('')
  }

  async function rename(s: StudentRow) {
    const name = window.prompt('新名字', s.name)?.trim()
    if (!name || name === s.name) return
    await run(() => supabase.from('students').update({ name }).eq('id', s.id))
  }

  async function remove(s: StudentRow) {
    if (!window.confirm(`确定删除「${s.name}」吗？这个学生的统计数据也会一起删除。`)) return
    await run(() => supabase.from('students').delete().eq('id', s.id))
  }

  async function release(s: StudentRow) {
    if (!window.confirm(`解绑「${s.name}」的设备？解绑后学生需要重新选择名字。`)) return
    await run(() => rpc('release_student', { p_student_id: s.id }), `已解绑 ${s.name}`)
  }

  async function releaseAll() {
    if (!window.confirm('让所有学生重新选择名字吗？已经加入的学生会回到选名字的页面。')) return
    await run(() => rpc('release_all'), '已全部解绑，学生需要重新选择名字')
  }

  async function resetStats() {
    if (!window.confirm('确定把所有学生的统计清零吗？此操作无法撤销。')) return
    await run(() => rpc('reset_stats'), '统计已清零')
  }

  const pending = parseNames(paste).length

  return (
    <>
      <div className="title-row">
        <h1>
          名单 {students && <span className="muted count">{students.length} 人</span>}
        </h1>
      </div>

      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      <section className="card">
        <h2>添加学生</h2>
        <p className="muted small">每行一个名字，也可以用逗号或顿号隔开。可以直接从 Excel 复制一列粘贴进来。</p>
        <textarea rows={5} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'张三\n李四\n王五'} />
        <button className="btn primary" onClick={addStudents} disabled={pending === 0}>
          添加{pending > 0 ? ` ${pending} 人` : ''}
        </button>
      </section>

      {students === null ? (
        !error && <p className="muted">加载中…</p>
      ) : students.length > 0 ? (
        <section className="card">
          <h2>全部学生</h2>
          <table className="table">
            <thead>
              <tr>
                <th>名字</th>
                <th>设备</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.claimed ? <span className="tag ok">已绑定</span> : <span className="tag">未绑定</span>}</td>
                  <td className="actions">
                    {s.claimed && (
                      <button className="btn-link" onClick={() => release(s)}>
                        解绑
                      </button>
                    )}
                    <button className="btn-link" onClick={() => rename(s)}>
                      改名
                    </button>
                    <button className="btn-link danger" onClick={() => remove(s)}>
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="card danger-zone">
        <h2>其他操作</h2>
        <p className="muted small">每次下课结算后，所有学生会自动解绑，下节课重新选名字。</p>
        <div className="row">
          <button className="btn" onClick={releaseAll}>
            全部解绑
          </button>
          <button className="btn danger" onClick={resetStats}>
            统计清零
          </button>
        </div>
      </section>
    </>
  )
}
