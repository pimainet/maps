'use client'

// Trước đây `toast`/`setToast` được tạo ở app/page.tsx rồi truyền prop
// xuống từng trang con. Giờ mỗi trang là 1 route riêng nên dùng Context
// để bất kỳ trang nào trong layout (dashboard) cũng gọi được showToast().
import { createContext, useCallback, useContext, useState } from 'react'
import { Check, X } from 'lucide-react'

type ToastContextValue = {
  showToast: (message: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState('')

  const showToast = useCallback((message: string) => {
    setToast(message)
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <div className="toast">
          <Check size={16} />
          {toast}
          <button onClick={() => setToast('')}>
            <X size={14} />
          </button>
        </div>
      )}
    </ToastContext.Provider>
  )
}

/** Gọi showToast(message) từ bất kỳ trang nào trong khu vực dashboard. */
export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast phải dùng bên trong ToastProvider (đã bọc ở layout dashboard)')
  return ctx
}
