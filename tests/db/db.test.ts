import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

let db: PGlite

type Role = 'anon' | 'postgres'

async function q<T = Record<string, unknown>>(role: Role, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec(role === 'postgres' ? 'reset role' : `set role ${role}`)
  try {
    return (await db.query<T>(sql, params)).rows
  } finally {
    await db.exec('reset role')
  }
}

async function one<T = Record<string, unknown>>(role: Role, sql: string, params: unknown[] = []): Promise<T> {
  return (await q<T>(role, sql, params))[0]
}

/** 以老师身份（匿名）添加学生，返回 名字 → id */
async function addStudents(names: string[]) {
  for (const name of names) await q('anon', `insert into students (name) values ($1)`, [name])
  const rows = await q<{ id: string; name: string }>('anon', `select id, name from students order by seq`)
  return Object.fromEntries(rows.map((s) => [s.name, s.id])) as Record<string, string>
}

const claim = async (studentId: string) =>
  (await one<{ t: string }>('anon', `select claim_student($1) as t`, [studentId])).t
const state = async (token: string) =>
  (await one<{ s: any }>('anon', `select student_state($1) as s`, [token])).s
const adjust = async (token: string, questionId: string, step: number) =>
  (await one<{ w: number }>('anon', `select adjust($1, $2, $3) as w`, [token, questionId, step])).w
const startLesson = async (excludePicked = false) =>
  (await one<{ id: string }>('anon', `select start_lesson($1) as id`, [excludePicked])).id
const startQuestion = async (lessonId: string) =>
  (await one<{ id: string }>('anon', `select start_question($1) as id`, [lessonId])).id
const spin = async (questionId: string) =>
  (await one<{ r: { winner_id: string; winner_name: string } }>('anon', `select spin($1) as r`, [questionId])).r
const settle = async (lessonId: string) => q('anon', `select settle_lesson($1)`, [lessonId])

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
})

beforeEach(async () => {
  await q('postgres', 'truncate students, lessons cascade')
})

describe('权限', () => {
  it('任何人都不能直接读取单题调整', async () => {
    await expect(q('anon', 'select * from adjustments')).rejects.toThrow(/permission denied/)
    await expect(q('anon', 'insert into adjustments values (gen_random_uuid(), gen_random_uuid(), 5)'))
      .rejects.toThrow(/permission denied/)
  })

  it('不能读取设备令牌，也不能直接改统计数字', async () => {
    await addStudents(['甲'])
    await expect(q('anon', 'select device_token_hash from students')).rejects.toThrow(/permission denied/)
    await expect(q('anon', 'update students set total_plus = 99')).rejects.toThrow(/permission denied/)
    await expect(q('anon', 'update students set device_token_hash = null')).rejects.toThrow(/permission denied/)
  })

  it('不能直接修改题目或调用内部函数', async () => {
    await expect(q('anon', `insert into questions (lesson_id) values (gen_random_uuid())`))
      .rejects.toThrow(/permission denied/)
    await expect(q('anon', 'select spin_candidates(gen_random_uuid())')).rejects.toThrow(/permission denied/)
  })
})

describe('学生认领名字', () => {
  it('一个名字只能被认领一次，老师可以解绑', async () => {
    const ids = await addStudents(['张三', '李四'])
    const roster = await q<any>('anon', `select name, claimed from students order by seq`)
    expect(roster).toEqual([{ name: '张三', claimed: false }, { name: '李四', claimed: false }])

    const token = await claim(ids['张三'])
    expect(token).toMatch(/^[0-9a-f]{48}$/)
    await expect(claim(ids['张三'])).rejects.toThrow(/已经被其他设备认领/)
    expect((await one<any>('anon', `select claimed from students where id = $1`, [ids['张三']])).claimed).toBe(true)

    expect((await state(token)).student_name).toBe('张三')
    expect((await state('wrong-token')).valid).toBe(false)

    await q('anon', `select release_student($1)`, [ids['张三']])
    expect((await state(token)).valid).toBe(false)
    expect(await claim(ids['张三'])).toBeTruthy()
  })
})

describe('上课流程', () => {
  it('权重从 10 开始，加减一，最低到 1；转完后不能再改', async () => {
    const ids = await addStudents(['张三', '李四'])
    const t1 = await claim(ids['张三'])
    const lesson = await startLesson()
    await expect(startLesson()).rejects.toThrow(/未结算/)

    expect((await state(t1)).question).toBeNull()
    const qid = await startQuestion(lesson)
    expect(await startQuestion(lesson)).toBe(qid)

    expect((await state(t1)).question.weight).toBe(10)
    expect(await adjustTimes(t1, qid, 1, 3)).toBe(13)
    expect(await adjustTimes(t1, qid, -1, 20)).toBe(1)
    expect(await adjust(t1, qid, 1)).toBe(2)
    await expect(adjust(t1, qid, 2)).rejects.toThrow(/只能加一或减一/)

    const ts = await one<{ s: any }>('anon', `select teacher_lesson_state($1) as s`, [lesson])
    expect(ts.s.question.adjusted_count).toBe(1)
    // 老师端状态里不包含任何权重信息
    expect(JSON.stringify(ts.s)).not.toMatch(/weight|delta/)

    await spin(qid)
    await expect(adjust(t1, qid, 1)).rejects.toThrow(/已经结束/)
    await expect(spin(qid)).rejects.toThrow(/已经转过/)
  })

  it('只抽在场的人', async () => {
    const ids = await addStudents(['张三', '李四', '王五'])
    const t1 = await claim(ids['张三'])
    const t2 = await claim(ids['李四'])
    const lesson = await startLesson()
    await state(t1)
    await state(t2)
    // 王五没有加入 → 不在场

    for (let i = 0; i < 15; i++) {
      const qid = await startQuestion(lesson)
      expect(['张三', '李四']).toContain((await spin(qid)).winner_name)
    }
  })

  it('老师可以手动标记在场 / 不在场，学生刷新不会覆盖', async () => {
    const ids = await addStudents(['张三', '李四'])
    const t1 = await claim(ids['张三'])
    const lesson = await startLesson()
    await state(t1)
    await q('anon', `update attendance set present = false where lesson_id = $1 and student_id = $2`,
      [lesson, ids['张三']])
    await q('anon', `insert into attendance (lesson_id, student_id) values ($1, $2)`, [lesson, ids['李四']])
    await state(t1)

    for (let i = 0; i < 10; i++) {
      expect((await spin(await startQuestion(lesson))).winner_name).toBe('李四')
    }
  })

  it('滑块直接设置权重（1–30），加减按钮也不会超过 30', async () => {
    const ids = await addStudents(['张三'])
    const t1 = await claim(ids['张三'])
    const lesson = await startLesson()
    const qid = await startQuestion(lesson)
    const setW = async (w: number) =>
      (await one<{ w: number }>('anon', `select set_weight($1, $2, $3) as w`, [t1, qid, w])).w
    expect(await setW(25)).toBe(25)
    expect(await setW(1)).toBe(1)
    expect((await state(t1)).question.weight).toBe(1)
    await expect(setW(0)).rejects.toThrow(/1 到 30/)
    await expect(setW(31)).rejects.toThrow(/1 到 30/)
    await setW(30)
    expect(await adjust(t1, qid, 1)).toBe(30)
    await spin(qid)
    await expect(setW(10)).rejects.toThrow(/已经结束/)
  })

  it('没有在场学生时不能转', async () => {
    await addStudents(['张三'])
    const lesson = await startLesson()
    await expect(spin(await startQuestion(lesson))).rejects.toThrow(/没有可以抽的学生/)
  })

  it('学生能看到自己的占比；转完后按快照显示', async () => {
    const ids = await addStudents(['张三', '李四', '王五'])
    const t1 = await claim(ids['张三'])
    const t2 = await claim(ids['李四'])
    const lesson = await startLesson()
    await state(t1)
    await state(t2)
    const qid = await startQuestion(lesson)
    await adjustTimes(t1, qid, 1, 5)    // 15
    await adjustTimes(t2, qid, -1, 3)   // 7

    let s = (await state(t1)).question
    expect(s).toMatchObject({ weight: 15, total_weight: 22, candidate_count: 2, is_candidate: true })
    // 学生端不会拿到别人的名字或权重
    expect(JSON.stringify(s)).not.toMatch(/李四|"7"/)

    await spin(qid)
    // 转完后王五才加入，不影响快照
    await q('anon', `insert into attendance (lesson_id, student_id) values ($1, $2)`, [lesson, ids['王五']])
    s = (await state(t1)).question
    expect(s).toMatchObject({ status: 'spun', weight: 15, total_weight: 22, candidate_count: 2, is_candidate: true })
    expect(s.seconds_since_spin).toBeGreaterThanOrEqual(0)
  })

  it('不在转盘上的学生（被标记不在场）is_candidate 为 false', async () => {
    const ids = await addStudents(['张三', '李四'])
    const t1 = await claim(ids['张三'])
    const lesson = await startLesson()
    await state(t1)
    await q('anon', `insert into attendance (lesson_id, student_id) values ($1, $2)`, [lesson, ids['李四']])
    await q('anon', `update attendance set present = false where student_id = $1`, [ids['张三']])
    const qid = await startQuestion(lesson)
    expect((await state(t1)).question).toMatchObject({ is_candidate: false, total_weight: 10, candidate_count: 1 })
    await spin(qid)
    expect((await state(t1)).question).toMatchObject({ is_candidate: false, candidate_count: 1 })
  })

  it('快照表不能直接读取', async () => {
    await expect(q('anon', 'select * from spin_snapshots')).rejects.toThrow(/permission denied/)
  })

  it('开启"抽过不再抽"后，同一节课不会重复抽到同一个人', async () => {
    const names = ['一', '二', '三', '四', '五']
    const ids = await addStudents(names)
    const lesson = await startLesson(true)
    for (const n of names) await state(await claim(ids[n]))

    const winners = new Set<string>()
    for (let i = 0; i < names.length; i++) {
      winners.add((await spin(await startQuestion(lesson))).winner_name)
    }
    expect(winners.size).toBe(names.length)
    await expect(spin(await startQuestion(lesson))).rejects.toThrow(/没有可以抽的学生/)
  })

  it('抽中概率和权重成正比（20 对 10，约 2/3）', async () => {
    const ids = await addStudents(['张三', '李四'])
    const t1 = await claim(ids['张三'])
    const t2 = await claim(ids['李四'])
    const lesson = await startLesson()
    await state(t2)

    const N = 300
    let hits = 0
    for (let i = 0; i < N; i++) {
      const qid = await startQuestion(lesson)
      await adjustTimes(t1, qid, 1, 10)
      if ((await spin(qid)).winner_name === '张三') hits++
    }
    expect(hits / N).toBeGreaterThan(0.55)
    expect(hits / N).toBeLessThan(0.78)
  })
})

describe('下课结算', () => {
  it('按每题最终值累加，重复结算不重复累加，结算后删除单题记录', async () => {
    const ids = await addStudents(['张三', '李四'])
    const t1 = await claim(ids['张三'])
    const t2 = await claim(ids['李四'])
    const lesson = await startLesson()

    const q1 = await startQuestion(lesson)
    await adjustTimes(t1, q1, 1, 3)      // 张三 +3
    await adjustTimes(t1, q1, -1, 5)     // 再 -5 → 本题 -2
    await adjustTimes(t2, q1, 1, 4)      // 李四 +4
    await spin(q1)

    const q2 = await startQuestion(lesson)
    await adjustTimes(t1, q2, 1, 6)      // 张三 +6
    await adjustTimes(t2, q2, -1, 12)    // 李四 -9（到底，权重 1）
    await spin(q2)

    const q3 = await startQuestion(lesson)
    await adjustTimes(t1, q3, 1, 5)      // 没转就下课 → 不计入

    const before = await q<any>('anon', `select total_plus, total_minus from students`)
    expect(before.every((s) => s.total_plus === 0 && s.total_minus === 0)).toBe(true)

    await settle(lesson)
    await settle(lesson)

    const rows = await q<any>('anon', `select name, total_plus, total_minus from students order by seq`)
    expect(rows).toEqual([
      { name: '张三', total_plus: 6, total_minus: -2 },
      { name: '李四', total_plus: 4, total_minus: -9 },
    ])

    const left = await one<{ n: number }>('postgres', `select count(*)::int as n from adjustments`)
    expect(left.n).toBe(0)
    expect((await one<any>('anon', `select status from questions where id = $1`, [q3])).status).toBe('cancelled')

    expect(await startLesson()).toBeTruthy()
  })

  it('清零统计', async () => {
    const ids = await addStudents(['张三'])
    const t1 = await claim(ids['张三'])
    const lesson = await startLesson()
    const qid = await startQuestion(lesson)
    await adjust(t1, qid, 1)
    await spin(qid)
    await settle(lesson)
    await q('anon', `select reset_stats()`)
    expect(await one<any>('anon', `select total_plus, total_minus from students`)).toEqual({ total_plus: 0, total_minus: 0 })
  })
})
