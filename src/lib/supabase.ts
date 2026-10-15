import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!url || !key) {
  throw new Error('缺少 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY，请检查 .env.local')
}

export const supabase = createClient(url, key)

/** 把 Supabase / 网络错误转成给人看的中文提示 */
export function errorText(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) {
    const msg = String((e as { message: unknown }).message)
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return '网络连接失败，请检查网络后重试'
    if (/Invalid login credentials/i.test(msg)) return '邮箱或密码不正确'
    if (/Email not confirmed/i.test(msg)) return '邮箱还没确认，请先点邮件里的确认链接'
    if (/User already registered/i.test(msg)) return '这个邮箱已经注册过了，请直接登录'
    if (/Password should be at least/i.test(msg)) return '密码至少 6 位'
    if (/rate limit/i.test(msg)) return '操作太频繁，请稍后再试'
    if (/valid email|invalid format/i.test(msg)) return '邮箱格式不对'
    if (/duplicate key/i.test(msg)) return '名字重复了'
    return msg
  }
  return '出错了，请重试'
}

/** 调用数据库函数，出错时抛出 */
export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}
