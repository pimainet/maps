-- ============================================================
-- Migration 007: Chu kỳ 30 ngày theo client
-- Một client trong workspace chỉ có tối đa 1 cycle status = 'active'
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  opening_audit_id uuid,
  plan_id uuid,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cycles_client ON public.cycles (workspace_id, client_id, created_at DESC);

-- Chỉ 1 cycle active / client / workspace
CREATE UNIQUE INDEX IF NOT EXISTS uq_cycles_one_active
  ON public.cycles (workspace_id, client_id)
  WHERE status = 'active';

ALTER TABLE public.cycles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can select cycles" ON public.cycles;
CREATE POLICY "Workspace members can select cycles"
  ON public.cycles FOR SELECT
  USING (public.is_superadmin() OR public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Workspace members can insert cycles" ON public.cycles;
CREATE POLICY "Workspace members can insert cycles"
  ON public.cycles FOR INSERT
  WITH CHECK (public.is_superadmin() OR public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Workspace members can update cycles" ON public.cycles;
CREATE POLICY "Workspace members can update cycles"
  ON public.cycles FOR UPDATE
  USING (public.is_superadmin() OR public.is_workspace_member(workspace_id));
