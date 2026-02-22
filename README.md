# 🏁 Rally Racer 3D

A top-down low-poly 3D rally racing game built with **Next.js**, **Three.js**, and **Supabase**.

![Rally Racer 3D](./preview.png)

## Features

- 🚗 **5 unique cars** — each with different speed/handling stats
- 🗺️ **5 rally tracks** — from Easy to Master difficulty
- 🏆 **Per-map leaderboard** stored in Supabase (top 20 times)
- ⚡ **Low-poly 3D** aesthetic with shadows and fog
- 🎮 **French keyboard (ZQSD)** controls + Arrow keys
- 💨 **Drift physics** — feel the slide!
- 🔊 **Engine audio** — synthesized with Web Audio API

## Controls

| Key | Action |
|-----|--------|
| **Z** / ↑ | Accelerate |
| **S** / ↓ | Brake / Reverse |
| **Q** / ← | Steer Left |
| **D** / → | Steer Right |
| **R** | Restart current race |
| **Tab** | Toggle leaderboard |

## Game Flow

1. Enter your nickname
2. Select one of 5 cars (speed vs handling tradeoff)
3. Choose a track (5 maps, varying difficulty)
4. Race! Timer starts on first movement
5. Cross the finish line to record your time
6. View leaderboard — see where you rank!

## Tech Stack

- **Next.js 14** (App Router)
- **Three.js** for 3D rendering
- **TypeScript**
- **Supabase** for the leaderboard database
- **Web Audio API** for engine/sound effects

## Setup

### 1. Clone & Install

```bash
git clone https://github.com/ShinobiMHO/rally-game.git
cd rally-game
npm install
```

### 2. Supabase Setup

1. Create a [Supabase](https://supabase.com) project
2. Run the migration in `supabase/migrations/001_create_leaderboard.sql` in your SQL editor
3. Copy your project URL and anon key

```bash
cp .env.example .env.local
# Edit .env.local with your Supabase credentials
```

### 3. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FShinobiMHO%2Frally-game)

Set the following environment variables in Vercel:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Supabase Schema

The leaderboard table schema is in `supabase/migrations/001_create_leaderboard.sql`.

```sql
CREATE TABLE leaderboard (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  map_id INTEGER NOT NULL,
  player_name TEXT NOT NULL,
  time_ms BIGINT NOT NULL,
  car_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

Row Level Security is enabled:
- ✅ Anyone can **read** scores
- ✅ Anyone can **insert** scores
- ❌ Nobody can update/delete

## Maps

| # | Name | Difficulty | Laps |
|---|------|-----------|------|
| 0 | Green Valley | Easy | 2 |
| 1 | Desert Dash | Medium | 2 |
| 2 | Alpine Rush | Hard | 2 |
| 3 | Neon City | Expert | 3 |
| 4 | Glacier Circuit | Master | 3 |

## Cars

| # | Name | Speed | Handling |
|---|------|-------|----------|
| 0 | Scarlet Rocket | ★★★ | ★★★ |
| 1 | Blue Thunder | ★★★★★ | ★★ |
| 2 | Venom Verde | ★★ | ★★★★★ |
| 3 | Golden Flash | ★★★★ | ★★★★ |
| 4 | Phantom Violet | ★★★★ | ★★★ |

## Project Structure

```
rally-game/
├── src/
│   ├── app/
│   │   ├── api/leaderboard/     # Supabase API routes
│   │   ├── layout.tsx
│   │   └── page.tsx             # Main game state machine
│   ├── components/
│   │   ├── NicknameScreen.tsx
│   │   ├── CarSelector.tsx
│   │   ├── MapSelector.tsx
│   │   ├── GameCanvas.tsx       # Three.js canvas + HUD
│   │   ├── Leaderboard.tsx
│   │   └── FinishScreen.tsx
│   ├── game/
│   │   ├── GameEngine.ts        # Core Three.js game engine
│   │   ├── cars.ts              # Car configurations
│   │   └── maps.ts              # Map/track configurations
│   ├── lib/
│   │   └── supabase.ts
│   └── types/
│       └── index.ts
└── supabase/
    └── migrations/
        └── 001_create_leaderboard.sql
```
