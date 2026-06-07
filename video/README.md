# Build Room — submission video (Remotion)

A self-contained [Remotion](https://remotion.dev) project that renders a ~40s explainer reel for the hackathon
submission: title → idea → architecture → 3 demo acts (collaborative build, human-steered Claude, HumanEval
graded) → closing. It renders **on its own** (animated motion graphics + an app mock), and you can swap in real
screen recordings for an even stronger reel.

## Run it

```bash
cd video
npm install
npm run studio      # live preview/editor at http://localhost:3000  (the "BuildRoom" composition)
npm run render      # exports out/build-room.mp4 (1920x1080, 30fps)
```

## Customize

- **Timing / order:** scene durations are in `src/BuildRoomVideo.tsx` (the `S` object). Bump `act1/act2/act3`
  to hold longer footage.
- **Copy / captions:** edit the `<DemoAct … caption=… />` props in `BuildRoomVideo.tsx` and the text in
  `src/scenes.tsx`.
- **Palette / fonts:** `src/theme.ts` (matches the app's Atelier system — Fraunces / Hanken Grotesk / JetBrains
  Mono, warm charcoal stage + forest-green accent).

## Drop in your real screen recordings (recommended)

Record three short clips of the live app (https://client-alpha-seven-64.vercel.app) — one per demo act — and:

1. Put them in `video/public/`, e.g. `clip-build.mp4`, `clip-steer.mp4`, `clip-grade.mp4`.
2. In `src/scenes.tsx`, inside `DemoAct`, replace `<AppMock variant={variant} />` with a real clip, e.g.:

   ```tsx
   import { OffthreadVideo, staticFile } from 'remotion';
   // …
   <OffthreadVideo src={staticFile(`clip-${variant === 'steer' ? 'steer' : variant}.mp4`)}
     style={{ width: 1500, borderRadius: 18 }} />
   ```

3. Bump that act's `durationInFrames` to match the clip length (frames = seconds × 30).

The mock stays as a graceful default if you don't add clips, so the project always renders.

## What to film for the 3 acts
1. **Collaborative build** — two browser windows in one room; a human edits a file + the agent edits another; the
   live preview updates in both.
2. **Human-steered AI** — type an intent in the IntentBar → the Claude agent writes the file → preview updates.
3. **Graded live** — a HumanEval benchmark room → agent writes `solution.py` → click Finish → VerdictCard PASS.
