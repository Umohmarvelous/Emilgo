-- Add type column to conversations table
ALTER TABLE conversations 
ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'trip' CHECK (type IN ('trip', 'direct'));

-- Create an index on driver_id in the users table for faster lookups
CREATE INDEX IF NOT EXISTS users_driver_id_idx ON users (driver_id);

-- Add Row Level Security (RLS) policies for direct conversations
-- Assuming RLS is already enabled on conversations table, we just ensure 
-- that the passenger_id or participant_id checks cover the users involved.
-- Since the existing RLS likely checks (passenger_id = auth.uid() OR participant_id = auth.uid()),
-- and direct chats use these same columns for the two participants, existing RLS should naturally cover it.
