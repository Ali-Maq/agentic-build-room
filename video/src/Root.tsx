import React from 'react';
import { Composition } from 'remotion';
import { BuildRoomVideo, TOTAL, FPS } from './BuildRoomVideo';

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="BuildRoom"
      component={BuildRoomVideo}
      durationInFrames={TOTAL}
      fps={FPS}
      width={1920}
      height={1080}
    />
  );
};
