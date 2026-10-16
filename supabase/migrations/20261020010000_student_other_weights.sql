-- 学生端显示其他人扇区的真实大小（不带名字）。顺序按 md5(学生+题目) 排，同一题内稳定，跨题无法对应到人

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
  v_others int[];
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

      select coalesce(array_agg(c.weight order by md5(c.student_id::text || q.id::text)), '{}')
      into v_others
      from public.spin_candidates(q.id) c
      where c.student_id <> s.id;
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
      'other_weights', v_others,
      'winner_name', (select name from students where id = q.winner_student_id),
      'is_me', q.winner_student_id = s.id,
      'seconds_since_spin', extract(epoch from (now() - q.spun_at))
    ) end
  );
end;
$$;
