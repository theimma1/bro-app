-- ### 1. EXTENSIONS ###
-- Enable pgcrypto for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "public";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "public";

-- ### 2. TABLES ###

-- Users table (Men)
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE public.users IS 'Stores male user accounts.';

-- Female profiles
CREATE TABLE IF NOT EXISTS public.female_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name TEXT NOT NULL,
    bio TEXT,
    photos JSONB DEFAULT '[]'::jsonb, -- Stores URLs from Supabase Storage
    moderation_status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
    invite_token TEXT UNIQUE,
    invite_token_expires_at TIMESTAMPTZ,
    created_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE public.female_profiles IS 'Consented female profiles. Not visible until moderation_status = ''approved''.';

-- Experience writeups
CREATE TABLE IF NOT EXISTS public.experiences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES public.female_profiles(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    experience_text TEXT NOT NULL,
    tags JSONB DEFAULT '[]'::jsonb,
    moderation_status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
    created_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE public.experiences IS 'User-submitted writeups. Not visible until moderation_status = ''approved''.';

-- Behavior ratings
CREATE TABLE IF NOT EXISTS public.ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES public.female_profiles(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    honesty SMALLINT NOT NULL CHECK (honesty >= 0 AND honesty <= 5),
    communication SMALLINT NOT NULL CHECK (communication >= 0 AND communication <= 5),
    accountability SMALLINT NOT NULL CHECK (accountability >= 0 AND accountability <= 5),
    consistency SMALLINT NOT NULL CHECK (consistency >= 0 AND consistency <= 5),
    drama_level SMALLINT NOT NULL CHECK (drama_level >= 0 AND drama_level <= 5),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    -- A man can only rate a woman once. Use ON CONFLICT to update.
    UNIQUE (profile_id, user_id)
);
COMMENT ON TABLE public.ratings IS 'Aggregatable behavior ratings. One rating set per user per profile.';

-- Experience votes (for accuracy)
CREATE TABLE IF NOT EXISTS public.experience_votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experience_id UUID NOT NULL REFERENCES public.experiences(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    vote SMALLINT NOT NULL CHECK (vote IN (1, -1)), -- 1 for upvote, -1 for downvote
    created_at TIMESTAMPTZ DEFAULT NOW(),
    -- A user can only vote once per experience
    UNIQUE (experience_id, user_id)
);
COMMENT ON TABLE public.experience_votes IS 'Upvotes/downvotes on experiences for accuracy.';

-- Redeem Link video sessions
CREATE TABLE IF NOT EXISTS public.redeem_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES public.female_profiles(id) ON DELETE CASCADE,
    room_name TEXT NOT NULL UNIQUE,
    session_token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_by_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE public.redeem_sessions IS 'Manages active WebRTC "Redeem Link" rooms.';

-- Audit log for moderation and safety
CREATE TABLE IF NOT EXISTS public.audit_log (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    target_table TEXT,
    target_id UUID,
    details JSONB,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE public.audit_log IS 'Tracks significant actions for safety and moderation.';


-- ### 3. INDEXES ###
CREATE INDEX IF NOT EXISTS idx_profiles_status ON public.female_profiles (moderation_status);
CREATE INDEX IF NOT EXISTS idx_experiences_profile_id ON public.experiences (profile_id);
CREATE INDEX IF NOT EXISTS idx_experiences_user_id ON public.experiences (user_id);
CREATE INDEX IF NOT EXISTS idx_experiences_status ON public.experiences (moderation_status);
CREATE INDEX IF NOT EXISTS idx_ratings_profile_id ON public.ratings (profile_id);
CREATE INDEX IF NOT EXISTS idx_ratings_user_id ON public.ratings (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON public.redeem_sessions (session_token);
CREATE INDEX IF NOT EXISTS idx_sessions_room_name ON public.redeem_sessions (room_name);


-- ### 4. SUPABASE STORAGE ###
-- This must be done in the Supabase UI:
-- 1. Go to Storage -> Create a new bucket.
-- 2. Name the bucket: 'profile_photos'
-- 3. Set it as a Public bucket.
-- 4. Set up storage policies (see section 5).


-- ### 5. ROW LEVEL SECURITY (RLS) ###
-- Enable RLS for all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.female_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experiences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experience_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.redeem_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY; -- Admins only

-- Get user ID from JWT
CREATE OR REPLACE FUNCTION public.get_user_id_from_jwt()
RETURNS UUID AS $$
BEGIN
    RETURN (auth.jwt()->>'sub')::UUID;
END;
$$ LANGUAGE plpgsql STABLE;

-- === users ===
-- Users can see their own info
CREATE POLICY "Users can view their own data"
ON public.users FOR SELECT
USING (id = public.get_user_id_from_jwt());
-- Users can update their own info
CREATE POLICY "Users can update their own data"
ON public.users FOR UPDATE
USING (id = public.get_user_id_from_jwt());
-- Allow new user creation (handled by backend service role)
-- For simplicity in this build, we'll use the service_role key in the backend
-- which bypasses RLS. A more secure build would use a `signup` function.

-- === female_profiles ===
-- Authenticated users can see *only* approved profiles
CREATE POLICY "Authenticated users can view approved profiles"
ON public.female_profiles FOR SELECT
TO authenticated
USING (moderation_status = 'approved');

-- === experiences ===
-- Authenticated users can see *only* approved experiences for approved profiles
CREATE POLICY "Authenticated users can view approved experiences"
ON public.experiences FOR SELECT
TO authenticated
USING (
    moderation_status = 'approved' AND
    profile_id IN (SELECT id FROM public.female_profiles WHERE moderation_status = 'approved')
);
-- Users can insert new experiences (which start as 'pending')
CREATE POLICY "Users can insert their own experiences"
ON public.experiences FOR INSERT
TO authenticated
WITH CHECK (user_id = public.get_user_id_from_jwt());
-- Users can update/delete their *own* experiences (e.g., if they made a typo)
CREATE POLICY "Users can update/delete their own experiences"
ON public.experiences FOR UPDATE, DELETE
TO authenticated
USING (user_id = public.get_user_id_from_jwt());


-- === ratings ===
-- Authenticated users can see all ratings for approved profiles
CREATE POLICY "Authenticated users can view ratings for approved profiles"
ON public.ratings FOR SELECT
TO authenticated
USING (
    profile_id IN (SELECT id FROM public.female_profiles WHERE moderation_status = 'approved')
);
-- Users can insert/update their *own* rating
CREATE POLICY "Users can insert/update their own ratings"
ON public.ratings FOR INSERT, UPDATE
TO authenticated
WITH CHECK (user_id = public.get_user_id_from_jwt());


-- === experience_votes ===
-- Authenticated users can see all votes
CREATE POLICY "Authenticated users can view votes"
ON public.experience_votes FOR SELECT
TO authenticated
USING (true);
-- Users can insert/update their *own* vote
CREATE POLICY "Users can insert/update their own votes"
ON public.experience_votes FOR INSERT, UPDATE
TO authenticated
WITH CHECK (user_id = public.get_user_id_from_jwt());


-- === Storage Policy for 'profile_photos' (Set in Supabase UI) ===
-- Go to Storage -> Policies -> 'profile_photos' bucket
-- POLICY: "Allow anonymous uploads"
-- OPERATION: INSERT
-- TARGET ROLE: anon
-- USING: (true) -- This is a security risk, but required for the "approve link" flow
-- A better way: Backend generates a signed upload URL.
-- For this build, we'll use the anon key on the frontend to upload.

-- POLICY: "Allow authenticated read"
-- OPERATION: SELECT
-- TARGET ROLE: authenticated
-- USING: (true) -- All authenticated users can see photos