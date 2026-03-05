import type { MapConfig } from '@/types';

// Single linear stage: Forêt de Bretagne
// [x, z_world, y_elevation] — dramatic uphill/downhill sections
export const MAP_CONFIGS: MapConfig[] = [
  {
    id: 0,
    name: 'Forêt de Bretagne',
    description: 'Spéciale terre — piste large à travers la forêt dense, départ → arrivée',
    difficulty: 'Medium',
    groundColor: 0x2e4a12,
    roadColor: 0x7a5230,
    barrierColor: 0x5c3d1e,
    treeColor: 0x1a4f08,
    trackWidth: 18,
    laps: 1,
    checkpoints: [0.25, 0.5, 0.75],
    waypoints: [
      [0,    0,    0],    // START — clairière
      [18,   30,   2],    // montée douce en forêt
      [35,   65,   6],    // virage droit, montée
      [20,  100,  10],    // crête, virage gauche
      [-5,  125,   8],    // plateau forestier
      [-28, 160,   4],    // descente + virage gauche long
      [-10, 200,   7],    // remontée en épingle
      [25,  225,  12],    // CRETE — point culminant
      [42,  265,   7],    // descente rapide droite
      [18,  298,   2],    // fond de vallée, épingle gauche
      [-8,  325,   4],    // remontée virage droit
      [10,  355,   2],    // dernière descente
      [5,   385,   0],    // ARRIVÉE — fin de spéciale
    ],
  },
];
