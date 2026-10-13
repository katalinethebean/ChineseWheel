-- 每节课结束后清空学生的设备绑定：下节课大家重新选名字（名单和统计保留）
-- 另加「全部解绑」，老师可以随时让所有人重新选

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
  update students set device_token_hash = null where device_token_hash is not null;

  update lessons set settled_at = now() where id = l.id;
end;
$$;

create or replace function public.release_all() returns void
language sql security definer set search_path = public as $$
  update students set device_token_hash = null where device_token_hash is not null;
$$;

revoke execute on function public.settle_lesson(uuid), public.release_all() from public;
grant execute on function public.settle_lesson(uuid) to anon, authenticated;
grant execute on function public.release_all() to anon, authenticated;
