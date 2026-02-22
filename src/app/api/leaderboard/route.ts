import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function GET(request: NextRequest) {
  const mapId = request.nextUrl.searchParams.get('map_id');
  if (mapId === null) {
    return NextResponse.json({ error: 'map_id required' }, { status: 400 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ data: [] });
  }

  const { data, error } = await supabase
    .from('leaderboard')
    .select('*')
    .eq('map_id', parseInt(mapId))
    .order('time_ms', { ascending: true })
    .limit(20);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { map_id, player_name, time_ms, car_id } = body;

  if (map_id === undefined || map_id === null) {
    return NextResponse.json({ error: 'map_id required' }, { status: 400 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  const { data, error } = await supabase
    .from('leaderboard')
    .insert({ map_id, player_name: player_name?.trim(), time_ms, car_id })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}
