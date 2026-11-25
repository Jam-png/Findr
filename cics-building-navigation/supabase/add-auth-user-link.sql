
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS auth_user_id uuid UNIQUE
REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS users_auth_user_id_idx
ON public.users(auth_user_id);
