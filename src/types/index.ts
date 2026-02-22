export interface CarConfig {
  id: number;
  name: string;
  color: number;
  bodyColor: number;
  windowColor: number;
  wheelColor: number;
  description: string;
  speed: number;
  handling: number;
}

export interface MapConfig {
  id: number;
  name: string;
  description: string;
  difficulty: 'Easy' | 'Medium' | 'Hard' | 'Expert' | 'Master';
  groundColor: number;
  roadColor: number;
  barrierColor: number;
  treeColor: number;
  waypoints: [number, number][];
  trackWidth: number;
  laps: number;
  checkpoints: number[]; // t values [0-1] along spline
}

export interface LeaderboardEntry {
  id: string;
  map_id: number;
  player_name: string;
  time_ms: number;
  car_id: number;
  created_at: string;
}

export interface CheckpointSplit {
  index: number;
  elapsedMs: number;
  deltaMs: number | null; // null on first run
  isBest: boolean;
}

export interface GameState {
  phase: 'nickname' | 'carSelect' | 'mapSelect' | 'racing' | 'finished';
  nickname: string;
  selectedCar: number;
  selectedMap: number;
  elapsedTime: number;
  bestTime: number | null;
}

export type RaceState = 'countdown' | 'racing' | 'finished';
