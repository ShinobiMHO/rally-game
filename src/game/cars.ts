import type { CarConfig } from '@/types';

// Single rally car — WRC style
export const CAR_CONFIGS: CarConfig[] = [
  {
    id: 0,
    name: 'WRC Beast',
    color: 0xf0f0f0,
    bodyColor: 0xf0f0f0,    // white base
    accentColor: 0x003399,  // blue stripes
    windowColor: 0x88ccff,
    wheelColor: 0x111111,
    description: 'Full WRC spec — all-terrain, all conditions',
    speed: 4,
    handling: 4,
  },
];
