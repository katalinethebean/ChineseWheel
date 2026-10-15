import { useEffect, useRef, useState } from 'react'
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
    return () => {
      alive = false
    }
  }, [classId])
  return cls
}
