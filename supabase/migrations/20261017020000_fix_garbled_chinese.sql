-- 修复：之前通过剪贴板粘贴的 SQL 里，中文被错误编码成了乱码。
-- 重新创建所有含中文报错信息的函数（内容和最新版本完全一致），并修正班级名。
-- create or replace 会保留原有的权限设置。

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

update public.classes set name = '我的班级' where name = 'ÊàëÁöÑÁè≠Á∫ß';
