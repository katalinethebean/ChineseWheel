import { useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { ClassRow } from './types'

/** 立即调用一次 fn，之后每隔 ms 毫秒调用一次（页面在后台时暂停） */
export function usePolling(fn: () => unknown, ms: number, enabled = true) {
  const fnRef = useRef(fn)
  fnRef.current = fn
  useEffect(() => {
    if (!enabled) return
    const tick = () => {
      if (document.visibilityState === 'visible') fnRef.current()
    }
    fnRef.current()
    const id = window.setInterval(tick, ms)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [ms, enabled])
}

/** 读取一个班级；undefined = 加载中，null = 不存在 */
export function useClass(classId: string | undefined) {
  const [cls, setCls] = useState<ClassRow | null | undefined>(undefined)
  useEffect(() => {
    if (!classId) return
    let alive = true
    supabase
      .from('classes')
      .select('*')
      .eq('id', classId)
      .maybeSingle()
      .then(({ data }) => alive && setCls(data))
    // 别处改了班级名时更新
    const onRenamed = (e: Event) => {
      const { id, name } = (e as CustomEvent<{ id: string; name: string }>).detail
      if (id === classId) setCls((c) => (c ? { ...c, name } : c))
    }
    window.addEventListener('class-renamed', onRenamed)
    return () => {
      alive = false
      window.removeEventListener('class-renamed', onRenamed)
    }
  }, [classId])
  return cls
}

/** 改班级名，并通知页面上所有显示这个班级名的地方 */
export async function renameClass(id: string, name: string) {
  const { error } = await supabase.from('classes').update({ name }).eq('id', id)
  if (error) throw error
  window.dispatchEvent(new CustomEvent('class-renamed', { detail: { id, name } }))
}

/** 老师的登录状态；undefined = 还在读取，null = 未登录 */
export function useSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])
  return session
}
