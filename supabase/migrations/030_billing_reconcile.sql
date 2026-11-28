-- ============================================================
-- Migration 030
-- Đối soát chuyển khoản tự động: sổ giao dịch ngân hàng, khớp mã đơn, kích hoạt/gia hạn,
-- hàng chờ xử lý tay, nhắc gia hạn, nhật ký kiểm toán. Idempotent (chạy lại an toàn).
--
-- Nguyên tắc:
--  * MỌI khoản tiền vào đều được ghi vào bank_transactions TRƯỚC khi khớp (không mất dấu tiền khi không khớp).
--  * Chống trùng: UNIQUE (provider, provider_txn_id) + khoá dòng đơn FOR UPDATE.
--  * Chỉ tự kích hoạt khi mã đơn khớp CHẶT; mã đoán (tolerant) chỉ tự kích hoạt khi số tiền khớp đúng.
--  * Không bao giờ tự đoán đơn theo số tiền: chỉ gợi ý cho admin (suggest_orders_for_transaction).
--  * Chỉ service_role gọi các hàm; người dùng chỉ đọc cột an toàn của payments (không có raw/provider_txn_id).
--  * billing_events chỉ ghi thêm (append-only), có trigger chặn UPDATE/DELETE.
-- Phụ thuộc: 024_billing.sql (payments, subscriptions, apply_payment, roll_subscriptions), pg_trgm.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1) payments: hạn đơn, quá tiền, biên nhận, trạng thái 'partial', nhà cung cấp 'casso' -----------
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS expires_at      timestamptz;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS overpaid_vnd    integer NOT NULL DEFAULT 0;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS receipt_no      text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS receipt_sent_at timestamptz;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS note            text;

UPDATE public.payments SET expires_at = created_at + interval '7 days' WHERE expires_at IS NULL;
ALTER TABLE public.payments ALTER COLUMN expires_at SET DEFAULT (now() + interval '7 days');
ALTER TABLE public.payments ALTER COLUMN expires_at SET NOT NULL;

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_status_check
  CHECK (status IN ('pending', 'partial', 'paid', 'amount_mismatch', 'expired', 'cancelled', 'refunded'));
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_provider_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_provider_check
  CHECK (provider IN ('payos', 'sepay', 'casso', 'manual'));

-- Giữ chứng từ thanh toán khi xoá workspace (trước đây ON DELETE CASCADE). Không có code nào xoá workspace,
-- nên đổi an toàn; đơn mồ côi (workspace_id NULL) không kích hoạt được (xem _billing_settle).
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT con.conname FROM pg_constraint con
            WHERE con.conrelid = 'public.payments'::regclass AND con.contype = 'f'
              AND con.confrelid = 'public.workspaces'::regclass AND con.confdeltype <> 'n'
  LOOP
    EXECUTE format('ALTER TABLE public.payments DROP CONSTRAINT %I', c);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.payments'::regclass AND contype = 'f'
                   AND confrelid = 'public.workspaces'::regclass) THEN
    ALTER TABLE public.payments ADD CONSTRAINT payments_workspace_id_fkey
      FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;
  END IF;
END $$;
ALTER TABLE public.payments ALTER COLUMN workspace_id DROP NOT NULL;

CREATE SEQUENCE IF NOT EXISTS public.receipt_seq;
CREATE UNIQUE INDEX IF NOT EXISTS payments_receipt_no_unique ON public.payments (receipt_no) WHERE receipt_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_open_idx ON public.payments (status, expires_at) WHERE status IN ('pending', 'partial');
CREATE INDEX IF NOT EXISTS payments_unsent_receipt_idx ON public.payments (paid_at) WHERE status = 'paid' AND receipt_sent_at IS NULL;

-- Người dùng không còn đọc được raw / provider_txn_id (có thể chứa tên + số tài khoản người chuyển)
REVOKE SELECT ON public.payments FROM authenticated;
GRANT SELECT (id, workspace_id, order_code, provider, plan, period_months, amount_vnd, paid_amount_vnd, overpaid_vnd,
              status, created_at, paid_at, expires_at, receipt_no)
  ON public.payments TO authenticated;

-- 2) bank_transactions: sổ mọi khoản tiền vào ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bank_transactions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider         text NOT NULL CHECK (provider IN ('sepay', 'casso', 'payos', 'manual')),
  provider_txn_id  text NOT NULL,                       -- id giao dịch phía nhà cung cấp (SePay `id`)
  bank_ref         text,                                -- mã tham chiếu của ngân hàng (SePay `referenceCode`, payOS `reference`)
  account_number   text,                                -- tài khoản nhận
  bank_name        text,
  amount_vnd       bigint NOT NULL CHECK (amount_vnd > 0),
  content          text,                                -- nội dung chuyển khoản gốc
  provider_code    text,                                -- mã thanh toán nhà cung cấp tách sẵn (nếu có)
  transferred_at   timestamptz,                         -- giờ giao dịch theo ngân hàng
  received_at      timestamptz NOT NULL DEFAULT now(),  -- giờ hệ thống nhận
  source           text NOT NULL DEFAULT 'webhook' CHECK (source IN ('webhook', 'poll', 'admin')),
  order_code       bigint,                              -- mã đơn tách được từ nội dung (ứng viên đầu tiên)
  match_confidence text CHECK (match_confidence IN ('exact', 'tolerant', 'manual')),
  status           text NOT NULL DEFAULT 'received'
                   CHECK (status IN ('received', 'matched', 'partial', 'unmatched', 'needs_review', 'duplicate', 'ignored', 'refunded')),
  reason           text,                                -- lý do máy ghi (vd 'no_code', 'underpaid:150000', 'overpaid:51000')
  needs_attention  boolean NOT NULL DEFAULT false,      -- true = nằm trong hàng chờ xử lý tay
  payment_id       uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  reviewed_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at      timestamptz,
  note             text,
  raw              jsonb,
  UNIQUE (provider, provider_txn_id)
);
CREATE INDEX IF NOT EXISTS bank_tx_attention_idx ON public.bank_transactions (received_at DESC) WHERE needs_attention;
CREATE INDEX IF NOT EXISTS bank_tx_payment_idx   ON public.bank_transactions (payment_id);
CREATE INDEX IF NOT EXISTS bank_tx_bankref_idx   ON public.bank_transactions (account_number, bank_ref) WHERE bank_ref IS NOT NULL;
ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bank_transactions FROM anon, authenticated;   -- chỉ service_role (API superadmin) đọc/ghi

-- 3) billing_events: nhật ký kiểm toán, chỉ ghi thêm ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_events (
  id                  bigserial PRIMARY KEY,
  at                  timestamptz NOT NULL DEFAULT now(),
  actor               text NOT NULL,        -- 'webhook:sepay' | 'cron' | 'admin:<uuid>' | 'user:<uuid>' | 'system'
  event               text NOT NULL,
  workspace_id        uuid,                 -- cố ý KHÔNG có FK: giữ nhật ký kể cả khi workspace bị xoá
  order_code          bigint,
  payment_id          uuid,
  bank_transaction_id uuid,
  data                jsonb
);
CREATE INDEX IF NOT EXISTS billing_events_order_idx ON public.billing_events (order_code, at DESC);
CREATE INDEX IF NOT EXISTS billing_events_ws_idx    ON public.billing_events (workspace_id, at DESC);
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_events FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.billing_events_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'billing_events là nhật ký chỉ ghi thêm (append-only)';
END $$;
DROP TRIGGER IF EXISTS billing_events_no_update ON public.billing_events;
CREATE TRIGGER billing_events_no_update BEFORE UPDATE OR DELETE ON public.billing_events
  FOR EACH ROW EXECUTE FUNCTION public.billing_events_immutable();

-- 4) billing_reminders: chống gửi trùng email nhắc gia hạn ---------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_reminders (
  id              bigserial PRIMARY KEY,
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('d14', 'd7', 'd3', 'd1', 'expired', 'downgraded')),
  period_end      timestamptz NOT NULL,     -- gia hạn làm period_end đổi => được nhắc lại cho kỳ mới
  sent_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, kind, period_end)
);
ALTER TABLE public.billing_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_reminders FROM anon, authenticated;

-- 5) Hàm nội bộ ------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._billing_log(p_actor text, p_event text, p_ws uuid, p_order bigint,
                                               p_pay uuid, p_tx uuid, p_data jsonb DEFAULT NULL)
RETURNS void LANGUAGE sql SET search_path = public, pg_temp AS $$
  INSERT INTO public.billing_events (actor, event, workspace_id, order_code, payment_id, bank_transaction_id, data)
  VALUES (p_actor, p_event, p_ws, p_order, p_pay, p_tx, p_data);
$$;

-- Cấp/kéo dài kỳ dịch vụ (logic cũ của apply_payment, tách ra dùng chung). Gọi khi ĐÃ giữ khoá dòng đơn.
--   cùng gói với kỳ cuối  => kéo dài; khác gói => xếp lịch kỳ sau; chưa có/đã hết hạn => bắt đầu ngay.
--   Không đụng workspaces.plan nếu là gói đặt tay (vd 'agency').
CREATE OR REPLACE FUNCTION public._billing_grant_period(p_ws uuid, p_plan text, p_months integer)
RETURNS text LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE last_sub public.subscriptions%ROWTYPE;
BEGIN
  PERFORM 1 FROM public.subscriptions WHERE workspace_id = p_ws FOR UPDATE;
  SELECT * INTO last_sub FROM public.subscriptions
   WHERE workspace_id = p_ws AND status IN ('active', 'scheduled')
   ORDER BY current_period_end DESC LIMIT 1;

  IF NOT FOUND OR last_sub.current_period_end <= now() THEN
    UPDATE public.subscriptions SET status = 'expired' WHERE workspace_id = p_ws AND status IN ('active', 'scheduled');
    INSERT INTO public.subscriptions (workspace_id, plan, status, current_period_start, current_period_end)
    VALUES (p_ws, p_plan, 'active', now(), now() + make_interval(months => p_months));
    UPDATE public.workspaces SET plan = p_plan WHERE id = p_ws AND plan IN ('free', 'basic', 'full');
    RETURN 'activated';
  ELSIF last_sub.plan = p_plan THEN
    UPDATE public.subscriptions
       SET current_period_end = last_sub.current_period_end + make_interval(months => p_months)
     WHERE id = last_sub.id;
    RETURN 'extended';
  ELSE
    INSERT INTO public.subscriptions (workspace_id, plan, status, current_period_start, current_period_end)
    VALUES (p_ws, p_plan, 'scheduled', last_sub.current_period_end,
            last_sub.current_period_end + make_interval(months => p_months));
    RETURN 'scheduled';
  END IF;
END $$;

-- Gán 1 giao dịch vào 1 đơn: cộng dồn các khoản đã gán, đủ tiền thì kích hoạt. Trả: activated|extended|scheduled|
-- partial|already_paid|order_closed|order_not_found. Phải gọi trong cùng giao dịch với việc ghi bank_transactions.
CREATE OR REPLACE FUNCTION public._billing_settle(p_tx uuid, p_order_code bigint, p_actor text, p_confidence text)
RETURNS text LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  t   public.bank_transactions%ROWTYPE;
  pay public.payments%ROWTYPE;
  s   bigint;
  res text;
  was text;
BEGIN
  SELECT * INTO t FROM public.bank_transactions WHERE id = p_tx FOR UPDATE;
  IF NOT FOUND THEN RETURN 'tx_not_found'; END IF;
  SELECT * INTO pay FROM public.payments WHERE order_code = p_order_code FOR UPDATE;
  IF NOT FOUND THEN RETURN 'order_not_found'; END IF;
  was := pay.status;
  IF pay.workspace_id IS NULL THEN
    UPDATE public.bank_transactions
       SET status = 'needs_review', needs_attention = true, payment_id = pay.id, order_code = pay.order_code,
           reason = 'workspace_deleted', match_confidence = p_confidence
     WHERE id = t.id;
    PERFORM public._billing_log(p_actor, 'tx_for_deleted_workspace', NULL, pay.order_code, pay.id, t.id, NULL);
    RETURN 'order_closed';
  END IF;

  IF pay.status = 'paid' THEN
    UPDATE public.bank_transactions
       SET status = 'needs_review', needs_attention = true, payment_id = pay.id, order_code = pay.order_code,
           reason = 'order_already_paid', match_confidence = p_confidence
     WHERE id = t.id;
    PERFORM public._billing_log(p_actor, 'tx_extra_payment_for_paid_order', pay.workspace_id, pay.order_code, pay.id, t.id,
                                jsonb_build_object('amount', t.amount_vnd));
    RETURN 'already_paid';
  ELSIF pay.status = 'refunded' THEN
    UPDATE public.bank_transactions
       SET status = 'needs_review', needs_attention = true, payment_id = pay.id, order_code = pay.order_code,
           reason = 'order_refunded', match_confidence = p_confidence
     WHERE id = t.id;
    PERFORM public._billing_log(p_actor, 'tx_for_refunded_order', pay.workspace_id, pay.order_code, pay.id, t.id, NULL);
    RETURN 'order_closed';
  END IF;

  -- đơn hết hạn/đã bị huỷ tự động vẫn nhận tiền: tiền đã vào tài khoản thì không được bỏ rơi
  UPDATE public.bank_transactions
     SET payment_id = pay.id, order_code = pay.order_code, match_confidence = p_confidence, status = 'partial', reason = NULL
   WHERE id = t.id;
  SELECT COALESCE(SUM(amount_vnd), 0) INTO s FROM public.bank_transactions
   WHERE payment_id = pay.id AND status IN ('partial', 'matched');

  IF s < pay.amount_vnd THEN
    UPDATE public.payments SET status = 'partial', paid_amount_vnd = s WHERE id = pay.id;
    UPDATE public.bank_transactions
       SET needs_attention = true, reason = 'underpaid:' || (pay.amount_vnd - s)
     WHERE id = t.id;
    PERFORM public._billing_log(p_actor, 'order_partial', pay.workspace_id, pay.order_code, pay.id, t.id,
                                jsonb_build_object('received', s, 'expected', pay.amount_vnd, 'missing', pay.amount_vnd - s));
    RETURN 'partial';
  END IF;

  UPDATE public.payments
     SET status = 'paid', provider = t.provider, provider_txn_id = t.provider_txn_id,
         paid_amount_vnd = s, overpaid_vnd = (s - pay.amount_vnd)::integer, paid_at = now(),
         receipt_no = COALESCE(receipt_no, 'BN' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY') || lpad(nextval('public.receipt_seq')::text, 6, '0')),
         raw = jsonb_build_object('bank_transaction_id', t.id)
   WHERE id = pay.id;
  UPDATE public.bank_transactions SET status = 'matched' WHERE payment_id = pay.id AND status = 'partial';
  IF s > pay.amount_vnd THEN
    UPDATE public.bank_transactions SET needs_attention = true, reason = 'overpaid:' || (s - pay.amount_vnd) WHERE id = t.id;
  ELSE
    UPDATE public.bank_transactions SET needs_attention = false WHERE payment_id = pay.id;
  END IF;

  res := public._billing_grant_period(pay.workspace_id, pay.plan, pay.period_months);
  PERFORM public._billing_log(p_actor, 'order_paid', pay.workspace_id, pay.order_code, pay.id, t.id,
                              jsonb_build_object('result', res, 'amount', pay.amount_vnd, 'received', s,
                                                 'overpaid', s - pay.amount_vnd, 'reopened_from', CASE WHEN was IN ('expired', 'cancelled') THEN was END));
  RETURN res;
END $$;

-- 6) Webhook/đối soát gọi hàm này cho MỖI khoản tiền vào ------------------------------------------
-- p_candidates: các mã đơn ứng viên do TS tách từ nội dung (theo thứ tự ưu tiên). p_confidence: 'exact' | 'tolerant'.
-- Trả jsonb {status, result?, tx_id?, order_code?, workspace_id?}; status: duplicate_webhook | duplicate | unmatched |
-- matched (đã kích hoạt/gia hạn/xếp lịch) | partial (còn thiếu tiền) | needs_review (đơn đã trả/đã hoàn tiền) | invalid.
CREATE OR REPLACE FUNCTION public.ingest_bank_transaction(
  p_provider        text,
  p_txn_id          text,
  p_amount          bigint,
  p_content         text,
  p_candidates      bigint[] DEFAULT '{}',
  p_confidence      text     DEFAULT 'exact',
  p_bank_ref        text     DEFAULT NULL,
  p_account         text     DEFAULT NULL,
  p_bank_name       text     DEFAULT NULL,
  p_provider_code   text     DEFAULT NULL,
  p_transferred_at  timestamptz DEFAULT NULL,
  p_source          text     DEFAULT 'webhook',
  p_raw             jsonb    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
  pay  public.payments%ROWTYPE;
  actor text := (CASE WHEN p_source = 'poll' THEN 'poll:' ELSE 'webhook:' END) || p_provider;
  res  text;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 OR COALESCE(p_txn_id, '') = '' THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;
  IF p_confidence NOT IN ('exact', 'tolerant') THEN p_confidence := 'tolerant'; END IF;

  INSERT INTO public.bank_transactions (provider, provider_txn_id, bank_ref, account_number, bank_name, amount_vnd, content,
                                        provider_code, transferred_at, source, order_code, match_confidence, raw)
  VALUES (p_provider, p_txn_id, p_bank_ref, p_account, p_bank_name, p_amount, left(p_content, 500),
          p_provider_code, p_transferred_at, p_source, p_candidates[1], p_confidence, p_raw)
  ON CONFLICT (provider, provider_txn_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('status', 'duplicate_webhook');         -- gửi lại: bỏ qua, vẫn trả thành công cho nhà cung cấp
  END IF;

  -- Cùng 1 giao dịch ngân hàng được báo bởi 2 nhà cung cấp (chạy song song SePay + Casso)
  IF p_bank_ref IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.bank_transactions o
        WHERE o.id <> v_id AND o.account_number IS NOT DISTINCT FROM p_account AND o.bank_ref = p_bank_ref
          AND o.amount_vnd = p_amount AND o.provider <> p_provider AND o.status <> 'duplicate') THEN
    UPDATE public.bank_transactions SET status = 'duplicate', reason = 'same_bank_ref_other_provider' WHERE id = v_id;
    PERFORM public._billing_log(actor, 'tx_duplicate_other_provider', NULL, p_candidates[1], NULL, v_id, jsonb_build_object('bank_ref', p_bank_ref));
    RETURN jsonb_build_object('status', 'duplicate', 'tx_id', v_id);
  END IF;

  -- Chọn đơn ứng viên đầu tiên có thật, theo thứ tự ưu tiên của TS
  SELECT p.* INTO pay
    FROM unnest(p_candidates) WITH ORDINALITY AS c(code, ord)
    JOIN public.payments p ON p.order_code = c.code
   ORDER BY c.ord LIMIT 1;

  IF NOT FOUND THEN
    UPDATE public.bank_transactions
       SET status = 'unmatched', needs_attention = true,
           reason = CASE WHEN cardinality(p_candidates) = 0 THEN 'no_code' ELSE 'code_not_found' END
     WHERE id = v_id;
    PERFORM public._billing_log(actor, 'tx_unmatched', NULL, p_candidates[1], NULL, v_id,
                                jsonb_build_object('amount', p_amount, 'content', left(p_content, 200)));
    RETURN jsonb_build_object('status', 'unmatched', 'tx_id', v_id);
  END IF;

  -- Mã đoán (sai chính tả/thiếu tiền tố) chỉ tự kích hoạt khi SỐ TIỀN KHỚP ĐÚNG; còn lại để admin xem
  IF p_confidence <> 'exact' AND pay.amount_vnd <> p_amount THEN
    UPDATE public.bank_transactions
       SET status = 'unmatched', needs_attention = true, order_code = pay.order_code, reason = 'tolerant_code_amount_mismatch'
     WHERE id = v_id;
    PERFORM public._billing_log(actor, 'tx_unmatched', pay.workspace_id, pay.order_code, pay.id, v_id,
                                jsonb_build_object('amount', p_amount, 'expected', pay.amount_vnd, 'confidence', p_confidence));
    RETURN jsonb_build_object('status', 'unmatched', 'tx_id', v_id, 'order_code', pay.order_code);
  END IF;

  res := public._billing_settle(v_id, pay.order_code, actor, p_confidence);
  RETURN jsonb_build_object(
    'status', CASE WHEN res IN ('activated', 'extended', 'scheduled') THEN 'matched'
                   WHEN res = 'partial' THEN 'partial' ELSE 'needs_review' END,
    'result', res, 'tx_id', v_id, 'order_code', pay.order_code, 'workspace_id', pay.workspace_id);
END $$;

-- 7) Admin xử lý hàng chờ ----------------------------------------------------------------------------
-- p_action: 'assign' (gán vào đơn) | 'ignore' (không phải tiền của dịch vụ) | 'refund' (đã hoàn tiền tay; với giao dịch dư
--           tiền thì chỉ đánh dấu phần dư đã hoàn, đơn vẫn giữ) | 'ack' (đã xem, giữ nguyên)
CREATE OR REPLACE FUNCTION public.admin_resolve_transaction(
  p_tx uuid, p_action text, p_order_code bigint DEFAULT NULL, p_admin uuid DEFAULT NULL, p_note text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t public.bank_transactions%ROWTYPE;
  actor text := 'admin:' || COALESCE(p_admin::text, 'unknown');
  res text;
  s bigint;
BEGIN
  SELECT * INTO t FROM public.bank_transactions WHERE id = p_tx FOR UPDATE;
  IF NOT FOUND THEN RETURN 'tx_not_found'; END IF;

  IF p_action = 'assign' THEN
    IF p_order_code IS NULL THEN RETURN 'need_order_code'; END IF;
    IF t.status NOT IN ('unmatched', 'needs_review') THEN RETURN 'not_assignable:' || t.status; END IF;
    IF t.payment_id IS NOT NULL THEN RETURN 'already_linked'; END IF;
    res := public._billing_settle(t.id, p_order_code, actor, 'manual');
    UPDATE public.bank_transactions
       SET reviewed_by = p_admin, reviewed_at = now(), note = p_note,
           needs_attention = CASE WHEN status IN ('partial', 'needs_review') OR reason LIKE 'overpaid:%' THEN needs_attention ELSE false END
     WHERE id = t.id;
    PERFORM public._billing_log(actor, 'admin_assign', NULL, p_order_code, NULL, t.id, jsonb_build_object('result', res, 'note', p_note));
    RETURN res;
  ELSIF p_action = 'ignore' THEN
    IF t.payment_id IS NOT NULL AND t.status = 'matched' THEN RETURN 'already_matched'; END IF;
    UPDATE public.bank_transactions SET status = 'ignored', needs_attention = false, reviewed_by = p_admin, reviewed_at = now(), note = p_note WHERE id = t.id;
  ELSIF p_action IN ('refund', 'refunded') AND t.status = 'matched' AND t.reason LIKE 'overpaid:%' AND t.reason NOT LIKE '%:refunded' THEN
    -- đơn vẫn giữ (đã kích hoạt); chỉ phần dư được hoàn tay => giao dịch vẫn 'matched', ghi nhận đã hoàn
    UPDATE public.bank_transactions
       SET needs_attention = false, reason = t.reason || ':refunded', reviewed_by = p_admin, reviewed_at = now(), note = p_note
     WHERE id = t.id;
    UPDATE public.payments SET note = concat_ws(E'\n', note, 'Đã hoàn phần dư ' || split_part(t.reason, ':', 2) || 'đ') WHERE id = t.payment_id;
    p_action := 'refund_overpaid';
  ELSIF p_action IN ('refund', 'refunded') THEN
    IF t.status = 'matched' THEN RETURN 'already_matched'; END IF;
    UPDATE public.bank_transactions SET status = 'refunded', needs_attention = false, reviewed_by = p_admin, reviewed_at = now(), note = p_note WHERE id = t.id;
    p_action := 'refunded';
    IF t.payment_id IS NOT NULL THEN
      -- khoản thiếu đã hoàn lại cho khách: tính lại số đã nhận của đơn chưa đủ tiền
      SELECT COALESCE(SUM(amount_vnd), 0) INTO s FROM public.bank_transactions WHERE payment_id = t.payment_id AND status IN ('partial', 'matched');
      UPDATE public.payments SET paid_amount_vnd = NULLIF(s, 0) WHERE id = t.payment_id AND status = 'partial';
    END IF;
  ELSIF p_action = 'ack' THEN
    UPDATE public.bank_transactions SET needs_attention = false, reviewed_by = p_admin, reviewed_at = now(), note = COALESCE(p_note, note) WHERE id = t.id;
  ELSE
    RETURN 'bad_action';
  END IF;
  PERFORM public._billing_log(actor, 'admin_' || p_action, NULL, t.order_code, t.payment_id, t.id, jsonb_build_object('note', p_note));
  RETURN 'ok';
END $$;

-- Gợi ý đơn cho 1 giao dịch chưa khớp: số tiền bằng + mã đơn gần giống (pg_trgm) + còn mới. Chỉ để admin xem, KHÔNG tự gán.
CREATE OR REPLACE FUNCTION public.suggest_orders_for_transaction(p_tx uuid)
RETURNS TABLE (order_code bigint, workspace_id uuid, workspace_name text, plan text, period_months integer,
               amount_vnd integer, status text, created_at timestamptz, score numeric, why text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH t AS (
    SELECT amount_vnd AS amt, COALESCE(order_code::text, regexp_replace(COALESCE(content, ''), '\D', '', 'g')) AS digits
      FROM public.bank_transactions WHERE id = p_tx
  )
  SELECT p.order_code, p.workspace_id, w.name, p.plan, p.period_months, p.amount_vnd, p.status, p.created_at,
         round((CASE WHEN p.amount_vnd = t.amt THEN 0.6 ELSE 0 END
              + 0.3 * similarity(p.order_code::text, t.digits)
              + 0.1 * GREATEST(0, 1 - extract(epoch FROM (now() - p.created_at)) / (14 * 86400)))::numeric, 3) AS score,
         concat_ws(', ', CASE WHEN p.amount_vnd = t.amt THEN 'cùng số tiền' END,
                         CASE WHEN similarity(p.order_code::text, t.digits) > 0.4 THEN 'mã đơn gần giống' END,
                         CASE WHEN p.status = 'partial' THEN 'đơn đang thiếu tiền' END)
    FROM public.payments p
    JOIN public.workspaces w ON w.id = p.workspace_id
    CROSS JOIN t
   WHERE p.status IN ('pending', 'partial', 'expired', 'cancelled')
     AND p.created_at > now() - interval '30 days'
     AND (p.amount_vnd = t.amt OR similarity(p.order_code::text, t.digits) > 0.4)
   ORDER BY score DESC, p.created_at DESC
   LIMIT 5;
$$;

-- 8) apply_payment (đường kích hoạt tay của admin từ 024): giữ nguyên chữ ký, nhưng đi qua sổ giao dịch + nhật ký ----
CREATE OR REPLACE FUNCTION public.apply_payment(
  p_order_code bigint, p_provider text, p_txn_id text, p_paid_amount integer, p_raw jsonb DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  pay public.payments%ROWTYPE;
  v_id uuid;
  res text;
BEGIN
  SELECT * INTO pay FROM public.payments WHERE order_code = p_order_code;
  IF NOT FOUND THEN RETURN 'order_not_found'; END IF;
  IF pay.status = 'paid' THEN RETURN 'already_paid'; END IF;
  IF pay.status IN ('refunded') THEN RETURN 'order_closed'; END IF;
  IF p_paid_amount IS NULL OR p_paid_amount <= 0 THEN RETURN 'invalid_amount'; END IF;

  INSERT INTO public.bank_transactions (provider, provider_txn_id, amount_vnd, content, source, order_code, match_confidence, raw)
  VALUES (CASE WHEN p_provider IN ('sepay', 'casso', 'payos') THEN p_provider ELSE 'manual' END,
          COALESCE(p_txn_id, 'manual-' || p_order_code) || '-' || substr(gen_random_uuid()::text, 1, 8),
          p_paid_amount, 'LGOS' || p_order_code, 'admin', p_order_code, 'manual', p_raw)
  RETURNING id INTO v_id;
  res := public._billing_settle(v_id, p_order_code, 'admin:' || COALESCE(p_raw->>'admin_id', 'legacy'), 'manual');
  RETURN CASE WHEN res = 'partial' THEN 'amount_mismatch' ELSE res END;   -- tên cũ để route 024 không phải đổi
END $$;

-- 9) Cron hằng ngày ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_stale_orders() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  WITH x AS (UPDATE public.payments SET status = 'expired' WHERE status = 'pending' AND expires_at < now() RETURNING id)
  SELECT count(*) INTO n FROM x;
  IF n > 0 THEN PERFORM public._billing_log('cron', 'orders_expired', NULL, NULL, NULL, NULL, jsonb_build_object('count', n)); END IF;
  RETURN n;
END $$;

-- Việc nhắc gia hạn đến hạn gửi (mỗi kỳ dịch vụ chỉ trả MỘT loại nhắc tiến xa nhất chưa gửi)
CREATE OR REPLACE FUNCTION public.billing_reminders_due(p_now timestamptz DEFAULT now(), p_grace_days integer DEFAULT 3)
RETURNS TABLE (subscription_id uuid, workspace_id uuid, workspace_name text, plan text, period_end timestamptz, kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH cand AS (
    SELECT s.id, s.workspace_id, s.plan, s.current_period_end AS pend,
           CASE
             WHEN s.status = 'active' AND s.current_period_end <= p_now THEN 'expired'
             WHEN s.status = 'active' AND s.current_period_end <= p_now + interval '1 day'  THEN 'd1'
             WHEN s.status = 'active' AND s.current_period_end <= p_now + interval '3 days' THEN 'd3'
             WHEN s.status = 'active' AND s.current_period_end <= p_now + interval '7 days' THEN 'd7'
             WHEN s.status = 'expired' AND s.current_period_end < p_now - make_interval(days => p_grace_days)
                  AND s.current_period_end > p_now - interval '14 days' THEN 'downgraded'
           END AS kind
      FROM public.subscriptions s
     WHERE s.status IN ('active', 'expired')
       -- đã trả kỳ tiếp theo (xếp lịch) thì khỏi nhắc
       AND NOT EXISTS (SELECT 1 FROM public.subscriptions n WHERE n.workspace_id = s.workspace_id AND n.status = 'scheduled')
       -- kỳ cũ đã 'expired' mà workspace đang có kỳ active khác => khỏi báo hạ gói
       AND NOT (s.status = 'expired' AND EXISTS (SELECT 1 FROM public.subscriptions a WHERE a.workspace_id = s.workspace_id AND a.status = 'active'))
  )
  SELECT c.id, c.workspace_id, w.name, c.plan, c.pend, c.kind
    FROM cand c
    JOIN public.workspaces w ON w.id = c.workspace_id
   WHERE c.kind IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.billing_reminders r WHERE r.subscription_id = c.id AND r.kind = c.kind AND r.period_end = c.pend);
$$;

CREATE OR REPLACE FUNCTION public.billing_reminder_mark(p_sub uuid, p_kind text, p_period_end timestamptz) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO public.billing_reminders (subscription_id, kind, period_end) VALUES (p_sub, p_kind, p_period_end)
  ON CONFLICT DO NOTHING;
$$;

-- Người nhận email của 1 workspace (owner/admin). Chỉ service_role.
CREATE OR REPLACE FUNCTION public.billing_recipients(p_ws uuid) RETURNS TABLE (user_id uuid, email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.email::text FROM auth.users u
    JOIN public.workspace_members m ON m.user_id = u.id
   WHERE m.workspace_id = p_ws AND m.role IN ('owner', 'admin') AND u.email IS NOT NULL;
$$;

-- 10) Quyền ----------------------------------------------------------------------------------------------
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    '_billing_log(text,text,uuid,bigint,uuid,uuid,jsonb)',
    '_billing_grant_period(uuid,text,integer)',
    '_billing_settle(uuid,bigint,text,text)',
    'ingest_bank_transaction(text,text,bigint,text,bigint[],text,text,text,text,text,timestamptz,text,jsonb)',
    'admin_resolve_transaction(uuid,text,bigint,uuid,text)',
    'suggest_orders_for_transaction(uuid)',
    'apply_payment(bigint,text,text,integer,jsonb)',
    'expire_stale_orders()',
    'billing_reminders_due(timestamptz,integer)',
    'billing_reminder_mark(uuid,text,timestamptz)',
    'billing_recipients(uuid)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;
