'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import NicknameScreen from '@/components/NicknameScreen';
import CarSelector from '@/components/CarSelector';
import MapSelector from '@/components/MapSelector';

// Dynamic import for Three.js component (no SSR)
const GameCanvas = dynamic(() => import('@/components/GameCanvas'), { ssr: false });

type Phase = 'nickname' | 'carSelect' | 'mapSelect' | 'racing';

export default function Home() {
  const [phase, setPhase] = useState<Phase>('nickname');
  const [nickname, setNickname] = useState('');
  const [selectedCar, setSelectedCar] = useState(0);
  const [selectedMap, setSelectedMap] = useState(0);

  const handleNickname = (nick: string) => {
    setNickname(nick);
    setPhase('carSelect');
  };

  const handleCar = (carId: number) => {
    setSelectedCar(carId);
    setPhase('mapSelect');
  };

  const handleMap = (mapId: number) => {
    setSelectedMap(mapId);
    setPhase('racing');
  };

  const handleMenu = () => {
    setPhase('nickname');
    setNickname('');
    setSelectedCar(0);
    setSelectedMap(0);
  };

  return (
    <main style={{ width: '100%', height: '100%' }}>
      {phase === 'nickname' && (
        <NicknameScreen onSubmit={handleNickname} />
      )}
      {phase === 'carSelect' && (
        <CarSelector nickname={nickname} onSelect={handleCar} />
      )}
      {phase === 'mapSelect' && (
        <MapSelector onSelect={handleMap} />
      )}
      {phase === 'racing' && (
        <GameCanvas
          nickname={nickname}
          carId={selectedCar}
          mapId={selectedMap}
          onMenu={handleMenu}
        />
      )}
    </main>
  );
}
