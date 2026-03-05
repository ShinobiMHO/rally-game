import type { MapConfig } from '@/types';

// Single linear stage: Forêt de Bretagne
// Point A → Point B, dirt road through the forest.
export const MAP_CONFIGS: MapConfig[] = [
  {
    id: 0,
    name: 'Forêt de Bretagne',
    description: 'Spéciale terre — piste large à travers la forêt dense, du départ jusqu\'à l\'arrivée',
    difficulty: 'Medium',
    groundColor: 0x2e4a12,   // dark forest moss
    roadColor: 0x7a5230,     // dirt brown
    barrierColor: 0x5c3d1e,  // dark wood logs
    treeColor: 0x1a4f08,     // deep pine green
    trackWidth: 18,
    laps: 1,
    checkpoints: [0.25, 0.5, 0.75],
    // Linear dirt road, A→B, going generally northward with sweeping rally corners
    waypoints: [
      [0,    0],    // START
      [18,  30],    // sweeping right
      [35,  65],    // into the forest
      [20, 100],    // medium left
      [-5,  125],   // tightish left
      [-28, 160],   // long straight-ish section
      [-10, 200],   // big sweeping right
      [25,  225],   // right curve
      [42,  265],   // forest straight
      [18,  298],   // left hairpin
      [-8,  325],   // exit left
      [10,  355],   // sweeping right again
      [5,   385],   // FINISH straight
    ],
  },
];
