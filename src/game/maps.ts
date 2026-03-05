import type { MapConfig } from '@/types';

// Forêt des Corbières — Crépuscule
// ~60 secondes de course, 28 waypoints
// [x, z_world, y_elevation]
export const MAP_CONFIGS: MapConfig[] = [
  {
    id: 0,
    name: 'Forêt des Corbières',
    description: 'Spéciale crépuscule — forêt dense, col, pont, saut, tunnel',
    difficulty: 'Medium',
    groundColor: 0x2e4a12,
    roadColor: 0x7a5230,
    barrierColor: 0x5c3d1e,
    treeColor: 0x1a4f08,
    trackWidth: 18,
    laps: 1,
    checkpoints: [0.18, 0.38, 0.58, 0.78],
    waypoints: [
      // ── Forêt ouverture (rapide) ──
      [0,   0,    0],   // 0  START — clairière
      [22,  48,   3],   // 1  entrée forêt
      [40,  95,   7],   // 2  montée
      // ── Technique : épingle + chicane ──
      [20,  135,  10],  // 3  virage gauche technique
      [-15, 162,  11],  // 4  épingle gauche
      [-32, 195,   8],  // 5  sortie descente
      // ── Descente rapide en vallée ──
      [-15, 238,   4],  // 6  fond de vallée
      [18,  278,   3],  // 7  sweeper droit
      // ── Chicanes (secteur technique) ──
      [42,  312,   5],  // 8  chicane droite
      [10,  342,   7],  // 9  chicane gauche
      [-18, 372,   5],  // 10 chicane droite sortie
      // ── Montée col (paysage ouvert) ──
      [-5,  415,  13],  // 11 montée col
      [28,  458,  16],  // 12 CRÊTE — vue dégagée
      [52,  498,  14],  // 13 descente douce
      // ── PONT (section élevée sur rivière) ──
      [38,  542,  21],  // 14 pont début (très haut)
      [22,  582,  22],  // 15 pont milieu
      [5,   618,  19],  // 16 pont fin
      // ── SAUT ──
      [0,   650,  22],  // 17 RAMPE — crête maximale
      [10,  680,   3],  // 18 ATTERRISSAGE — chute brutale
      // ── Vallée technique ──
      [25,  712,   3],  // 19 récupération
      [-5,  748,   4],  // 20 gauche
      [-20, 782,   5],  // 21 droite
      // ── TUNNEL ──
      [-8,  818,   3],  // 22 entrée tunnel
      [12,  855,   4],  // 23 milieu tunnel
      [28,  888,   3],  // 24 sortie tunnel
      // ── Sprint final ──
      [18,  928,   2],  // 25 dernière ligne droite
      [5,   968,   1],  // 26
      [0,   1000,  0],  // 27 ARRIVÉE
    ],
  },
];
