import { useEffect, useRef } from 'react'

/** 每隔 ms 毫秒调用一次 fn（页面隐藏时暂停），并立即调用一次 */
export function usePolling(fn: () => unknown, ms: number, enabled = true) {
  const fnRef = useRef(fn)
  fnRef.current = fn
  useEffect(() => {
    if (!enabled) return
    const tick = () => {
      if (document.visibilityState === 'visible') fnRef.current()
    }
    tick()
    const id = window.setInterval(tick, ms)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [ms, enabled])
}
