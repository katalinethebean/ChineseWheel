import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const dir = join(__dirname, '../../supabase/migrations')
const CLASSES = '20261017010000_classes.sql'

it('多班级迁移：已有的学生、统计、credits 和进行中的课都归到「我的班级」', async () => {
  const db = await PGlite.create({ extensions: { pgcrypto } })
  await db.exec(readFileSync(join(__dirname, 'supabase-stub.sql'), 'utf8'))
  const files = readdirSync(dir).sort()
  for (const f of files.slice(0, files.indexOf(CLASSES))) await db.exec(readFileSync(join(dir, f), 'utf8'))

  // 模拟线上已有数据
  await db.exec(`
    insert into students (name, total_plus, total_minus, credits) values ('Katherine', 12, -3, 8), ('Alvy', 0, 0, 5);
    insert into lessons default values;
  `)

  await db.exec(readFileSync(join(dir, CLASSES), 'utf8'))

  const cls = (await db.query<{ id: string; name: string; join_code: string }>('select * from classes')).rows
  expect(cls).toHaveLength(1)
  expect(cls[0].name).toBe('我的班级')
  const st = (await db.query<any>('select name, class_id, total_plus, credits from students order by seq')).rows
  expect(st).toEqual([
    { name: 'Katherine', class_id: cls[0].id, total_plus: 12, credits: 8 },
    { name: 'Alvy', class_id: cls[0].id, total_plus: 0, credits: 5 },
  ])
  const ls = (await db.query<any>('select class_id, settled_at from lessons')).rows
  expect(ls).toEqual([{ class_id: cls[0].id, settled_at: null }])
})

it('多班级迁移：空数据库不会建多余的班级', async () => {
  const db = await PGlite.create({ extensions: { pgcrypto } })
  await db.exec(readFileSync(join(__dirname, 'supabase-stub.sql'), 'utf8'))
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(join(dir, f), 'utf8'))
  expect((await db.query('select * from classes')).rows).toHaveLength(0)
})
