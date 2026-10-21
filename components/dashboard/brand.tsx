// Dấu hiệu thương hiệu dùng chung: biểu tượng ghim bản đồ + chữ "Local Growth OS".
// Dùng ở thanh bên, thanh trên điện thoại, trang đăng nhập/đăng ký và bản xem trước.

export function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <div className="brand-mark" aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 21.5s-6.8-5.7-6.8-11.2a6.8 6.8 0 0 1 13.6 0c0 5.5-6.8 11.2-6.8 11.2Z" />
        <circle cx="12" cy="10.3" r="2.4" fill="currentColor" stroke="none" />
      </svg>
    </div>
  )
}

export function Brand({ className = 'brand' }: { className?: string }) {
  return (
    <div className={className}>
      <BrandMark />
      <span className="brand-name">
        Local Growth<i>OS</i>
      </span>
    </div>
  )
}
