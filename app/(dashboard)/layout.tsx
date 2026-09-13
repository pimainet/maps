import { AppShell } from '@/components/dashboard/app-shell'

// Route group (dashboard): mọi trang trong nhóm này (Tổng quan, Khách
// hàng, Audit, Lộ trình, Nội dung, Việc cần làm, Workspace, Cài đặt...)
// đều được bọc chung 1 lần bởi AppShell (sidebar + topbar). Route group
// không thêm segment vào URL, nên "/" vẫn là app/(dashboard)/page.tsx.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>
}
