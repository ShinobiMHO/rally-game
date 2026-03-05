import type { MapConfig } from '@/types';

// [x, z_world, y_elevation]
// Zones spéciales (par indice de waypoint, base 0) :
//   Bridge  : wp 13 → 16  (y élevé, piliers en-dessous)
//   Jump    : wp 16 → 17  (crête → chute brutale)
//   Tunnel  : wp 17 → 20  (section couverte)
export const MAP_CONFIGS: MapConfig[] = [
  {
    id: 0,
    name: 'Forêt de Bretagne',
    description: 'Spéciale terre — forêt, pont, saut, tunnel — départ → arrivée',
    difficulty: 'Medium',
    groundColor: 0x2e4a12,
    roadColor: 0x7a5230,
    barrierColor: 0x5c3d1e,
    treeColor: 0x1a4f08,
    trackWidth: 18,
    laps: 1,
    checkpoints: [0.18, 0.36, 0.55, 0.74],
    waypoints: [
      // ── Forêt ──
      [0,    0,    0],    // 0  START — clairière
      [18,   30,   2],    // 1
      [35,   65,   6],    // 2  montée
      [20,  100,  10],    // 3  crête
      [-5,  125,   8],    // 4
      [-28, 160,   4],    // 5  descente gauche
      [-10, 200,   7],    // 6  épingle remontée
      [25,  225,  12],    // 7  CRÊTE FORÊT
      [42,  265,   7],    // 8  descente rapide
      [18,  298,   2],    // 9  fond de vallée
      [-8,  325,   4],    // 10 remontée
      [5,   355,   3],    // 11 chicane gauche
      [-18, 385,   5],    // 12 chicane droite
      // ── Pont ──
      [10,  420,  10],    // 13 approche pont (montée)
      [14,  455,  18],    // 14 PONT HAUT gauche
      [8,   490,  18],    // 15 PONT HAUT droite
      [-2,  520,  17],    // 16 sortie pont (encore haut)
      // ── Saut ──
      [5,   540,  19],    // 17 RAMPE SAUT — crête maximale
      [0,   570,   3],    // 18 ATTERRISSAGE — chute brutale
      // ── Tunnel ──
      [-12, 595,   2],    // 19 entrée tunnel
      [-5,  625,   3],    // 20 milieu tunnel
      [8,   650,   2],    // 21 sortie tunnel
      // ── Sprint final ──
      [20,  672,   1],    // 22 dernière ligne droite
      [5,   700,   0],    // 23 ARRIVÉE
    ],
  },
];
