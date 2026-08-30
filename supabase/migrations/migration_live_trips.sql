-- migration_live_trips.sql

-- Add columns to trips table for live tracking
ALTER TABLE public.trips 
ADD COLUMN IF NOT EXISTS distance_km FLOAT DEFAULT 0,
ADD COLUMN IF NOT EXISTS current_fare FLOAT DEFAULT 0,
ADD COLUMN IF NOT EXISTS route_path JSONB;

-- Create saved_routes table
CREATE TABLE IF NOT EXISTS public.saved_routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    passenger_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    origin_lat FLOAT NOT NULL,
    origin_lng FLOAT NOT NULL,
    dest_lat FLOAT NOT NULL,
    dest_lng FLOAT NOT NULL,
    distance_km FLOAT NOT NULL,
    base_fare FLOAT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- RLS for saved_routes
ALTER TABLE public.saved_routes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own saved routes" 
ON public.saved_routes FOR INSERT 
WITH CHECK (auth.uid() = passenger_id);

CREATE POLICY "Users can select their own saved routes" 
ON public.saved_routes FOR SELECT 
USING (auth.uid() = passenger_id);

CREATE POLICY "Users can delete their own saved routes" 
ON public.saved_routes FOR DELETE 
USING (auth.uid() = passenger_id);
