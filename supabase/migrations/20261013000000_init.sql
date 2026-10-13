-- 课堂转盘：表结构、权限和数据库函数（单个班级，不需要登录）
--
-- 隐私核心：adjustments（每人每题的加减）没有任何读取权限，客户端无法直接读取。
-- 只能通过下面的 security definer 函数间接使用，函数只返回汇总结果。

create extension if not exists pgcrypto with schema extensions;

-- ───────────────────────── 表 ─────────────────────────

create table public.students (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0),
  seq bigint generated always as identity,
  device_token_hash text unique,
  claimed boolean generated always as (device_token_hash is not null) stored,
  total_plus int not null default 0,
  total_minus int not null default 0,
  created_at timestamptz not null default now()
);

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  settled_at timestamptz,
  exclude_picked boolean not null default false
);
-- 同时只能有一节未结算的课
create unique index lessons_one_active on public.lessons ((settled_at is null)) where settled_at is null;

create table public.attendance (
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  present boolean not null default true,
  primary key (lesson_id, student_id)
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'spun', 'cancelled')),
  winner_student_id uuid references public.students(id) on delete set null,
  created_at timestamptz not null default now(),
  spun_at timestamptz
);
create index on public.questions (lesson_id);
-- 每节课同时只能有一道进行中的题
create unique index questions_one_open on public.questions (lesson_id) where status = 'open';

create table public.adjustments (
  question_id uuid not null references public.questions(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  delta int not null check (delta >= -10),
  primary key (question_id, student_id)
);

-- ───────────────────────── 权限 ─────────────────────────

alter table public.students enable row level security;
alter table public.lessons enable row level security;
alter table public.attendance enable row level security;
alter table public.questions enable row level security;
alter table public.adjustments enable row level security;

-- 先收回所有表权限，再按需授予
revoke all on public.students, public.lessons, public.attendance, public.questions, public.adjustments
  from anon, authenticated;

-- 学生名单：设备令牌哈希不可读；统计数字只能通过函数修改
grant select (id, name, seq, claimed, total_plus, total_minus, created_at) on public.students to anon, authenticated;
grant insert (name), update (name), delete on public.students to anon, authenticated;
create policy students_all on public.students for all to anon, authenticated using (true) with check (true);

-- 课次：只能改"抽过不再抽"开关，开课 / 结算走函数
grant select, update (exclude_picked) on public.lessons to anon, authenticated;
create policy lessons_all on public.lessons for all to anon, authenticated using (true) with check (true);

-- 出勤：老师可手动标记在场 / 不在场
grant select, insert, update, delete on public.attendance to anon, authenticated;
create policy attendance_all on public.attendance for all to anon, authenticated using (true) with check (true);

-- 题目：只读（学生手机靠它接收实时推送），不含任何敏感信息
grant select on public.questions to anon, authenticated;
create policy questions_read on public.questions for select to anon, authenticated using (true);

-- adjustments：不授予任何权限，也不建任何策略。

alter publication supabase_realtime add table public.questions;

-- ───────────────────────── 内部辅助函数 ─────────────────────────

create or replace function public.hash_token(p_token text) returns text
language sql immutable set search_path = public, extensions as $$
  select encode(extensions.digest(p_token, 'sha256'), 'hex');
$$;

create or replace function public.student_by_token(p_token text) returns public.students
language sql stable security definer set search_path = public as $$
  select * from students where device_token_hash = public.hash_token(p_token);
$$;

create or replace function public.active_lesson_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from lessons where settled_at is null order by started_at desc limit 1;
$$;

-- 本题的候选人和权重（只在数据库内部使用）
create or replace function public.spin_candidates(p_question_id uuid)
returns table (student_id uuid, weight int)
language sql stable security definer set search_path = public as $$
  select a.student_id, greatest(0, 10 + coalesce(adj.delta, 0))
  from questions q
  join lessons l on l.id = q.lesson_id
  join attendance a on a.lesson_id = l.id and a.present
  left join adjustments adj on adj.question_id = q.id and adj.student_id = a.student_id
  where q.id = p_question_id
    and not (
      l.exclude_picked and exists (
        select 1 from questions q2
        where q2.lesson_id = l.id and q2.winner_student_id = a.student_id and q2.id <> q.id
      )
    );
$$;

-- ───────────────────────── 学生端函数 ─────────────────────────

create or replace function public.claim_student(p_student_id uuid) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_token text;
begin
  if not exists (select 1 from students where id = p_student_id) then
    raise exception '找不到这个学生' using errcode = 'P0002';
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  update students set device_token_hash = public.hash_token(v_token)
  where id = p_student_id and device_token_hash is null;
  if not found then
    raise exception '这个名字已经被其他设备认领了，请找老师解绑' using errcode = 'P0001';
  end if;
  return v_token;
end;
$$;

create or replace function public.student_state(p_token text) returns json
language plpgsql security definer set search_path = public as $$
declare
  s students;
  v_lesson_id uuid;
  q questions;
  v_delta int;
begin
  s := public.student_by_token(p_token);
  if s.id is null then
    return json_build_object('valid', false);
  end if;

  v_lesson_id := public.active_lesson_id();

  if v_lesson_id is not null then
    -- 打开页面即算在场；老师手动标记为不在场的不会被覆盖
    insert into attendance (lesson_id, student_id) values (v_lesson_id, s.id)
    on conflict do nothing;

    select * into q from questions
    where lesson_id = v_lesson_id and status <> 'cancelled'
    order by created_at desc limit 1;
  end if;

  if q.id is not null then
    select delta into v_delta from adjustments where question_id = q.id and student_id = s.id;
  end if;

  return json_build_object(
    'valid', true,
    'student_id', s.id,
    'student_name', s.name,
    'lesson_active', v_lesson_id is not null,
    'question', case when q.id is null then null else json_build_object(
      'id', q.id,
      'status', q.status,
      'weight', 10 + coalesce(v_delta, 0),
      'winner_name', (select name from students where id = q.winner_student_id),
      'is_me', q.winner_student_id = s.id,
      'seconds_since_spin', extract(epoch from (now() - q.spun_at))
    ) end
  );
end;
$$;

create or replace function public.adjust(p_token text, p_question_id uuid, p_step int) returns int
language plpgsql security definer set search_path = public as $$
declare
  s students;
  q questions;
  v_delta int;
begin
  if p_step not in (-1, 1) then
    raise exception '只能加一或减一' using errcode = '22023';
  end if;

  s := public.student_by_token(p_token);
  if s.id is null then
    raise exception '身份无效，请重新选择名字' using errcode = '42501';
  end if;

  -- for share：和 spin 的 for update 互斥，转盘时不会有人同时改权重
  select * into q from questions where id = p_question_id for share;
  if q.id is null then
    raise exception '找不到这道题' using errcode = 'P0002';
  end if;
  if q.status <> 'open' then
    raise exception '这道题已经结束了' using errcode = 'P0001';
  end if;

  insert into attendance (lesson_id, student_id) values (q.lesson_id, s.id) on conflict do nothing;

  insert into adjustments (question_id, student_id, delta)
  values (q.id, s.id, greatest(-10, p_step))
  on conflict (question_id, student_id)
  do update set delta = greatest(-10, adjustments.delta + p_step)
  returning delta into v_delta;

  return 10 + v_delta;
end;
$$;

-- ───────────────────────── 老师端函数 ─────────────────────────

create or replace function public.start_lesson(p_exclude_picked boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if public.active_lesson_id() is not null then
    raise exception '还有未结算的课，请先下课结算' using errcode = 'P0001';
  end if;
  insert into lessons (exclude_picked) values (p_exclude_picked) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.start_question(p_lesson_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  l lessons;
  v_id uuid;
begin
  select * into l from lessons where id = p_lesson_id;
  if l.id is null then
    raise exception '找不到这节课' using errcode = 'P0002';
  end if;
  if l.settled_at is not null then
    raise exception '这节课已经结算了' using errcode = 'P0001';
  end if;

  select id into v_id from questions where lesson_id = l.id and status = 'open';
  if v_id is null then
    insert into questions (lesson_id) values (l.id) returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.spin(p_question_id uuid) returns json
language plpgsql security definer set search_path = public as $$
declare
  q questions;
  v_count int;
  v_total int;
  v_r double precision;
  v_winner uuid;
begin
  select * into q from questions where id = p_question_id for update;
  if q.id is null then
    raise exception '找不到这道题' using errcode = 'P0002';
  end if;
  if q.status <> 'open' then
    raise exception '这道题已经转过了' using errcode = 'P0001';
  end if;

  select count(*), coalesce(sum(weight), 0) into v_count, v_total
  from public.spin_candidates(q.id);

  if v_count = 0 then
    raise exception '没有可以抽的学生，请确认在场名单' using errcode = 'P0001';
  end if;

  if v_total = 0 then
    -- 所有人权重都是 0：平均抽
    select student_id into v_winner from public.spin_candidates(q.id) order by random() limit 1;
  else
    v_r := random() * v_total;
    select student_id into v_winner from (
      select student_id, sum(weight) over (order by student_id) as cum
      from public.spin_candidates(q.id)
      where weight > 0
    ) t
    where cum > v_r
    order by cum
    limit 1;
  end if;

  update questions set status = 'spun', winner_student_id = v_winner, spun_at = now() where id = q.id;

  return json_build_object('winner_id', v_winner, 'winner_name', (select name from students where id = v_winner));
end;
$$;

create or replace function public.teacher_lesson_state(p_lesson_id uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  l lessons;
  q questions;
begin
  select * into l from lessons where id = p_lesson_id;
  if l.id is null then
    raise exception '找不到这节课' using errcode = 'P0002';
  end if;

  select * into q from questions
  where lesson_id = l.id and status <> 'cancelled'
  order by created_at desc limit 1;

  return json_build_object(
    'lesson', json_build_object('id', l.id, 'started_at', l.started_at, 'settled_at', l.settled_at,
                                'exclude_picked', l.exclude_picked),
    'students', coalesce((
      select json_agg(json_build_object(
        'id', s.id,
        'name', s.name,
        'joined', a.student_id is not null,
        'present', coalesce(a.present, false),
        'picked', exists (select 1 from questions q2 where q2.lesson_id = l.id and q2.winner_student_id = s.id)
      ) order by s.seq)
      from students s
      left join attendance a on a.lesson_id = l.id and a.student_id = s.id
    ), '[]'::json),
    'question', case when q.id is null then null else json_build_object(
      'id', q.id,
      'status', q.status,
      'winner_id', q.winner_student_id,
      'winner_name', (select name from students where id = q.winner_student_id),
      'adjusted_count', (select count(*) from adjustments where question_id = q.id and delta <> 0)
    ) end
  );
end;
$$;

create or replace function public.settle_lesson(p_lesson_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  l lessons;
begin
  select * into l from lessons where id = p_lesson_id for update;
  if l.id is null or l.settled_at is not null then
    return;  -- 已结算过，不重复累加
  end if;

  update questions set status = 'cancelled' where lesson_id = l.id and status = 'open';

  update students s
  set total_plus = s.total_plus + t.plus,
      total_minus = s.total_minus + t.minus
  from (
    select a.student_id, sum(greatest(a.delta, 0)) as plus, sum(least(a.delta, 0)) as minus
    from adjustments a join questions q on q.id = a.question_id
    where q.lesson_id = l.id and q.status = 'spun'
    group by a.student_id
  ) t
  where s.id = t.student_id;

  -- 汇总完成后删除单题记录，进一步保护隐私
  delete from adjustments a using questions q where q.id = a.question_id and q.lesson_id = l.id;

  update lessons set settled_at = now() where id = l.id;
end;
$$;

create or replace function public.release_student(p_student_id uuid) returns void
language sql security definer set search_path = public as $$
  update students set device_token_hash = null where id = p_student_id;
$$;

create or replace function public.reset_stats() returns void
language sql security definer set search_path = public as $$
  update students set total_plus = 0, total_minus = 0 where true;
$$;

-- ───────────────────────── 函数权限 ─────────────────────────

revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.claim_student(uuid) to anon, authenticated;
grant execute on function public.student_state(text) to anon, authenticated;
grant execute on function public.adjust(text, uuid, int) to anon, authenticated;

grant execute on function public.start_lesson(boolean) to anon, authenticated;
grant execute on function public.start_question(uuid) to anon, authenticated;
grant execute on function public.spin(uuid) to anon, authenticated;
grant execute on function public.teacher_lesson_state(uuid) to anon, authenticated;
grant execute on function public.settle_lesson(uuid) to anon, authenticated;
grant execute on function public.release_student(uuid) to anon, authenticated;
grant execute on function public.reset_stats() to anon, authenticated;
