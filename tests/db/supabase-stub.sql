-- 在 PGlite 里模拟 Supabase 的基础环境（auth schema、角色、默认权限），
-- 让迁移文件可以原样运行并测试。

create schema auth;
create schema extensions;
create extension pgcrypto with schema extensions;

create role anon nologin;
create role authenticated nologin;

create table auth.users (id uuid primary key);

create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema public, auth, extensions to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

-- Supabase 默认会把 public schema 下新建的表和函数授权给 anon / authenticated
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;

create publication supabase_realtime;
