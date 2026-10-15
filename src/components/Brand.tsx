/** 左上角的公司标识：logo + Silicon Chicken Technologies */
export function Brand({ size = 28 }: { size?: number }) {
  return (
    <span className="brand-mark">
      <img className="logo" src="/logo.jpg" alt="" width={size} height={size} />
      <span className="brand-name">Silicon Chicken Technologies</span>
    </span>
  )
}
