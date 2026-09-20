-- Lead từ landing page (demo audit công khai)
CREATE TABLE IF NOT EXISTS public.demo_leads (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text,
  phone          text NOT NULL,
  business_name  text,
  industry       text,
  area           text,
  gbp_link       text,
  status         text,
  overall_score  numeric,
  source         text,
  raw            jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_demo_leads_created_at ON public.demo_leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_demo_leads_phone ON public.demo_leads(phone);

ALTER TABLE public.demo_leads ENABLE ROW LEVEL SECURITY;

-- Chỉ service role (API public dùng supabaseAdmin) được ghi.
-- Owner/admin workspace đọc được nếu cần xem từ dashboard sau này.
CREATE POLICY "Authenticated can read demo leads"
  ON public.demo_leads FOR SELECT
  TO authenticated
  USING (true);
