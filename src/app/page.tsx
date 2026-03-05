'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import NicknameScreen from '@/components/NicknameScreen';
import CarSelector from '@/components/CarSelector';

// Dynamic import for Three.js component (no SSR)
const GameCanvas = dynamic(() => import('@/components/GameCanvas'), { ssr: false });

// Single map — Forêt de Bretagne (id 0)
const MAP_ID = 0;

type Phase = 'nickname' | 'carSelect' | 'racing';

export default function Home() {
  const [phase, setPhase] = useState<Phase>('nickname');
  const [nickname, setNickname] = useState('');
  const [selectedCar, setSelectedCar] = useState(0);

  const handleNickname = (nick: string) => {
    setNickname(nick);
    setPhase('carSelect');
  };

  const handleCar = (carId: number) => {
    setSelectedCar(carId);
    setPhase('racing');
  };

  const handleMenu = () => {
    setPhase('nickname');
    setNickname('');
    setSelectedCar(0);
  };

  return (
    <main style={{ width: '100%', height: '100%', touchAction: 'none', overflow: 'hidden' }}>
      {phase === 'nickname' && (
        <NicknameScreen onSubmit={handleNickname} />
      )}
      {phase === 'carSelect' && (
        <CarSelector nickname={nickname} onSelect={handleCar} />
      )}
      {phase === 'racing' && (
        <GameCanvas
          nickname={nickname}
          carId={selectedCar}
          mapId={MAP_ID}
          onMenu={handleMenu}
        />
      )}
    </main>
  );
}
