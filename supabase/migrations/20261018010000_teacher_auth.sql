-- 老师登录：每个班属于一个老师（Supabase Auth 账号），老师只能看到和管理自己的班。
-- 学生不需要登录：通过班级码查班级和名单，选名字后凭设备令牌操作（和之前一样）。
-- 之前创建的班级 teacher_id 为空，老师登录后可以把它「归到我名下」。

alter table public.classes add column teacher_id uuid references auth.users(id) on delete cascade;
alter table public.classes alter column teacher_id set default auth.uid();
create index on public.classes (teacher_id);

-- ───────── 权限判断 ─────────

create or replace function public.owns_class(p_class_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from classes where id = p_class_id and teacher_id = auth.uid());
$$;

create or replace function public.require_owner(p_class_id uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.owns_class(p_class_id) then
    raise exception '没有权限' using errcode = '42501';
  end if;
end;
$$;

-- ───────── 表权限：只有登录的老师能直接读写自己的班 ─────────

drop policy if exists classes_all on public.classes;
revoke all on public.classes from anon, authenticated;
grant select, delete on public.classes to authenticated;
grant insert (name), update (name) on public.classes to authenticated;
create policy classes_owner on public.classes for all to authenticated
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());

drop policy if exists students_all on public.students;
revoke all on public.students from anon, authenticated;
grant select (id, class_id, name, seq, claimed, total_plus, total_minus, created_at) on public.students to authenticated;
grant insert (class_id, name), update (name), delete on public.students to authenticated;
create policy students_owner on public.students for all to authenticated
  using (public.owns_class(class_id)) with check (public.owns_class(class_id));

drop policy if exists lessons_all on public.lessons;
revoke all on public.lessons from anon, authenticated;
grant select, update (exclude_picked) on public.lessons to authenticated;
create policy lessons_owner on public.lessons for all to authenticated
  using (public.owns_class(class_id)) with check (public.owns_class(class_id));

drop policy if exists attendance_all on public.attendance;
revoke all on public.attendance from anon, authenticated;
grant select, insert, update, delete on public.attendance to authenticated;
create policy attendance_owner on public.attendance for all to authenticated
  using (public.owns_class((select class_id from public.lessons where id = lesson_id)))
  with check (public.owns_class((select class_id from public.lessons where id = lesson_id)));

-- questions 保持公开只读（学生手机靠它接收实时推送，不含敏感信息）

-- ───────── 学生用：凭班级码查班级和名单 ─────────

create or replace function public.class_by_code(p_code text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('id', id, 'name', name, 'join_code', join_code)
  from classes where join_code = upper(trim(p_code));
$$;

create or replace function public.class_roster(p_code text) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id', s.id, 'name', s.name, 'claimed', s.claimed) order by s.seq), '[]'::json)
  from students s join classes c on c.id = s.class_id
  where c.join_code = upper(trim(p_code));
$$;

-- ───────── 老师用：认领以前没有老师的班级 ─────────

create or replace function public.unowned_classes() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id', id, 'name', name, 'join_code', join_code) order by created_at), '[]'::json)
  from classes where teacher_id is null;
$$;

create or replace function public.adopt_class(p_class_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception '请先登录' using errcode = '42501';
  end if;
  update classes set teacher_id = auth.uid() where id = p_class_id and teacher_id is null;
  if not found then
    raise exception '这个班级已经有老师了' using errcode = 'P0001';
  end if;
end;
$$;

-- ───────── 老师端函数：加上「只有这个班的老师能操作」 ─────────

create or replace function public.start_lesson(p_class_id uuid, p_exclude_picked boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  perform public.require_owner(p_class_id);
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

create or replace function public.start_question(p_lesson_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  l lessons;
  v_id uuid;
begin
  select * into l from lessons where id = p_lesson_id;
  perform public.require_owner(l.class_id);
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
  v_ids uuid[];
  v_r double precision;
  v_winner uuid;
begin
  select * into q from questions where id = p_question_id for update;
  perform public.require_owner((select class_id from lessons where id = q.lesson_id));
  if q.id is null then
    raise exception '找不到这道题' using errcode = 'P0002';
  end if;
  if q.status <> 'open' then
    raise exception '这道题已经转过了' using errcode = 'P0001';
  end if;

  select count(*), coalesce(sum(weight), 0), coalesce(array_agg(student_id), '{}')
  into v_count, v_total, v_ids
  from public.spin_candidates(q.id);

  if v_count = 0 then
    raise exception '没有可以抽的学生，请确认在场名单' using errcode = 'P0001';
  end if;

  if v_total = 0 then
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

  -- 结算 credits（只算在转盘上的人）：
  --   减权：每 1 花 1 个
  --   加权且被抽中：每 5 赚 1 个（向下取整）
  --   加权没被抽中（安慰奖）：+5~49 给 1 个，+50 以上给 2 个
  update students s set credits = greatest(0, s.credits + case
    when a.delta <= 0 then a.delta
    when a.student_id = v_winner then a.delta / 5
    when a.delta >= 50 then 2
    when a.delta >= 5 then 1
    else 0
  end)
  from adjustments a
  where a.question_id = q.id and a.student_id = s.id and s.id = any(v_ids);

  insert into spin_snapshots (question_id, total_weight, candidate_ids) values (q.id, v_total, v_ids);
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
  perform public.require_owner(l.class_id);
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
  perform public.require_owner(l.class_id);
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

create or replace function public.release_student(p_student_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_owner((select class_id from students where id = p_student_id));
  update students set device_token_hash = null where id = p_student_id;
end;
$$;

create or replace function public.release_all(p_class_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_owner(p_class_id);
  update students set device_token_hash = null where class_id = p_class_id and device_token_hash is not null;
end;
$$;

create or replace function public.reset_stats(p_class_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_owner(p_class_id);
  update students set total_plus = 0, total_minus = 0, credits = 5 where class_id = p_class_id;
end;
$$;

create or replace function public.reset_credits(p_class_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_owner(p_class_id);
  update students set credits = 5 where class_id = p_class_id;
end;
$$;

-- ───────── 函数权限 ─────────

revoke execute on function public.require_owner(uuid) from public, anon, authenticated;
revoke execute on function public.owns_class(uuid) from public, anon;
grant execute on function public.owns_class(uuid) to authenticated;  -- RLS 策略里要用

revoke execute on function public.class_by_code(text), public.class_roster(text) from public;
grant execute on function public.class_by_code(text), public.class_roster(text) to anon, authenticated;

revoke execute on function public.unowned_classes(), public.adopt_class(uuid),
  public.start_lesson(uuid, boolean), public.start_question(uuid), public.spin(uuid),
  public.teacher_lesson_state(uuid), public.settle_lesson(uuid), public.release_student(uuid),
  public.release_all(uuid), public.reset_stats(uuid), public.reset_credits(uuid)
  from public, anon;
grant execute on function public.unowned_classes(), public.adopt_class(uuid),
  public.start_lesson(uuid, boolean), public.start_question(uuid), public.spin(uuid),
  public.teacher_lesson_state(uuid), public.settle_lesson(uuid), public.release_student(uuid),
  public.release_all(uuid), public.reset_stats(uuid), public.reset_credits(uuid)
  to authenticated;
