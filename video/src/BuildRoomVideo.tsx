import React from 'react';
import { AbsoluteFill, Series } from 'remotion';
import { C } from './theme';
import { Architecture, Closing, Problem, ProofScene, Scorecard, Thesis, Title } from './scenes';

export const FPS = 30;

// Scene durations (frames @ 30fps). Bump the DemoAct ones when you drop in real
// screen-recording clips (see README) so they hold the footage.
const S = {
  title: 90,
  problem: 150,
  thesis: 150,
  arch: 210,
  proofBuild: 240,
  proofGrade: 250,
  scorecard: 190,
  closing: 150,
};

export const TOTAL = Object.values(S).reduce((a, b) => a + b, 0); // 1430 ≈ 48s

export const BuildRoomVideo: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: C.bg }}>
    <Series>
      <Series.Sequence durationInFrames={S.title}>
        <Title />
      </Series.Sequence>
      <Series.Sequence durationInFrames={S.problem}>
        <Problem />
      </Series.Sequence>
      <Series.Sequence durationInFrames={S.thesis}>
        <Thesis />
      </Series.Sequence>
      <Series.Sequence durationInFrames={S.arch}>
        <Architecture />
      </Series.Sequence>
      <Series.Sequence durationInFrames={S.proofBuild}>
        <ProofScene
          n="01"
          kicker="Hosted Maincloud proof"
          title="Claude writes the app by mutating database rows."
          caption="In the public Vercel app, a human submits an intent, the paired Claude runner registers as a SpacetimeDB client, and index.html advances from v1 to v2."
          src="hosted-write.png"
          badge="This is the actual hosted app: Maincloud room, live subscriptions, agent activity, file version bump, and preview in one surface."
        />
      </Series.Sequence>
      <Series.Sequence durationInFrames={S.proofGrade}>
        <ProofScene
          n="02"
          kicker="Verified benchmark proof"
          title="The room grades real HumanEval tests live."
          caption="The agent writes solution.py, the grader executes the dataset's unit tests in a sandbox, and the verdict row flips to PASS for everyone."
          src="humaneval-pass.png"
          badge="The secret tests never reach the browser. They live in a private table and the grader writes only the public verdict."
          accent={C.amber}
        />
      </Series.Sequence>
      <Series.Sequence durationInFrames={S.scorecard}>
        <Scorecard />
      </Series.Sequence>
      <Series.Sequence durationInFrames={S.closing}>
        <Closing />
      </Series.Sequence>
    </Series>
  </AbsoluteFill>
);
