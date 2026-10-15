-- 权重上限改为 100；加权每 5 才赚 1 个 credit（减权仍是每 1 花 1 个）；老师可一键把所有人 credits 复原为 5

update public.adjustments set delta = least(90, delta);
alter table public.adjustments drop constraint if exists adjustments_delta_check;
alter table public.adjustments add constraint adjustments_delta_check check (delta between -9 and 90);

create or replace function public.set_weight(p_token text, p_question_id uuid, p_weight int) returns int
language plpgsql security definer set search_path = public as $$
declare
  s students;
  q questions;
  v_delta int;
begin
  if p_weight is null or p_weight < 1 or p_weight > 100 then
    raise exception '权重只能在 1 到 100 之间' using errcode = '22023';
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
    greatest(public.min_weight(s.credits), least(100, v_current + p_step)));
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

  -- 结算 credits：只算在转盘上的人。加权每 5 赚 1 个（向下取整），减权每 1 花 1 个
  update students s set credits = greatest(0, s.credits + case when a.delta > 0 then a.delta / 5 else a.delta end)
  from adjustments a
  where a.question_id = q.id and a.student_id = s.id and s.id = any(v_ids);

  insert into spin_snapshots (question_id, total_weight, candidate_ids) values (q.id, v_total, v_ids);
  update questions set status = 'spun', winner_student_id = v_winner, spun_at = now() where id = q.id;

  return json_build_object('winner_id', v_winner, 'winner_name', (select name from students where id = v_winner));
end;
$$;

create or replace function public.reset_credits() returns void
language sql security definer set search_path = public as $$
  update students set credits = 5 where true;
$$;

revoke execute on function public.set_weight(text, uuid, int), public.adjust(text, uuid, int), public.spin(uuid),
  public.reset_credits() from public;
grant execute on function public.set_weight(text, uuid, int) to anon, authenticated;
grant execute on function public.adjust(text, uuid, int) to anon, authenticated;
grant execute on function public.spin(uuid) to anon, authenticated;
grant execute on function public.reset_credits() to anon, authenticated;
