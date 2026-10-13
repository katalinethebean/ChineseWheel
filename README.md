# 课堂转盘

老师投屏转盘，学生用手机给自己加减权重。老师只能看到下课结算后的累计结果，看不到单题选择。

单个班级，不需要登录：首页选「我是老师」（`/teacher`）或「我是学生」（`/student`）。

设计文档：[docs/superpowers/specs/2026-10-13-classroom-wheel-design.md](docs/superpowers/specs/2026-10-13-classroom-wheel-design.md)

## 首次设置

1. 在项目根目录建 `.env.local`：
   ```
   VITE_SUPABASE_URL=https://你的项目.supabase.co
   VITE_SUPABASE_ANON_KEY=你的 anon key
   ```
2. 创建数据库结构：把 `supabase/migrations/20261013000000_init.sql` 的全部内容粘贴到 Supabase 后台的 SQL Editor 里运行。

## 开发

```bash
npm install
npm run dev      # 本地运行
npm test         # 数据库测试（PGlite，不需要 Docker）+ 转盘角度测试
npm run build    # 打包到 dist/
```

## 部署

`dist/` 是纯静态网站，可以部署到 Netlify / Vercel。记得在托管平台上设置同样的两个环境变量。
`public/_redirects` 已经配置好 Netlify 的单页应用路由。

## 文件结构

- `supabase/migrations/` — 表结构、权限、所有数据库函数（抽签、结算都在这里）
- `tests/db/` — 数据库测试
- `src/pages/` — 首页（Home）、老师端（Lesson、Roster、Stats）、学生端（Student）
- `src/components/Wheel.tsx` — 转盘
- `src/lib/wheel.ts` — 转盘角度计算
