-- 1. 权重范围 1–30（delta 在 -9 到 +20 之间），学生端用滑块直接设置权重
-- 2. 学生端转盘：返回自己的权重占比；转盘时保存快照，让学生端动画和结果一致

-- ───────── 权重范围 1–30 ─────────

update public.adjustments set delta = greatest(-9, least(20, delta));
alter table public.adjustments drop constraint if exists adjustments_delta_check;
alter table public.adjustments add constraint adjustments_delta_check check (delta between -9 and 20);

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
  values (q.id, s.id, greatest(-9, p_step))
  on conflict (question_id, student_id)
  do update set delta = greatest(-9, least(20, adjustments.delta + p_step))
  returning delta into v_delta;

  return 10 + v_delta;
end;
$$;

-- 滑块：直接设置本题权重（1–30）
create or replace function public.set_weight(p_token text, p_question_id uuid, p_weight int) returns int
language plpgsql security definer set search_path = public as $$
declare
  s students;
  q questions;
  v_delta int;
begin
  if p_weight is null or p_weight < 1 or p_weight > 30 then
    raise exception '权重只能在 1 到 30 之间' using errcode = '22023';
  end if;

  s := public.student_by_token(p_token);
  if s.id is null then
    raise exception '身份无效，请重新选择名字' using errcode = '42501';
  end if;

  select * into q from questions where id = p_question_id for share;
  if q.id is null then
    raise exception '找不到这道题' using errcode = 'P0002';
  end if;
  if q.status <> 'open' then
    raise exception '这道题已经结束了' using errcode = 'P0001';
  end if;

  insert into attendance (lesson_id, student_id) values (q.lesson_id, s.id) on conflict do nothing;

  insert into adjustments (question_id, student_id, delta) values (q.id, s.id, p_weight - 10)
  on conflict (question_id, student_id) do update set delta = excluded.delta
  returning delta into v_delta;

  return 10 + v_delta;
end;
$$;

-- ───────── 转盘快照（私有，只能通过 student_state 间接读取汇总） ─────────

create table public.spin_snapshots (
  question_id uuid primary key references public.questions(id) on delete cascade,
  total_weight int not null,
  candidate_ids uuid[] not null
);
alter table public.spin_snapshots enable row level security;
revoke all on public.spin_snapshots from anon, authenticated;

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

  insert into spin_snapshots (question_id, total_weight, candidate_ids) values (q.id, v_total, v_ids);
  update questions set status = 'spun', winner_student_id = v_winner, spun_at = now() where id = q.id;

  return json_build_object('winner_id', v_winner, 'winner_name', (select name from students where id = v_winner));
end;
$$;

-- ───────── 学生状态：加入自己的占比 ─────────

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
    'lesson_active', v_lesson_id is not null,
    'question', case when q.id is null then null else json_build_object(
      'id', q.id,
      'status', q.status,
      'weight', 10 + coalesce(v_delta, 0),
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

revoke execute on function public.spin(uuid), public.adjust(text, uuid, int), public.student_state(text),
  public.set_weight(text, uuid, int) from public;
grant execute on function public.set_weight(text, uuid, int) to anon, authenticated;
grant execute on function public.spin(uuid) to anon, authenticated;
grant execute on function public.adjust(text, uuid, int) to anon, authenticated;
grant execute on function public.student_state(text) to anon, authenticated;
