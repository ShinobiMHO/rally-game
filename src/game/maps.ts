import type { MapConfig } from '@/types';

// Forêt des Corbières — Spéciale Complète
// ~90 secondes, 50 waypoints
// Épingles · pont · saut · grotte/cascade · paroi de falaise
// [x, z_world, y_elevation]
export const MAP_CONFIGS: MapConfig[] = [
  {
    id: 0,
    name: 'Forêt des Corbières',
    description: 'Épingles · grotte · cascade · falaise',
    difficulty: 'Hard',
    groundColor: 0x2e4a12,
    roadColor: 0x7a5230,
    barrierColor: 0x5c3d1e,
    treeColor: 0x1a4f08,
    trackWidth: 18,
    laps: 1,
    checkpoints: [],
    waypoints: [
      // ── DÉPART ──
      [0,    0,   0],   // 0  START
      [8,   38,   1],   // 1

      // ── Épingle serrée droite #1 ──
      [32,  72,   2],   // 2
      [50,  92,   3],   // 3  apex
      [38, 115,   3],   // 4
      [12, 138,   4],   // 5

      // ── Chicane + petite bosse ──
      [-14, 165,  5],   // 6  gauche
      [10,  192,  5],   // 7  droite
      [24,  215,  8],   // 8  bosse
      [20,  235,  3],   // 9  atterrissage

      // ── Épingle serrée gauche #2 ──
      [5,   262,  3],   // 10
      [-18, 285,  4],   // 11 apex gauche
      [-30, 308,  5],   // 12
      [-14, 335,  5],   // 13 sortie
      [10,  358,  6],   // 14

      // ── Montée + bosse #2 ──
      [22,  382,  9],   // 15 bosse haute
      [16,  406,  4],   // 16 atterrissage

      // ── PONT élevé ──
      [4,   435, 14],   // 17 début pont
      [-8,  462, 16],   // 18 milieu pont
      [-14, 490, 12],   // 19 fin pont

      // ── Épingle serrée droite #3 ──
      [4,   512,  6],   // 20
      [28,  532,  5],   // 21 apex
      [40,  552,  5],   // 22
      [20,  578,  4],   // 23 sortie

      // ── SAUT modéré ──
      [5,   600,  4],   // 24
      [0,   618, 10],   // 25 rampe
      [0,   638,  3],   // 26 atterrissage

      // ── TUNNEL ──
      [10,  662,  3],   // 27 entrée tunnel
      [22,  690,  4],   // 28 milieu tunnel
      [18,  715,  3],   // 29 sortie tunnel

      // ── Descente vers gorge ──
      [5,   745,  2],   // 30
      [-10, 775,  0],   // 31 bord du gouffre

      // ── GROTTE — derrière la cascade ──
      [-22, 808, -2],   // 32 entrée grotte (sous la surface)
      [-18, 842, -3],   // 33 point le plus bas, obscurité
      [0,   875, -3],   // 34 milieu grotte
      [18,  908, -2],   // 35 remontée
      [25,  938,  1],   // 36 sortie grotte, lumière

      // ── Montée vers la falaise ──
      [15,  968,  7],   // 37
      [0,  1000, 15],   // 38 montée raide
      [-15, 1030, 22],  // 39 arrivée sur la corniche

      // ── PAROI DE FALAISE — route sur le flanc ──
      [-35, 1062, 24],  // 40 corniche gauche (surplomb)
      [-48, 1095, 26],  // 41 point le plus haut, à flanc de paroi
      [-40, 1128, 24],  // 42 virage serré sur la falaise
      [-18, 1155, 20],  // 43 retour vers le centre

      // ── Descente finale ──
      [0,  1182, 12],   // 44
      [10, 1210,  5],   // 45 sprint
      [5,  1238,  1],   // 46
      [0,  1260,  0],   // 47 ARRIVÉE
    ],
  },
];
