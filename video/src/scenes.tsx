import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { C, fraunces, hanken, mono } from './theme';

// ---- animation helpers ----------------------------------------------------
function useUp(delay = 0, dist = 24) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 200 } });
  return { opacity: s, transform: `translateY(${(1 - s) * dist}px)` };
}
function fadeIn(frame: number, start: number, len = 12) {
  return interpolate(frame, [start, start + len], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
}

const Stage: React.FC<{ children: React.ReactNode; bg?: string }> = ({ children, bg }) => (
  <AbsoluteFill
    style={{
      backgroundColor: bg ?? C.bg,
      fontFamily: hanken,
      color: C.ink,
      padding: 110,
      justifyContent: 'center',
    }}
  >
    {children}
  </AbsoluteFill>
);

const Kicker: React.FC<{ children: React.ReactNode; delay?: number }> = ({ children, delay = 0 }) => (
  <div
    style={{
      ...useUp(delay),
      fontFamily: mono,
      fontSize: 26,
      letterSpacing: 6,
      textTransform: 'uppercase',
      color: C.green,
      marginBottom: 28,
    }}
  >
    {children}
  </div>
);

// ---- 1. TITLE -------------------------------------------------------------
export const Title: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Stage>
      <Kicker delay={4}>SpacetimeDB Launchpad · NYC</Kicker>
      <div style={{ ...useUp(10), fontFamily: fraunces, fontSize: 132, lineHeight: 1.02, letterSpacing: -2 }}>
        Build Room
      </div>
      <div style={{ ...useUp(20), fontSize: 44, color: C.inkSoft, marginTop: 24, maxWidth: 1300 }}>
        Humans <span style={{ color: C.green }}>+</span> AI agents, co-building on a database.
      </div>
      <div
        style={{
          opacity: fadeIn(frame, 40),
          marginTop: 60,
          fontFamily: mono,
          fontSize: 28,
          color: C.amber,
        }}
      >
        “The database is the arena.”
      </div>
    </Stage>
  );
};

// ---- 2. THESIS ------------------------------------------------------------
export const Thesis: React.FC = () => {
  const frame = useCurrentFrame();
  const lines = [
    ['GitHub is how teams collaborate ', 'asynchronously', '.'],
    ['This is the ', 'live, multiplayer, human + AI', ' version.'],
  ];
  return (
    <Stage>
      <Kicker>The idea</Kicker>
      {lines.map((parts, i) => (
        <div
          key={i}
          style={{
            ...useUp(8 + i * 14),
            fontFamily: fraunces,
            fontSize: 76,
            lineHeight: 1.15,
            marginBottom: 10,
          }}
        >
          {parts[0]}
          <span style={{ color: C.green }}>{parts[1]}</span>
          {parts[2]}
        </div>
      ))}
      <div style={{ opacity: fadeIn(frame, 50), marginTop: 50, fontSize: 38, color: C.inkSoft, maxWidth: 1400 }}>
        A team joins a room, each person steers their own coding agent, and they build a working app — in real
        time, on shared state — watching it render as they go.
      </div>
    </Stage>
  );
};

// ---- 3. ARCHITECTURE ------------------------------------------------------
const Box: React.FC<{ x: number; show: number; label: string; sub?: string; w?: number; accent?: string }> = ({
  x,
  show,
  label,
  sub,
  w = 460,
  accent = C.line,
}) => {
  const frame = useCurrentFrame();
  const o = fadeIn(frame, show);
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: 380,
        width: w,
        opacity: o,
        transform: `translateY(${(1 - o) * 16}px)`,
        background: C.panel,
        border: `2px solid ${accent}`,
        borderRadius: 18,
        padding: '28px 30px',
      }}
    >
      <div style={{ fontFamily: mono, fontSize: 30, color: accent === C.line ? C.ink : accent }}>{label}</div>
      {sub && <div style={{ fontSize: 24, color: C.inkSoft, marginTop: 12, lineHeight: 1.4 }}>{sub}</div>}
    </div>
  );
};

export const Architecture: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Stage>
      <Kicker>How it works</Kicker>
      <div style={{ ...useUp(6), fontFamily: fraunces, fontSize: 64 }}>
        One SpacetimeDB module. <span style={{ color: C.inkSoft }}>No app server.</span>
      </div>

      <Box x={110} show={24} label="Browsers" sub="humans + spectators · render purely from subscriptions" accent={C.blue} />
      <Box x={730} show={40} label="SpacetimeDB" sub="15 tables = ALL state · reducers = only writes · the live medium" accent={C.green} w={520} />
      <Box x={1370} show={56} label="Runner" sub="Node client · calls the LLM / runs unit tests · keys stay here" accent={C.ai} />

      {/* flow line */}
      <div
        style={{
          position: 'absolute',
          left: 110,
          top: 350,
          width: 1700,
          height: 3,
          background: C.line,
          opacity: fadeIn(frame, 70),
        }}
      />
      <div
        style={{
          opacity: fadeIn(frame, 90),
          position: 'absolute',
          top: 640,
          left: 110,
          fontSize: 32,
          color: C.amber,
          fontFamily: mono,
        }}
      >
        every file · keystroke · agent thought · vote  →  a row
      </div>
    </Stage>
  );
};

// ---- app mock (used in demo acts) ----------------------------------------
const codeLines = [
  'function App() {',
  "  const [cards, set] = useState([]);",
  '  return <Board cards={cards} />;',
  '}',
];

const AppMock: React.FC<{ variant: 'build' | 'steer' | 'grade' }> = ({ variant }) => {
  const frame = useCurrentFrame();
  const typed = Math.floor(interpolate(frame, [10, 80], [0, codeLines.length], { extrapolateRight: 'clamp' }));
  return (
    <div
      style={{
        width: 1500,
        height: 720,
        background: C.bg2,
        border: `1px solid ${C.line}`,
        borderRadius: 18,
        overflow: 'hidden',
        display: 'grid',
        gridTemplateColumns: '250px 1fr 460px',
        boxShadow: '0 40px 120px rgba(0,0,0,.5)',
      }}
    >
      {/* rail */}
      <div style={{ borderRight: `1px solid ${C.line}`, padding: 18, background: C.panel }}>
        {['You', variant === 'grade' ? 'Solver · Claude' : 'Ada', variant !== 'build' ? 'Claude Opus 4.8' : 'Gemini'].map(
          (n, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                background: C.bg2,
                border: `1px solid ${C.line}`,
                borderRadius: 12,
                padding: '12px 14px',
                marginBottom: 10,
                opacity: fadeIn(frame, 6 + i * 6),
              }}
            >
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  background: i === 0 ? C.green : C.ai,
                  color: '#101',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 16,
                  fontWeight: 700,
                }}
              >
                {i === 0 ? '🧑' : '🤖'}
              </div>
              <div style={{ fontSize: 19, color: C.ink }}>{n}</div>
            </div>
          )
        )}
        {variant === 'steer' && (
          <div style={{ marginTop: 14, fontFamily: mono, fontSize: 16, color: C.green, opacity: fadeIn(frame, 30) }}>
            ● writing…
          </div>
        )}
      </div>

      {/* editor */}
      <div style={{ padding: 22, fontFamily: mono, fontSize: 22, lineHeight: 1.7, background: C.bg }}>
        <div style={{ color: C.faint, marginBottom: 14 }}>
          {variant === 'grade' ? 'solution.py' : 'app.js'}
        </div>
        {(variant === 'grade'
          ? ['def has_close_elements(nums, t):', '    nums = sorted(nums)', '    return any(b-a < t', '        for a,b in zip(nums, nums[1:]))']
          : codeLines
        ).map((l, i) => (
          <div key={i} style={{ color: i < typed ? C.ink : 'transparent' }}>
            <span style={{ color: C.faint, marginRight: 16 }}>{i + 1}</span>
            {l}
          </div>
        ))}
      </div>

      {/* preview / verdict */}
      <div style={{ borderLeft: `1px solid ${C.line}`, background: C.paper, position: 'relative' }}>
        {variant === 'grade' ? (
          <div style={{ padding: 40, color: '#1C1B19' }}>
            <div style={{ fontFamily: fraunces, fontSize: 64, color: C.greenDeep, opacity: fadeIn(frame, 60) }}>
              PASS
            </div>
            <div style={{ fontSize: 30, marginTop: 10, opacity: fadeIn(frame, 70) }}>1 / 1 tests passed</div>
            <div
              style={{
                marginTop: 24,
                fontFamily: mono,
                fontSize: 20,
                color: C.greenDeep,
                opacity: fadeIn(frame, 80),
              }}
            >
              {'{ "passed":1, "ok":true }'}
            </div>
            <div style={{ marginTop: 18, fontSize: 18, color: '#6B6863', opacity: fadeIn(frame, 86) }}>
              ✓ verified · real unit tests
            </div>
          </div>
        ) : (
          <div style={{ padding: 30, color: '#1C1B19' }}>
            <div style={{ fontFamily: fraunces, fontSize: 30, opacity: fadeIn(frame, 40) }}>Kanban</div>
            <div style={{ display: 'flex', gap: 12, marginTop: 18 }}>
              {['Todo', 'Doing', 'Done'].map((c, i) => (
                <div
                  key={c}
                  style={{
                    flex: 1,
                    background: '#F0EEE8',
                    borderRadius: 10,
                    padding: 12,
                    opacity: fadeIn(frame, 46 + i * 6),
                  }}
                >
                  <div style={{ fontSize: 16, color: '#6B6863', marginBottom: 8 }}>{c}</div>
                  <div style={{ height: 34, background: '#fff', borderRadius: 6, marginBottom: 6 }} />
                  <div style={{ height: 34, background: '#fff', borderRadius: 6 }} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ---- demo act -------------------------------------------------------------
export const DemoAct: React.FC<{ n: string; title: string; caption: string; variant: 'build' | 'steer' | 'grade' }> = ({
  n,
  title,
  caption,
  variant,
}) => {
  return (
    <Stage>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 22, ...useUp(4) }}>
        <span style={{ fontFamily: mono, fontSize: 30, color: C.green }}>{n}</span>
        <span style={{ fontFamily: fraunces, fontSize: 58 }}>{title}</span>
      </div>
      <div style={{ ...useUp(10), fontSize: 32, color: C.inkSoft, marginTop: 10, marginBottom: 34 }}>{caption}</div>
      <div style={{ display: 'flex', justifyContent: 'center', ...useUp(14, 40) }}>
        <AppMock variant={variant} />
      </div>
      {/* To use real footage instead of the mock: replace <AppMock/> with
          <OffthreadVideo src={staticFile('clip-build.mp4')} /> (see video/README.md). */}
    </Stage>
  );
};

// ---- closing --------------------------------------------------------------
export const Closing: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Stage>
      <Kicker>Built on SpacetimeDB + Claude + Gemini</Kicker>
      <div style={{ ...useUp(8), fontFamily: fraunces, fontSize: 84, lineHeight: 1.05 }}>
        Real-time. Multiplayer.
        <br />
        <span style={{ color: C.green }}>The DB is the server.</span>
      </div>
      <div style={{ opacity: fadeIn(frame, 40), marginTop: 50, fontFamily: mono, fontSize: 30, color: C.ink }}>
        client-alpha-seven-64.vercel.app
      </div>
      <div style={{ opacity: fadeIn(frame, 50), marginTop: 12, fontFamily: mono, fontSize: 26, color: C.inkSoft }}>
        github.com/Ali-Maq/agentic-build-room
      </div>
    </Stage>
  );
};
