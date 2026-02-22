-- Rally Game Leaderboard Schema
-- Run this migration in your Supabase SQL editor

CREATE TABLE IF NOT EXISTS leaderboard (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  map_id INTEGER NOT NULL CHECK (map_id >= 0 AND map_id <= 4),
  player_name TEXT NOT NULL CHECK (length(trim(player_name)) >= 1 AND length(player_name) <= 32),
  time_ms BIGINT NOT NULL CHECK (time_ms > 0),
  car_id INTEGER NOT NULL CHECK (car_id >= 0 AND car_id <= 4),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Index for fast leaderboard queries
CREATE INDEX IF NOT EXISTS idx_leaderboard_map_time ON leaderboard (map_id, time_ms ASC);
CREATE INDEX IF NOT EXISTS idx_leaderboard_player ON leaderboard (player_name);

-- Row Level Security
ALTER TABLE leaderboard ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read leaderboard
CREATE POLICY "leaderboard_select" ON leaderboard
  FOR SELECT USING (true);

-- Allow anyone to insert scores
CREATE POLICY "leaderboard_insert" ON leaderboard
  FOR INSERT WITH CHECK (true);

-- Nobody can update or delete
-- (No UPDATE/DELETE policies = blocked by default with RLS enabled)

-- Optional: view that shows rank per map
CREATE OR REPLACE VIEW leaderboard_ranked AS
SELECT
  id,
  map_id,
  player_name,
  time_ms,
  car_id,
  created_at,
  RANK() OVER (PARTITION BY map_id ORDER BY time_ms ASC) AS rank
FROM leaderboard;
