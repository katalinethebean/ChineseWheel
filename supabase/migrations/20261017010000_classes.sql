-- 多班级：老师可以建多个班，每个班有 6 位班级码；学生输入班级码加入。
-- 现有的学生和课次会归到一个叫「我的班级」的班里。

-- ───────── 班级表 ─────────

create or replace function public.gen_join_code() returns text
language sql volatile set search_path = public as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, 6);
$$;

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  join_code text not null unique default public.gen_join_code(),
  created_at timestamptz not null default now()
);

-- 现有数据归到「我的班级」
insert into public.classes (name)
select '我的班级' where exists (select 1 from public.students) or exists (select 1 from public.lessons);

alter table public.students add column class_id uuid references public.classes(id) on delete cascade;
update public.students set class_id = (select id from public.classes order by created_at limit 1) where class_id is null;
alter table public.students alter column class_id set not null;
alter table public.students drop constraint if exists students_name_key;
alter table public.students add constraint students_class_name_key unique (class_id, name);
create index on public.students (class_id);

alter table public.lessons add column class_id uuid references public.classes(id) on delete cascade;
update public.lessons set class_id = (select id from public.classes order by created_at limit 1) where class_id is null;
alter table public.lessons alter column class_id set not null;
-- 每个班同时只能有一节未结算的课
drop index if exists public.lessons_one_active;
create unique index lessons_one_active on public.lessons (class_id) where settled_at is null;

-- ───────── 权限 ─────────

alter table public.classes enable row level security;
revoke all on public.classes from anon, authenticated;
grant select, delete on public.classes to anon, authenticated;
grant insert (name), update (name) on public.classes to anon, authenticated;
create policy classes_all on public.classes for all to anon, authenticated using (true) with check (true);
grant execute on function public.gen_join_code() to anon, authenticated;  -- join_code 的默认值

revoke insert on public.students from anon, authenticated;
grant insert (class_id, name) on public.students to anon, authenticated;
grant select (class_id) on public.students to anon, authenticated;

-- ───────── 函数：按班级 ─────────

drop function if exists public.active_lesson_id();
create or replace function public.active_lesson_id(p_class_id uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from lessons where class_id = p_class_id and settled_at is null order by started_at desc limit 1;
$$;

drop function if exists public.start_lesson(boolean);
create or replace function public.start_lesson(p_class_id uuid, p_exclude_picked boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from classes where id = p_class_id) then
    raise exception '找不到这个班级' using errcode = 'P0002';
  end if;
  if public.active_lesson_id(p_class_id) is not null then
    raise exception '这个班还有未结算的课，请先下课结算' using errcode = 'P0001';
  end if;
  insert into lessons (class_id, exclude_picked) values (p_class_id, p_exclude_picked) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.student_state(p_token text) returns json
language plpgsql security definer set search_path = public as $$
declare
  s students;
  v_lesson_id uuid;
  q questions;
  v_delta int;
  v_total int;
  v_count int;
  v_is_candidate boolean;
begin
  s := public.student_by_token(p_token);
  if s.id is null then
    return json_build_object('valid', false);
  end if;

  v_lesson_id := public.active_lesson_id(s.class_id);

  if v_lesson_id is not null then
    insert into attendance (lesson_id, student_id) values (v_lesson_id, s.id)
    on conflict do nothing;

    select * into q from questions
    where lesson_id = v_lesson_id and status <> 'cancelled'
    order by created_at desc limit 1;
  end if;

  if q.id is not null then
    select delta into v_delta from adjustments where question_id = q.id and student_id = s.id;

    if q.status = 'open' then
      select coalesce(sum(weight), 0), count(*), coalesce(bool_or(student_id = s.id), false)
      into v_total, v_count, v_is_candidate
      from public.spin_candidates(q.id);
    else
      select total_weight, cardinality(candidate_ids), s.id = any(candidate_ids)
      into v_total, v_count, v_is_candidate
      from spin_snapshots where question_id = q.id;
    end if;
  end if;

  return json_build_object(
    'valid', true,
    'student_id', s.id,
    'student_name', s.name,
    'class_id', s.class_id,
    'class_name', (select name from classes where id = s.class_id),
    'credits', s.credits,
    'lesson_active', v_lesson_id is not null,
    'question', case when q.id is null then null else json_build_object(
      'id', q.id,
      'status', q.status,
      'weight', 10 + coalesce(v_delta, 0),
      'min_weight', public.min_weight(s.credits),
      'is_candidate', coalesce(v_is_candidate, false),
      'total_weight', coalesce(v_total, 0),
      'candidate_count', coalesce(v_count, 0),
      'winner_name', (select name from students where id = q.winner_student_id),
      'is_me', q.winner_student_id = s.id,
      'seconds_since_spin', extract(epoch from (now() - q.spun_at))
    ) end
  );
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
      where s.class_id = l.class_id
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

  -- 下节课重新选名字
  update students set device_token_hash = null where class_id = l.class_id and device_token_hash is not null;

  update lessons set settled_at = now() where id = l.id;
end;
$$;

drop function if exists public.release_all();
create or replace function public.release_all(p_class_id uuid) returns void
language sql security definer set search_path = public as $$
  update students set device_token_hash = null where class_id = p_class_id and device_token_hash is not null;
$$;

drop function if exists public.reset_stats();
create or replace function public.reset_stats(p_class_id uuid) returns void
language sql security definer set search_path = public as $$
  update students set total_plus = 0, total_minus = 0, credits = 5 where class_id = p_class_id;
$$;

drop function if exists public.reset_credits();
create or replace function public.reset_credits(p_class_id uuid) returns void
language sql security definer set search_path = public as $$
  update students set credits = 5 where class_id = p_class_id;
$$;

revoke execute on function public.active_lesson_id(uuid), public.start_lesson(uuid, boolean), public.student_state(text),
  public.teacher_lesson_state(uuid), public.settle_lesson(uuid), public.release_all(uuid), public.reset_stats(uuid),
  public.reset_credits(uuid) from public, anon, authenticated;
grant execute on function public.start_lesson(uuid, boolean) to anon, authenticated;
grant execute on function public.student_state(text) to anon, authenticated;
grant execute on function public.teacher_lesson_state(uuid) to anon, authenticated;
grant execute on function public.settle_lesson(uuid) to anon, authenticated;
grant execute on function public.release_all(uuid) to anon, authenticated;
grant execute on function public.reset_stats(uuid) to anon, authenticated;
grant execute on function public.reset_credits(uuid) to anon, authenticated;
