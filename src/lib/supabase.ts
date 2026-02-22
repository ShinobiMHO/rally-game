import { createClient } from '@supabase/supabase-js';
import type { LeaderboardEntry } from '@/types';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

const isConfigured = supabaseUrl.startsWith('https://') && supabaseAnonKey.length > 10;

export const supabase = isConfigured ? createClient(supabaseUrl, supabaseAnonKey) : null;

export async function getLeaderboard(mapId: number, limit = 20): Promise<LeaderboardEntry[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('leaderboard')
    .select('*')
    .eq('map_id', mapId)
    .order('time_ms', { ascending: true })
    .limit(limit);
  
  if (error) {
    console.error('Error fetching leaderboard:', error);
    return [];
  }
  
  return data ?? [];
}

export async function submitScore(
  mapId: number,
  playerName: string,
  timeMs: number,
  carId: number
): Promise<LeaderboardEntry | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('leaderboard')
    .insert({
      map_id: mapId,
      player_name: playerName,
      time_ms: timeMs,
      car_id: carId,
    })
    .select()
    .single();
  
  if (error) {
    console.error('Error submitting score:', error);
    return null;
  }
  
  return data;
}

export function formatTime(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const milliseconds = Math.floor((ms % 1000) / 10);
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(2, '0')}`;
}
