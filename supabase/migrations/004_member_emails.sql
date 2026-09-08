-- ============================================================
-- Migration 004: hàm lấy email thành viên trong 1 workspace
--
-- Trang "Thành viên" cần hiển thị email (full_name có thể trống với
-- user đăng ký qua Google mà không set tên, hoặc user mới chưa cập
-- nhật hồ sơ). Email nằm trong auth.users — client dùng anon key
-- không đọc trực tiếp được, nên cần 1 hàm SECURITY DEFINER, có tự
-- kiểm tra người gọi phải là thành viên (hoặc super admin) của đúng
-- workspace đó mới trả kết quả.
-- ============================================================

CREATE OR REPLACE FUNCTION public.list_workspace_member_emails(ws_id uuid)
RETURNS TABLE(user_id uuid, email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.email
  FROM auth.users u
  JOIN public.workspace_members wm ON wm.user_id = u.id
  WHERE wm.workspace_id = ws_id
    AND (public.is_superadmin() OR public.is_workspace_member(ws_id));
$$;
