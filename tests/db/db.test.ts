import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const TEACHER_A = '00000000-0000-0000-0000-00000000000a'
const TEACHER_B = '00000000-0000-0000-0000-00000000000b'

let db: PGlite

type Who = { role: 'anon' } | { role: 'authenticated'; uid: string } | { role: 'postgres' }
const anon: Who = { role: 'anon' }
const teacherA: Who = { role: 'authenticated', uid: TEACHER_A }
const teacherB: Who = { role: 'authenticated', uid: TEACHER_B }
const admin: Who = { role: 'postgres' }

async function q<T = Record<string, unknown>>(who: Who, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [who.role === 'authenticated' ? who.uid : ''])
  await db.exec(who.role === 'postgres' ? 'reset role' : `set role ${who.role}`)
  try {
    return (await db.query<T>(sql, params)).rows
  } finally {
    await db.exec('reset role')
  }
}

async function one<T = Record<string, unknown>>(who: Who, sql: string, params: unknown[] = []): Promise<T> {
  return (await q<T>(who, sql, params))[0]
}

async function createClass(teacher: Who, names: string[]) {
  const cls = await one<{ id: string; join_code: string }>(
    teacher, `insert into classes (name) values ('测试班') returning id, join_code`)
  for (const name of names) {
    await q(teacher, `insert into students (class_id, name) values ($1, $2)`, [cls.id, name])
  }
  const students = await q<{ id: string; name: string }>(
    teacher, `select id, name from students where class_id = $1 order by seq`, [cls.id])
  const byName = Object.fromEntries(students.map((s) => [s.name, s.id]))
  return { ...cls, byName }
}

const claim = async (code: string, studentId: string) =>
  (await one<{ t: string }>(anon, `select claim_student($1, $2) as t`, [code, studentId])).t
const state = async (token: string) =>
  (await one<{ s: any }>(anon, `select student_state($1) as s`, [token])).s
const adjust = async (token: string, questionId: string, step: number) =>
  (await one<{ w: number }>(anon, `select adjust($1, $2, $3) as w`, [token, questionId, step])).w
const startLesson = async (teacher: Who, classId: string, excludePicked = false) =>
  (await one<{ id: string }>(teacher, `select start_lesson($1, $2) as id`, [classId, excludePicked])).id
const startQuestion = async (teacher: Who, lessonId: string) =>
  (await one<{ id: string }>(teacher, `select start_question($1) as id`, [lessonId])).id
const spin = async (teacher: Who, questionId: string) =>
  (await one<{ r: { winner_id: string; winner_name: string } }>(teacher, `select spin($1) as r`, [questionId])).r
const settle = async (teacher: Who, lessonId: string) =>
  q(teacher, `select settle_lesson($1)`, [lessonId])

async function adjustTimes(token: string, questionId: string, step: number, times: number) {
  let w = 0
  for (let i = 0; i < times; i++) w = await adjust(token, questionId, step)
  return w
}

beforeAll(async () => {
  db = await PGlite.create({ extensions: { pgcrypto } })
  await db.exec(readFileSync(join(__dirname, 'supabase-stub.sql'), 'utf8'))
  const dir = join(__dirname, '../../supabase/migrations')
  for (const file of readdirSync(dir).sort()) {
    await db.exec(readFileSync(join(dir, file), 'utf8'))
  }
  await q(admin, `insert into auth.users (id) values ($1), ($2)`, [TEACHER_A, TEACHER_B])
})

describe('权限', () => {
  it('学生和老师都不能直接读取单题调整', async () => {
    await expect(q(anon, 'select * from adjustments')).rejects.toThrow(/permission denied/)
    await expect(q(teacherA, 'select * from adjustments')).rejects.toThrow(/permission denied/)
  })

  it('匿名用户不能读班级和学生表', async () => {
    await createClass(teacherA, ['甲'])
    await expect(q(anon, 'select * from students')).rejects.toThrow(/permission denied/)
    await expect(q(anon, 'select * from classes')).rejects.toThrow(/permission denied/)
  })

  it('老师看不到别的老师的班级，也不能操作', async () => {
    const cls = await createClass(teacherA, ['乙'])
    expect(await q(teacherB, 'select * from classes where id = $1', [cls.id])).toHaveLength(0)
    expect(await q(teacherB, 'select * from students where class_id = $1', [cls.id])).toHaveLength(0)
    await expect(startLesson(teacherB, cls.id)).rejects.toThrow(/没有权限/)
  })

  it('老师不能直接改统计数字或设备绑定', async () => {
    const cls = await createClass(teacherA, ['丙'])
    await expect(q(teacherA, 'update students set total_plus = 99 where class_id = $1', [cls.id]))
      .rejects.toThrow(/permission denied/)
    await expect(q(teacherA, 'update students set device_token_hash = null where class_id = $1', [cls.id]))
      .rejects.toThrow(/permission denied/)
  })

  it('匿名用户不能调用老师端函数', async () => {
    const cls = await createClass(teacherA, ['丁'])
    await expect(q(anon, 'select start_lesson($1, false)', [cls.id])).rejects.toThrow(/permission denied/)
    await expect(q(anon, 'select spin_candidates(gen_random_uuid())')).rejects.toThrow(/permission denied/)
  })
})

describe('学生认领名字', () => {
  it('能看到名单，一个名字只能被认领一次，老师可以解绑', async () => {
    const cls = await createClass(teacherA, ['张三', '李四'])
    const pub = (await one<{ p: any }>(anon, `select get_class_public($1) as p`, [cls.join_code.toLowerCase()])).p
    expect(pub.students.map((s: any) => s.name)).toEqual(['张三', '李四'])

    const token = await claim(cls.join_code, cls.byName['张三'])
    expect(token).toMatch(/^[0-9a-f]{48}$/)
    await expect(claim(cls.join_code, cls.byName['张三'])).rejects.toThrow(/已经被其他设备认领/)

    expect((await state(token)).student_name).toBe('张三')
    expect((await state('wrong-token')).valid).toBe(false)

    await q(teacherA, `select release_student($1)`, [cls.byName['张三']])
    expect((await state(token)).valid).toBe(false)
    expect(await claim(cls.join_code, cls.byName['张三'])).toBeTruthy()
  })
})

describe('上课流程', () => {
  it('权重从 10 开始，加减一，最低到 0；转完后不能再改', async () => {
    const cls = await createClass(teacherA, ['张三', '李四'])
    const t1 = await claim(cls.join_code, cls.byName['张三'])
    const lesson = await startLesson(teacherA, cls.id)
    await expect(startLesson(teacherA, cls.id)).rejects.toThrow(/未结算/)

    expect((await state(t1)).question).toBeNull()
    const qid = await startQuestion(teacherA, lesson)
    expect(await startQuestion(teacherA, lesson)).toBe(qid)

    expect((await state(t1)).question.weight).toBe(10)
    expect(await adjustTimes(t1, qid, 1, 3)).toBe(13)
    expect(await adjustTimes(t1, qid, -1, 20)).toBe(0)
    expect(await adjust(t1, qid, 1)).toBe(1)
    await expect(adjust(t1, qid, 2)).rejects.toThrow(/只能加一或减一/)

    const ts = await one<{ s: any }>(teacherA, `select teacher_lesson_state($1) as s`, [lesson])
    expect(ts.s.question.adjusted_count).toBe(1)
    // 老师端状态里不包含任何权重信息
    expect(JSON.stringify(ts.s)).not.toMatch(/weight|delta/)

    await spin(teacherA, qid)
    await expect(adjust(t1, qid, 1)).rejects.toThrow(/已经结束/)
    await expect(spin(teacherA, qid)).rejects.toThrow(/已经转过/)
  })

  it('只抽在场的人；权重为 0 的人不会被抽中', async () => {
    const cls = await createClass(teacherA, ['张三', '李四', '王五'])
    const t1 = await claim(cls.join_code, cls.byName['张三'])
    const t2 = await claim(cls.join_code, cls.byName['李四'])
    const lesson = await startLesson(teacherA, cls.id)
    await state(t1)
    await state(t2)
    // 王五没有加入 → 不在场

    for (let i = 0; i < 15; i++) {
      const qid = await startQuestion(teacherA, lesson)
      await adjustTimes(t1, qid, -1, 10)
      expect((await spin(teacherA, qid)).winner_name).toBe('李四')
    }
  })

  it('老师可以手动标记在场 / 不在场，学生刷新不会覆盖', async () => {
    const cls = await createClass(teacherA, ['张三', '李四'])
    const t1 = await claim(cls.join_code, cls.byName['张三'])
    const lesson = await startLesson(teacherA, cls.id)
    await state(t1)
    await q(teacherA, `update attendance set present = false where lesson_id = $1 and student_id = $2`,
      [lesson, cls.byName['张三']])
    await q(teacherA, `insert into attendance (lesson_id, student_id) values ($1, $2)`, [lesson, cls.byName['李四']])
    await state(t1)

    for (let i = 0; i < 10; i++) {
      const qid = await startQuestion(teacherA, lesson)
      expect((await spin(teacherA, qid)).winner_name).toBe('李四')
    }
  })

  it('没有在场学生时不能转；全部为 0 时平均抽', async () => {
    const cls = await createClass(teacherA, ['张三', '李四'])
    const t1 = await claim(cls.join_code, cls.byName['张三'])
    const t2 = await claim(cls.join_code, cls.byName['李四'])
    const lesson = await startLesson(teacherA, cls.id)
    const q0 = await startQuestion(teacherA, lesson)
    await expect(spin(teacherA, q0)).rejects.toThrow(/没有可以抽的学生/)

    await adjustTimes(t1, q0, -1, 10)
    await adjustTimes(t2, q0, -1, 10)
    expect(['张三', '李四']).toContain((await spin(teacherA, q0)).winner_name)
  })

  it('开启"抽过不再抽"后，同一节课不会重复抽到同一个人', async () => {
    const names = ['一', '二', '三', '四', '五']
    const cls = await createClass(teacherA, names)
    const lesson = await startLesson(teacherA, cls.id, true)
    for (const n of names) await state(await claim(cls.join_code, cls.byName[n]))

    const winners = new Set<string>()
    for (let i = 0; i < names.length; i++) {
      winners.add((await spin(teacherA, await startQuestion(teacherA, lesson))).winner_name)
    }
    expect(winners.size).toBe(names.length)
    await expect(spin(teacherA, await startQuestion(teacherA, lesson))).rejects.toThrow(/没有可以抽的学生/)
  })

  it('抽中概率和权重成正比（20 对 10，约 2/3）', async () => {
    const cls = await createClass(teacherA, ['张三', '李四'])
    const t1 = await claim(cls.join_code, cls.byName['张三'])
    const t2 = await claim(cls.join_code, cls.byName['李四'])
    const lesson = await startLesson(teacherA, cls.id)
    await state(t2)

    const N = 300
    let hits = 0
    for (let i = 0; i < N; i++) {
      const qid = await startQuestion(teacherA, lesson)
      await adjustTimes(t1, qid, 1, 10)
      if ((await spin(teacherA, qid)).winner_name === '张三') hits++
    }
    expect(hits / N).toBeGreaterThan(0.55)
    expect(hits / N).toBeLessThan(0.78)
  })
})

describe('下课结算', () => {
  it('按每题最终值累加，重复结算不重复累加，结算后删除单题记录', async () => {
    const cls = await createClass(teacherA, ['张三', '李四'])
    const t1 = await claim(cls.join_code, cls.byName['张三'])
    const t2 = await claim(cls.join_code, cls.byName['李四'])
    const lesson = await startLesson(teacherA, cls.id)

    const q1 = await startQuestion(teacherA, lesson)
    await adjustTimes(t1, q1, 1, 3)      // 张三 +3
    await adjustTimes(t1, q1, -1, 5)     // 再 -5 → 本题 -2
    await adjustTimes(t2, q1, 1, 4)      // 李四 +4
    await spin(teacherA, q1)

    const q2 = await startQuestion(teacherA, lesson)
    await adjustTimes(t1, q2, 1, 6)      // 张三 +6
    await adjustTimes(t2, q2, -1, 12)    // 李四 -10（到底）
    await spin(teacherA, q2)

    const q3 = await startQuestion(teacherA, lesson)
    await adjustTimes(t1, q3, 1, 5)      // 没转就下课 → 不计入

    // 结算前统计不变
    const before = await q<any>(teacherA, `select name, total_plus, total_minus from students where class_id = $1`, [cls.id])
    expect(before.every((s) => s.total_plus === 0 && s.total_minus === 0)).toBe(true)

    await settle(teacherA, lesson)
    await settle(teacherA, lesson)

    const rows = await q<any>(teacherA,
      `select name, total_plus, total_minus from students where class_id = $1 order by seq`, [cls.id])
    expect(rows).toEqual([
      { name: '张三', total_plus: 6, total_minus: -2 },
      { name: '李四', total_plus: 4, total_minus: -10 },
    ])

    const left = await one<{ n: number }>(admin,
      `select count(*)::int as n from adjustments a join questions q on q.id = a.question_id where q.lesson_id = $1`, [lesson])
    expect(left.n).toBe(0)
    expect((await one<any>(admin, `select status from questions where id = $1`, [q3])).status).toBe('cancelled')

    // 结算后可以开新课
    expect(await startLesson(teacherA, cls.id)).toBeTruthy()
  })

  it('清零统计', async () => {
    const cls = await createClass(teacherA, ['张三'])
    const t1 = await claim(cls.join_code, cls.byName['张三'])
    const lesson = await startLesson(teacherA, cls.id)
    const qid = await startQuestion(teacherA, lesson)
    await adjust(t1, qid, 1)
    await spin(teacherA, qid)
    await settle(teacherA, lesson)
    await q(teacherA, `select reset_stats($1)`, [cls.id])
    const row = await one<any>(teacherA, `select total_plus, total_minus from students where class_id = $1`, [cls.id])
    expect(row).toEqual({ total_plus: 0, total_minus: 0 })
  })
})
