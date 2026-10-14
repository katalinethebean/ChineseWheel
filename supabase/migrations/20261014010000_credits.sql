-- Credits：每人初始 5 个。加权 1 赚 1 个，减权 1 花 1 个，credits 不能小于 0。
-- 转盘时才结算（只算在转盘上的人），学生只能看到自己的 credits，老师看不到实时余额。

alter table public.students add column if not exists credits int not null default 5 check (credits >= 0);
-- 不授予任何客户端读取 credits 列的权限（students 表是按列授权的），只能通过 student_state 读自己的

-- 本题最低能设到多少：权重不低于 1，且减掉的不能超过剩余 credits
create or replace function public.min_weight(p_credits int) returns int
language sql immutable set search_path = public as $$
  select greatest(1, 10 - p_credits);
$$;

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

  if not exists (select 1 from public.spin_candidates(q.id) where student_id = s.id) then
    raise exception '你这题不在转盘上' using errcode = 'P0001';
  end if;
  if p_weight < public.min_weight(s.credits) then
    raise exception 'credits 不够，最多只能减到 %', public.min_weight(s.credits) using errcode = 'P0001';
  end if;

  insert into adjustments (question_id, student_id, delta) values (q.id, s.id, p_weight - 10)
  on conflict (question_id, student_id) do update set delta = excluded.delta
  returning delta into v_delta;

  return 10 + v_delta;
end;
$$;

-- 旧的加减一接口也遵守 credits 规则
create or replace function public.adjust(p_token text, p_question_id uuid, p_step int) returns int
language plpgsql security definer set search_path = public as $$
declare
  s students;
  v_current int;
begin
  if p_step not in (-1, 1) then
    raise exception '只能加一或减一' using errcode = '22023';
  end if;
  s := public.student_by_token(p_token);
  if s.id is null then
    raise exception '身份无效，请重新选择名字' using errcode = '42501';
  end if;
  select 10 + coalesce((select delta from adjustments where question_id = p_question_id and student_id = s.id), 0)
  into v_current;
  return public.set_weight(p_token, p_question_id,
    greatest(public.min_weight(s.credits), least(30, v_current + p_step)));
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

  -- 结算 credits：只算在转盘上的人
  update students s set credits = greatest(0, s.credits + a.delta)
  from adjustments a
  where a.question_id = q.id and a.student_id = s.id and s.id = any(v_ids);

  insert into spin_snapshots (question_id, total_weight, candidate_ids) values (q.id, v_total, v_ids);
  update questions set status = 'spun', winner_student_id = v_winner, spun_at = now() where id = q.id;

  return json_build_object('winner_id', v_winner, 'winner_name', (select name from students where id = v_winner));
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

  v_lesson_id := public.active_lesson_id();

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

create or replace function public.reset_stats() returns void
language sql security definer set search_path = public as $$
  update students set total_plus = 0, total_minus = 0, credits = 5 where true;
$$;

revoke execute on function public.min_weight(int) from public, anon, authenticated;
revoke execute on function public.set_weight(text, uuid, int), public.adjust(text, uuid, int), public.spin(uuid),
  public.student_state(text), public.reset_stats() from public;
grant execute on function public.set_weight(text, uuid, int) to anon, authenticated;
grant execute on function public.adjust(text, uuid, int) to anon, authenticated;
grant execute on function public.spin(uuid) to anon, authenticated;
grant execute on function public.student_state(text) to anon, authenticated;
grant execute on function public.reset_stats() to anon, authenticated;
