import { useEffect, useState, type KeyboardEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { EditIcon } from '../components/Icons'
import { renameClass, useClass } from '../lib/hooks'
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
  const { classId = '' } = useParams()
  const navigate = useNavigate()
  const cls = useClass(classId)
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const [students, setStudents] = useState<StudentRow[] | null>(null)
  const [paste, setPaste] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function load() {
    const { data, error } = await supabase.from('students').select(STUDENT_COLUMNS).eq('class_id', classId).order('seq')
    if (error) return setError(errorText(error))
    setStudents(data)
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
    const existing = new Set((students ?? []).map((s) => s.name))
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
    if (!window.confirm(`删除「${s.name}」？统计也会一起删除。`)) return
    await run(() => supabase.from('students').delete().eq('id', s.id))
  }

  async function release(s: StudentRow) {
    if (!window.confirm(`让「${s.name}」重新选名字？`)) return
    await run(() => rpc('release_student', { p_student_id: s.id }), `已解绑 ${s.name}`)
  }

  async function releaseAll() {
    if (!window.confirm('让所有学生重新选名字？')) return
    await run(() => rpc('release_all', { p_class_id: classId }), '已全部解绑')
  }

  async function resetCredits() {
    if (!window.confirm('把所有人的 credits 复原为 5？')) return
    await run(() => rpc('reset_credits', { p_class_id: classId }), '所有人的 credits 已复原为 5')
  }

  async function saveName() {
    const name = nameDraft?.trim()
    setNameDraft(null)
    if (!name || !cls || name === cls.name) return
    setError('')
    try {
      await renameClass(classId, name)
      setNotice('班级名已修改')
    } catch (e) {
      setError(errorText(e))
    }
  }

  function onNameKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') e.currentTarget.blur()
    if (e.key === 'Escape') {
      setNameDraft(null)
      e.currentTarget.blur()
    }
  }

  async function deleteClass() {
    const current = cls?.name ?? ''
    const typed = window.prompt(`删除班级会同时删除所有学生和统计，无法撤销。\n输入班级名称「${current}」确认：`)
    if (typed?.trim() !== current) return
    const { error } = await supabase.from('classes').delete().eq('id', classId)
    if (error) return setError(errorText(error))
    navigate('/teacher')
  }

  async function resetStats() {
    if (!window.confirm('把所有人的统计和 credits 清零？无法撤销。')) return
    await run(() => rpc('reset_stats', { p_class_id: classId }), '统计已清零')
  }

  const pending = parseNames(paste).length

  return (
    <>
      <header className="page-head class-head">
        <input
          className="title-input"
          value={nameDraft ?? cls?.name ?? ''}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={saveName}
          onKeyDown={onNameKey}
          aria-label="班级名称，点击修改"
          title="点击修改班级名"
          maxLength={40}
        />
        <span className="count">
          {cls && <>班级码 {cls.join_code}</>}
          {students && <> · {students.length} 人</>}
        </span>
      </header>

      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      <div className="add-names">
        <textarea
          rows={3}
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder="粘贴名字，每行一个"
          aria-label="添加学生"
        />
        <button className="btn primary" onClick={addStudents} disabled={pending === 0}>
          添加{pending > 0 ? ` ${pending} 人` : ''}
        </button>
      </div>

      {students && students.length > 0 && (
        <ul className="roster">
          {students.map((s) => (
            <li key={s.id}>
              <span className="roster-name">
                {s.name}
                {s.claimed && <span className="joined-dot" title="已在手机上选了名字" />}
              </span>
              <span className="roster-actions">
                {s.claimed && (
                  <button className="btn-link" onClick={() => release(s)}>
                    解绑
                  </button>
                )}
                <button className="icon-btn" onClick={() => rename(s)} title="改名" aria-label={`给 ${s.name} 改名`}>
                  <EditIcon />
                </button>
                <button className="btn-link danger" onClick={() => remove(s)}>
                  删除
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <footer className="page-foot">
        <button className="btn" onClick={releaseAll}>
          全部解绑
        </button>
        <button className="btn" onClick={resetCredits}>
          credits 复原
        </button>
        <button className="btn danger" onClick={resetStats}>
          统计清零
        </button>
      </footer>
      <footer className="page-foot class-foot">
        <button className="btn ghost danger" onClick={deleteClass}>
          删除班级
        </button>
      </footer>
    </>
  )
}
