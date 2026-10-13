import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { errorText, rpc, supabase } from '../lib/supabase'
import type { ClassRow, StudentRow } from '../lib/types'

/** 粘贴的名单：按换行、逗号、顿号、分号拆分 */
function parseNames(text: string): string[] {
  const names = text
    .split(/[\n,，、;；\t]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  return [...new Set(names)]
}

export function ClassRoster() {
  const { classId } = useParams()
  const navigate = useNavigate()
  const [cls, setCls] = useState<ClassRow | null>(null)
  const [students, setStudents] = useState<StudentRow[]>([])
  const [paste, setPaste] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function load() {
    const [c, s] = await Promise.all([
      supabase.from('classes').select('*').eq('id', classId!).single(),
      supabase.from('students').select('*').eq('class_id', classId!).order('seq'),
    ])
    if (c.error) return setError(errorText(c.error))
    if (s.error) return setError(errorText(s.error))
    setCls(c.data)
    setStudents(s.data)
  }

  useEffect(() => {
    load()
  }, [classId])

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
    const existing = new Set(students.map((s) => s.name))
    const fresh = names.filter((n) => !existing.has(n))
    await run(
      () => supabase.from('students').insert(fresh.map((name) => ({ class_id: classId, name }))),
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
    if (!window.confirm(`解绑「${s.name}」的设备？解绑后学生需要重新扫码选择名字。`)) return
    await run(() => rpc('release_student', { p_student_id: s.id }), `已解绑 ${s.name}`)
  }

  async function resetStats() {
    if (!window.confirm('确定把这个班所有学生的统计清零吗？此操作无法撤销。')) return
    await run(() => rpc('reset_stats', { p_class_id: classId }), '统计已清零')
  }

  async function deleteClass() {
    if (!cls) return
    const typed = window.prompt(`删除班级会同时删除所有学生和统计，无法撤销。\n请输入班级名称「${cls.name}」确认：`)
    if (typed?.trim() !== cls.name) return
    const { error } = await supabase.from('classes').delete().eq('id', cls.id)
    if (error) return setError(errorText(error))
    navigate('/')
  }

  async function renameClass() {
    if (!cls) return
    const name = window.prompt('班级名称', cls.name)?.trim()
    if (!name || name === cls.name) return
    await run(() => supabase.from('classes').update({ name }).eq('id', cls.id))
  }

  if (!cls) return error ? <p className="error">{error}</p> : <p className="muted">加载中…</p>

  return (
    <>
      <p className="crumbs">
        <Link to="/">我的班级</Link> / {cls.name}
      </p>
      <div className="title-row">
        <h1>
          {cls.name} <span className="muted count">{students.length} 人</span>
        </h1>
        <div className="row">
          <Link className="btn primary" to={`/class/${cls.id}/lesson`}>
            上课
          </Link>
          <Link className="btn" to={`/class/${cls.id}/stats`}>
            统计
          </Link>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      <section className="card">
        <h2>添加学生</h2>
        <p className="muted small">每行一个名字，也可以用逗号或顿号隔开。可以直接从 Excel 复制一列粘贴进来。</p>
        <textarea rows={5} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'张三\n李四\n王五'} />
        <button className="btn primary" onClick={addStudents} disabled={!paste.trim()}>
          添加{parseNames(paste).length > 0 ? ` ${parseNames(paste).length} 人` : ''}
        </button>
      </section>

      {students.length > 0 && (
        <section className="card">
          <h2>名单</h2>
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
                  <td>
                    {s.device_token_hash ? (
                      <span className="tag ok">已绑定</span>
                    ) : (
                      <span className="tag">未绑定</span>
                    )}
                  </td>
                  <td className="actions">
                    {s.device_token_hash && (
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
      )}

      <section className="card danger-zone">
        <h2>其他操作</h2>
        <div className="row">
          <button className="btn" onClick={renameClass}>
            修改班级名称
          </button>
          <button className="btn danger" onClick={resetStats}>
            统计清零
          </button>
          <button className="btn danger" onClick={deleteClass}>
            删除班级
          </button>
        </div>
      </section>
    </>
  )
}
