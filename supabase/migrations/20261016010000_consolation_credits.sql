-- 加权的 credits 改为：被抽中按每 5 赚 1 个；没被抽中给安慰奖（+5~49 给 1 个，+50 以上给 2 个）

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

revoke execute on function public.spin(uuid) from public;
grant execute on function public.spin(uuid) to anon, authenticated;
