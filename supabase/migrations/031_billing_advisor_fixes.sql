-- Migration 031: dọn cảnh báo advisor sau 030 (idempotent).
-- * unindexed_foreign_keys: bank_transactions.reviewed_by -> auth.users
-- * Hàm trigger billing_events_immutable không cần ai gọi trực tiếp: thu quyền EXECUTE.
-- Cố ý giữ nguyên: rls_enabled_no_policy trên bank_transactions / billing_events / billing_reminders
-- (chỉ service_role truy cập; không policy = chặn mọi anon/authenticated).
CREATE INDEX IF NOT EXISTS bank_tx_reviewed_by_idx ON public.bank_transactions (reviewed_by);
REVOKE EXECUTE ON FUNCTION public.billing_events_immutable() FROM PUBLIC, anon, authenticated;
