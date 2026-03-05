import type { MapConfig } from '@/types';

// Forêt des Corbières — Spéciale Jour
// ~65 secondes, 36 waypoints
// Virages serrés, épingles, bosses multiples, saut modéré, tunnel
// [x, z_world, y_elevation]
export const MAP_CONFIGS: MapConfig[] = [
  {
    id: 0,
    name: 'Forêt des Corbières',
    description: 'Spéciale jour — forêt dense, épingles, bosses, saut, tunnel',
    difficulty: 'Medium',
    groundColor: 0x2e4a12,
    roadColor: 0x7a5230,
    barrierColor: 0x5c3d1e,
    treeColor: 0x1a4f08,
    trackWidth: 18,
    laps: 1,
    checkpoints: [],
    waypoints: [
      // ── Départ — ligne droite courte ──
      [0,    0,   0],   // 0  START
      [8,   38,   1],   // 1
      // ── Épingle serrée droite #1 ──
      [32,  72,   2],   // 2  arrivée en virage
      [48,  88,   3],   // 3  apex serré droite
      [42, 108,   3],   // 4  sortie
      [18, 128,   4],   // 5  reprise
      // ── Chicane gauche-droite ──
      [-12, 158,  5],   // 6  gauche
      [8,  188,   5],   // 7  droite
      // ── Petite bosse #1 ──
      [20, 210,   6],   // 8
      [28, 225,   9],   // 9  bosse (y=9)
      [25, 242,   5],   // 10 atterrissage
      // ── Épingle serrée gauche #2 ──
      [10, 268,   4],   // 11 arrivée
      [-14, 288,  4],   // 12 apex gauche serré
      [-28, 305,  5],   // 13
      [-18, 328,  5],   // 14 sortie
      [8,  352,   6],   // 15 reprise accél
      // ── Montée + bosse #2 ──
      [22, 378,   8],   // 16
      [30, 398,  12],   // 17 bosse haute (y=12)
      [24, 418,   6],   // 18 atterrissage
      // ── PONT élevé ──
      [12, 448,  14],   // 19 début pont
      [0,  475,  16],   // 20 milieu pont
      [-10, 500, 12],   // 21 fin pont
      // ── Épingle serrée droite #3 (après pont) ──
      [4,  522,   6],   // 22
      [28, 540,   5],   // 23 apex serré droite
      [38, 558,   5],   // 24
      [22, 580,   4],   // 25 sortie
      // ── SAUT modéré ──
      [8,  605,   4],   // 26
      [0,  622,  10],   // 27 rampe (y=10 — modéré)
      [0,  640,   3],   // 28 atterrissage
      // ── TUNNEL + chicane finale ──
      [10, 665,   3],   // 29 entrée tunnel
      [22, 692,   4],   // 30 milieu tunnel
      [18, 718,   3],   // 31 sortie tunnel
      // ── S final serré ──
      [-8, 748,   3],   // 32 gauche
      [14, 778,   2],   // 33 droite
      [5,  808,   1],   // 34
      [0,  840,   0],   // 35 ARRIVÉE
    ],
  },
];
