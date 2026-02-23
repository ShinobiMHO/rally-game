import type { MapConfig } from '@/types';

// All stages are LINEAR (point A → point B). No laps. No repeated sections.
// Waypoints go generally northward (+Z) with turns that don't loop back.
export const MAP_CONFIGS: MapConfig[] = [
  {
    id: 0,
    name: 'Green Valley',
    description: 'Flowing S-curves through open countryside — learn the basics',
    difficulty: 'Easy',
    groundColor: 0x4a7c3f,
    roadColor: 0x555566,
    barrierColor: 0xffffff,
    treeColor: 0x2d6e2d,
    trackWidth: 13,
    laps: 1,
    checkpoints: [0.25, 0.5, 0.75],
    // Gentle S-curves going north, no self-intersections
    waypoints: [
      [0, 0], [20, 12], [15, 35], [-5, 50], [-8, 72],
      [10, 85], [20, 108], [8, 125], [-5, 145], [10, 162], [18, 180],
    ],
  },
  {
    id: 1,
    name: 'Desert Dash',
    description: 'Blistering straights & a sharp hairpin — throttle control is key',
    difficulty: 'Medium',
    groundColor: 0xc4a862,
    roadColor: 0x7a6540,
    barrierColor: 0xff6600,
    treeColor: 0x8a9e3e,
    trackWidth: 12,
    laps: 1,
    checkpoints: [0.22, 0.48, 0.72],
    // Long straight → big hairpin → continue north
    waypoints: [
      [0, 0], [50, 5], [72, 18], [68, 40],
      [45, 52], [20, 52], [5, 65], [8, 88],
      [28, 100], [58, 105], [80, 100], [95, 115],
    ],
  },
  {
    id: 2,
    name: 'Alpine Rush',
    description: 'Tight mountain switchbacks — staggered so they never cross',
    difficulty: 'Hard',
    groundColor: 0x7a8fa0,
    roadColor: 0x3a3a4a,
    barrierColor: 0xff2233,
    treeColor: 0x1a5c1a,
    trackWidth: 11,
    laps: 1,
    checkpoints: [0.2, 0.42, 0.62, 0.82],
    // Each reversal happens at a much higher Z — no crossing
    waypoints: [
      [0, 0], [38, 0], [55, 14], [50, 36], [28, 44],
      [4, 44], [-8, 60], [2, 80], [28, 86], [52, 80],
      [62, 96], [55, 118], [30, 126], [5, 124], [-6, 140],
      [6, 158], [30, 165],
    ],
  },
  {
    id: 3,
    name: 'Neon City',
    description: 'Urban chicanes at night — every corner counts',
    difficulty: 'Expert',
    groundColor: 0x0e0e1a,
    roadColor: 0x1a1a2e,
    barrierColor: 0x00ffcc,
    treeColor: 0xff00aa,
    trackWidth: 11,
    laps: 1,
    checkpoints: [0.2, 0.4, 0.6, 0.8],
    // Chicanes going north, each at a different Z to avoid overlap
    waypoints: [
      [0, 0], [30, -5], [50, 8], [52, 28], [35, 38],
      [12, 38], [0, 52], [5, 70], [28, 78], [52, 74],
      [65, 88], [62, 108], [42, 118], [18, 120], [5, 135],
      [15, 150], [38, 158],
    ],
  },
  {
    id: 4,
    name: 'Glacier Sprint',
    description: 'Ice road — near-zero grip, relentless corners',
    difficulty: 'Master',
    groundColor: 0x9ab8cc,
    roadColor: 0x2a3a48,
    barrierColor: 0x44aaff,
    treeColor: 0x77aacc,
    trackWidth: 10,
    laps: 1,
    checkpoints: [0.18, 0.36, 0.54, 0.72, 0.88],
    // Many tight corners, all going north without crossing
    waypoints: [
      [0, 0], [22, -2], [40, 10], [44, 28], [28, 38],
      [8, 40], [-4, 55], [4, 72], [24, 78], [42, 74],
      [52, 88], [50, 106], [34, 114], [12, 115], [0, 130],
      [8, 148], [26, 155], [44, 152], [56, 165],
    ],
  },
];
