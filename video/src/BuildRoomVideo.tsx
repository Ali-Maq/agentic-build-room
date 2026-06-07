import React from 'react';
import { AbsoluteFill, Series } from 'remotion';
import { C } from './theme';
import { Title, Thesis, Architecture, DemoAct, Closing } from './scenes';

export const FPS = 30;

// Scene durations (frames @ 30fps). Bump the DemoAct ones when you drop in real
// screen-recording clips (see README) so they hold the footage.
const S = {
  title: 90,
  thesis: 135,
  arch: 205,
  act1: 200,
  act2: 200,
  act3: 230,
  closing: 150,
};

export const TOTAL = Object.values(S).reduce((a, b) => a + b, 0); // 1210 ≈ 40s

export const BuildRoomVideo: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: C.bg }}>
    <Series>
      <Series.Sequence durationInFrames={S.title}>
        <Title />
      </Series.Sequence>
      <Series.Sequence durationInFrames={S.thesis}>
        <Thesis />
      </Series.Sequence>
      <Series.Sequence durationInFrames={S.arch}>
        <Architecture />
      </Series.Sequence>
      <Series.Sequence durationInFrames={S.act1}>
        <DemoAct
          n="01"
          title="Collaborative build"
          caption="A human and an AI agent edit the same app — the live preview updates for everyone."
          variant="build"
        />
      </Series.Sequence>
      <Series.Sequence durationInFrames={S.act2}>
        <DemoAct
          n="02"
          title="Human-steered AI"
          caption="Type an instruction → your Claude Opus 4.8 agent writes the file."
          variant="steer"
        />
      </Series.Sequence>
      <Series.Sequence durationInFrames={S.act3}>
        <DemoAct
          n="03"
          title="Graded live"
          caption="A real HumanEval task — unit tests run in a sandbox → verified PASS."
          variant="grade"
        />
      </Series.Sequence>
      <Series.Sequence durationInFrames={S.closing}>
        <Closing />
      </Series.Sequence>
    </Series>
  </AbsoluteFill>
);
