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
}

export interface LeaderboardEntry {
  id: string;
  map_id: number;
  player_name: string;
  time_ms: number;
  car_id: number;
  created_at: string;
}

export interface GameState {
  phase: 'nickname' | 'carSelect' | 'mapSelect' | 'racing' | 'finished';
  nickname: string;
  selectedCar: number;
  selectedMap: number;
  elapsedTime: number;
  bestTime: number | null;
}
