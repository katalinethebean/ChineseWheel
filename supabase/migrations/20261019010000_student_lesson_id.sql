-- student_state 返回 lesson_id，让学生端只订阅本节课的题目变化；
-- start_question 先检查课是否存在，再检查权限


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
    'lesson_id', v_lesson_id,
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
  perform public.require_owner(l.class_id);
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
