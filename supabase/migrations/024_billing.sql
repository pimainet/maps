-- Billing bước 1: đơn hàng + kỳ dịch vụ. Chạy 1 lần trong Supabase SQL editor.
-- ============================================================
-- Migration 024 v3
-- Gói và thanh toán. Idempotent.
-- Nguyên tắc:
--  * Người dùng KHÔNG ghi được subscriptions/payments/workspaces.plan (chỉ service_role).
--  * Một giao dịch ngân hàng chỉ được cộng thời hạn đúng một lần (UNIQUE + khóa dòng).
--  * Số tiền nhận phải khớp số tiền của đơn; lệch thì đánh dấu để xử lý tay, không kích hoạt.
--  * Định nghĩa gói (giá, giới hạn) nằm trong code, bảng chỉ lưu kết quả.
-- ============================================================

-- 1) subscriptions: một dòng mỗi kỳ đã trả --------------------------------
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plan                  text NOT NULL CHECK (plan IN ('basic', 'full')),
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'scheduled', 'expired', 'cancelled')),
  current_period_start  timestamptz NOT NULL,
  current_period_end    timestamptz NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (current_period_end > current_period_start)
);
-- Mỗi workspace chỉ có một subscription đang hoạt động ('scheduled' = kỳ đã trả, chờ tới lượt, ví dụ nâng gói từ kỳ sau)
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_active_per_workspace
  ON public.subscriptions (workspace_id) WHERE status = 'active';

-- 2) payments: mỗi đơn thanh toán -----------------------------------------
CREATE TABLE IF NOT EXISTS public.payments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  order_code       bigint NOT NULL UNIQUE,               -- mã đơn gửi cổng thanh toán
  provider         text NOT NULL CHECK (provider IN ('payos', 'sepay', 'manual')),
  provider_txn_id  text,                                  -- mã giao dịch phía ngân hàng/cổng
  plan             text NOT NULL CHECK (plan IN ('basic', 'full')),
  period_months    integer NOT NULL CHECK (period_months IN (1, 3, 12)),
  amount_vnd       integer NOT NULL CHECK (amount_vnd > 0),   -- số tiền đơn yêu cầu (server tính)
  paid_amount_vnd  integer,                                    -- số tiền thực nhận
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'paid', 'amount_mismatch', 'expired', 'cancelled', 'refunded')),
  raw              jsonb,                                      -- webhook gốc để đối soát
  created_at       timestamptz NOT NULL DEFAULT now(),
  paid_at          timestamptz
);
-- Chống xử lý trùng cùng một giao dịch từ cùng nhà cung cấp
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_txn_unique
  ON public.payments (provider, provider_txn_id) WHERE provider_txn_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_workspace_idx ON public.payments (workspace_id, created_at DESC);

-- 3) Quyền: người dùng chỉ ĐỌC của workspace mình --------------------------
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments      ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.subscriptions, public.payments FROM anon, authenticated;
GRANT SELECT ON public.subscriptions, public.payments TO authenticated;

DROP POLICY IF EXISTS "Members read own subscriptions" ON public.subscriptions;
CREATE POLICY "Members read own subscriptions" ON public.subscriptions
  FOR SELECT TO authenticated
  USING (is_superadmin() OR is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Members read own payments" ON public.payments;
CREATE POLICY "Members read own payments" ON public.payments
  FOR SELECT TO authenticated
  USING (is_superadmin() OR is_workspace_member(workspace_id));

-- 4) apply_payment: kích hoạt/xếp lịch gói, nguyên tử và idempotent --------
--    Quy tắc (đã chốt): mỗi gói = 1 quán; đổi sang gói khác chỉ áp dụng TỪ KỲ SAU,
--    không tính lại tiền giữa kỳ.
--     - Cùng gói với kỳ cuối cùng của workspace  => kéo dài kỳ đó.
--     - Khác gói                                  => thêm kỳ 'scheduled' nối sau kỳ cuối.
--     - Chưa có kỳ nào, hoặc kỳ cuối đã hết hạn   => bắt đầu ngay bây giờ.
--    Chỉ service_role gọi (từ route webhook sau khi đã kiểm chữ ký).
CREATE OR REPLACE FUNCTION public.apply_payment(
  p_order_code      bigint,
  p_provider        text,
  p_txn_id          text,
  p_paid_amount     integer,
  p_raw             jsonb DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pay   public.payments%ROWTYPE;
  last_sub public.subscriptions%ROWTYPE;
  new_end timestamptz;
BEGIN
  -- Khóa dòng đơn để hai webhook song song không cùng cộng thời hạn
  SELECT * INTO pay FROM public.payments WHERE order_code = p_order_code FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'order_not_found';
  END IF;

  IF pay.status = 'paid' THEN
    RETURN 'already_paid';              -- webhook gửi lại: bỏ qua, không cộng lần hai
  END IF;
  IF pay.status IN ('cancelled', 'expired', 'refunded') THEN
    RETURN 'order_closed';
  END IF;
  -- Đơn tạo từ web luôn là 'manual' (chờ đối soát); webhook cổng/ngân hàng được phép nhận đơn đó
  IF p_provider <> pay.provider AND pay.provider <> 'manual' THEN
    RETURN 'provider_mismatch';
  END IF;

  IF p_paid_amount <> pay.amount_vnd THEN
    UPDATE public.payments
       SET status = 'amount_mismatch', provider = p_provider, paid_amount_vnd = p_paid_amount,
           provider_txn_id = p_txn_id, raw = p_raw
     WHERE id = pay.id;
    RETURN 'amount_mismatch';           -- không kích hoạt; bạn xử lý tay
  END IF;

  UPDATE public.payments
     SET status = 'paid', provider = p_provider, paid_amount_vnd = p_paid_amount,
         provider_txn_id = p_txn_id, raw = p_raw, paid_at = now()
   WHERE id = pay.id;

  -- Khóa mọi kỳ của workspace này trong lúc xử lý
  PERFORM 1 FROM public.subscriptions WHERE workspace_id = pay.workspace_id FOR UPDATE;

  -- Kỳ cuối cùng (muộn nhất) trong các kỳ đang hoạt động hoặc đã xếp lịch
  SELECT * INTO last_sub
    FROM public.subscriptions
   WHERE workspace_id = pay.workspace_id AND status IN ('active', 'scheduled')
   ORDER BY current_period_end DESC
   LIMIT 1;

  IF NOT FOUND OR last_sub.current_period_end <= now() THEN
    -- Bắt đầu ngay: đóng kỳ cũ (nếu còn dòng), tạo kỳ mới
    UPDATE public.subscriptions SET status = 'expired'
     WHERE workspace_id = pay.workspace_id AND status IN ('active', 'scheduled');
    INSERT INTO public.subscriptions (workspace_id, plan, status, current_period_start, current_period_end)
    VALUES (pay.workspace_id, pay.plan, 'active', now(), now() + make_interval(months => pay.period_months));
    UPDATE public.workspaces SET plan = pay.plan WHERE id = pay.workspace_id;
    RETURN 'activated';
  ELSIF last_sub.plan = pay.plan THEN
    -- Cùng gói: kéo dài kỳ cuối
    new_end := last_sub.current_period_end + make_interval(months => pay.period_months);
    UPDATE public.subscriptions SET current_period_end = new_end WHERE id = last_sub.id;
    RETURN 'extended';
  ELSE
    -- Khác gói: xếp lịch từ cuối kỳ cuối cùng
    INSERT INTO public.subscriptions (workspace_id, plan, status, current_period_start, current_period_end)
    VALUES (pay.workspace_id, pay.plan, 'scheduled', last_sub.current_period_end,
            last_sub.current_period_end + make_interval(months => pay.period_months));
    RETURN 'scheduled';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_payment(bigint, text, text, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.apply_payment(bigint, text, text, integer, jsonb) TO service_role;

-- 5) roll_subscriptions: chuyển kỳ chờ thành kỳ chính, hạ về miễn phí sau 3 ngày ngừng
--    Gọi từ cron hiện có (CRON_SECRET), nên chạy ít nhất mỗi giờ.
CREATE OR REPLACE FUNCTION public.roll_subscriptions(p_grace_days integer DEFAULT 3)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.subscriptions%ROWTYPE;
  changed integer := 0;
BEGIN
  -- a) Đến lượt kỳ đã xếp lịch: đóng kỳ đang hoạt động, mở kỳ mới, đổi gói
  FOR r IN
    SELECT * FROM public.subscriptions
     WHERE status = 'scheduled' AND current_period_start <= now()
     ORDER BY current_period_start
  LOOP
    UPDATE public.subscriptions SET status = 'expired'
     WHERE workspace_id = r.workspace_id AND status = 'active';
    UPDATE public.subscriptions SET status = 'active' WHERE id = r.id;
    UPDATE public.workspaces SET plan = r.plan WHERE id = r.workspace_id;
    changed := changed + 1;
  END LOOP;

  -- b) Hết hạn quá thời gian chờ và không còn kỳ nào chờ: hạ về miễn phí (giữ dữ liệu)
  WITH due AS (
    UPDATE public.subscriptions s
       SET status = 'expired'
     WHERE s.status = 'active'
       AND s.current_period_end < now() - make_interval(days => p_grace_days)
       AND NOT EXISTS (SELECT 1 FROM public.subscriptions n
                        WHERE n.workspace_id = s.workspace_id AND n.status = 'scheduled')
    RETURNING s.workspace_id
  )
  UPDATE public.workspaces w SET plan = 'free'
   WHERE w.id IN (SELECT workspace_id FROM due);

  RETURN changed;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.roll_subscriptions(integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.roll_subscriptions(integer) TO service_role;
