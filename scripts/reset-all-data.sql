-- 清空所有课堂数据：班级、学生、课次、出勤、题目、单题记录、统计、credits。
-- 表结构和函数保留，老师账号保留。无法撤销。
-- 在 Supabase 后台的 SQL Editor 里运行。

truncate table
  public.classes,
  public.students,
  public.lessons,
  public.attendance,
  public.questions,
  public.adjustments,
  public.spin_snapshots
restart identity cascade;
