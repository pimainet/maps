-- Keep self-service signup working with the multi-member workspace model.
-- This migration changes RLS policies and trigger behavior only; it does not
-- alter table structure or rewrite existing business data.

-- A signed-in business owner may create a free workspace. The restrictive
-- policy prevents any broader permissive INSERT policy from allowing a user
-- to assign a paid plan directly through the Data API.
DROP POLICY IF EXISTS "Authenticated users can create free workspaces" ON public.workspaces;
CREATE POLICY "Authenticated users can create free workspaces"
  ON public.workspaces
  FOR INSERT
  TO authenticated
  WITH CHECK (plan = 'free');

DROP POLICY IF EXISTS "Workspace plan is free on user insert" ON public.workspaces;
CREATE POLICY "Workspace plan is free on user insert"
  ON public.workspaces
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (plan = 'free');

-- A workspace created through the authenticated app route belongs to the
-- current user. During auth.users signup, auth.uid() may be NULL because the
-- trigger runs in the Auth service context; handle_new_user inserts that new
-- user's membership explicitly below.
CREATE OR REPLACE FUNCTION public.handle_new_workspace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (NEW.id, auth.uid(), 'owner')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- New email/Google signups receive a default free workspace and an owner
-- membership so getUserWorkspaces() works immediately after authentication.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_workspace_id uuid;
  user_name text;
BEGIN
  user_name := COALESCE(
    NULLIF(BTRIM(NEW.raw_user_meta_data->>'full_name'), ''),
    NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
    'Business owner'
  );

  INSERT INTO public.workspaces (name, plan)
  VALUES (user_name || '''s Workspace', 'free')
  RETURNING id INTO new_workspace_id;

  INSERT INTO public.profiles (id, workspace_id, full_name, role)
  VALUES (NEW.id, new_workspace_id, user_name, 'owner')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (new_workspace_id, NEW.id, 'owner')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;
