import React from 'react';
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
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

const Stage: React.FC<{ children: React.ReactNode; bg?: string; align?: 'center' | 'top' }> = ({
  children,
  bg,
  align = 'center',
}) => (
  <AbsoluteFill
    style={{
      backgroundColor: bg ?? C.bg,
      fontFamily: hanken,
      color: C.ink,
      padding: 110,
      justifyContent: align === 'top' ? 'flex-start' : 'center',
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

const Pill: React.FC<{ children: React.ReactNode; accent?: string }> = ({ children, accent = C.green }) => (
  <div
    style={{
      border: `1px solid ${accent}`,
      color: accent,
      borderRadius: 999,
      padding: '10px 18px',
      fontFamily: mono,
      fontSize: 22,
      background: 'rgba(255,255,255,0.025)',
      whiteSpace: 'nowrap',
    }}
  >
    {children}
  </div>
);

const BrowserShot: React.FC<{ src: string; show?: number; scale?: number; width?: number }> = ({
  src,
  show = 0,
  scale = 1,
  width = 1320,
}) => {
  const frame = useCurrentFrame();
  const opacity = fadeIn(frame, show, 16);
  return (
    <div
      style={{
        opacity,
        transform: `scale(${scale}) translateY(${(1 - opacity) * 20}px)`,
        transformOrigin: 'center',
        width,
        borderRadius: 22,
        overflow: 'hidden',
        border: `1px solid ${C.line}`,
        boxShadow: '0 38px 120px rgba(0,0,0,.55)',
        background: C.panel,
      }}
    >
      <div
        style={{
          height: 44,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '0 18px',
          borderBottom: `1px solid ${C.line}`,
          background: '#17140F',
        }}
      >
        <span style={{ width: 12, height: 12, borderRadius: 12, background: '#ED6A5E' }} />
        <span style={{ width: 12, height: 12, borderRadius: 12, background: '#F4BF4F' }} />
        <span style={{ width: 12, height: 12, borderRadius: 12, background: '#61C554' }} />
        <span style={{ marginLeft: 18, fontFamily: mono, fontSize: 18, color: C.inkSoft }}>
          client-alpha-seven-64.vercel.app
        </span>
      </div>
      <Img src={staticFile(src)} style={{ display: 'block', width: '100%' }} />
    </div>
  );
};

// ---- 1. TITLE -------------------------------------------------------------
export const Title: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Stage>
      <Kicker delay={4}>SpacetimeDB Launchpad · NYC</Kicker>
      <div style={{ ...useUp(10), fontFamily: fraunces, fontSize: 132, lineHeight: 1.02 }}>
        Build Room
      </div>
      <div style={{ ...useUp(20), fontSize: 44, color: C.inkSoft, marginTop: 24, maxWidth: 1300 }}>
        A live multiplayer arena where humans and AI agents build on the same database state.
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

// ---- 2. PROBLEM -----------------------------------------------------------
export const Problem: React.FC = () => {
  const frame = useCurrentFrame();
  const cards = [
    ['AI demos are usually lonely', 'One user, one chat, one temporary answer.'],
    ['Files vanish between turns', 'Artifacts are exports, not durable shared state.'],
    ['Agents cannot coordinate', 'There is no live room where humans, agents, and graders are peers.'],
  ];
  return (
    <Stage>
      <Kicker>The problem</Kicker>
      <div style={{ ...useUp(6), fontFamily: fraunces, fontSize: 72, lineHeight: 1.12, maxWidth: 1420 }}>
        The hard part is not prompting.
        <br />
        <span style={{ color: C.green }}>It is shared state.</span>
      </div>
      <div style={{ display: 'flex', gap: 22, marginTop: 60 }}>
        {cards.map(([title, body], i) => (
          <div
            key={title}
            style={{
              opacity: fadeIn(frame, 30 + i * 14),
              width: 520,
              minHeight: 220,
              border: `1px solid ${C.line}`,
              background: C.panel,
              borderRadius: 18,
              padding: 28,
            }}
          >
            <div style={{ fontFamily: fraunces, fontSize: 38, lineHeight: 1.05 }}>{title}</div>
            <div style={{ marginTop: 18, fontSize: 25, color: C.inkSoft, lineHeight: 1.35 }}>{body}</div>
          </div>
        ))}
      </div>
    </Stage>
  );
};

// ---- 3. THESIS ------------------------------------------------------------
export const Thesis: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Stage>
      <Kicker>The answer</Kicker>
      <div style={{ ...useUp(8), fontFamily: fraunces, fontSize: 80, lineHeight: 1.12, maxWidth: 1450 }}>
        Make the database the multiplayer workspace.
      </div>
      <div style={{ opacity: fadeIn(frame, 36), marginTop: 44, fontSize: 38, color: C.inkSoft, maxWidth: 1420 }}>
        Every participant is just a SpacetimeDB client: browsers, Claude, Gemini, graders, spectators. They
        subscribe to the same room and mutate state only through reducers.
      </div>
      <div style={{ display: 'flex', gap: 18, marginTop: 52, opacity: fadeIn(frame, 58) }}>
        <Pill>files are rows</Pill>
        <Pill>intents are rows</Pill>
        <Pill>agent thoughts are rows</Pill>
        <Pill>verdicts are rows</Pill>
      </div>
    </Stage>
  );
};

// ---- 4. ARCHITECTURE ------------------------------------------------------
const Box: React.FC<{ x: number; show: number; label: string; sub?: string; w?: number; accent?: string; top?: number }> = ({
  x,
  show,
  label,
  sub,
  w = 460,
  accent = C.line,
  top = 388,
}) => {
  const frame = useCurrentFrame();
  const o = fadeIn(frame, show);
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top,
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
    <Stage align="top">
      <Kicker>Why it is SpacetimeDB-native</Kicker>
      <div style={{ ...useUp(6), fontFamily: fraunces, fontSize: 64 }}>
        No app server. <span style={{ color: C.green }}>One module owns the arena.</span>
      </div>

      {/* connector line sits behind the three boxes (rendered before them) */}
      <div
        style={{
          position: 'absolute',
          left: 135,
          top: 432,
          width: 1640,
          height: 3,
          background: C.line,
          opacity: fadeIn(frame, 70),
        }}
      />
      <Box x={110} top={372} show={24} label="Browsers" sub="humans + spectators render from subscriptions" accent={C.blue} />
      <Box x={705} top={372} show={40} label="SpacetimeDB" sub="tables = state · reducers = rules · subscriptions = live UI" accent={C.green} w={560} />
      <Box x={1390} top={372} show={56} label="Runners" sub="LLMs + test sandboxes act as normal clients" accent={C.ai} />

      <div
        style={{
          opacity: fadeIn(frame, 88),
          position: 'absolute',
          top: 640,
          left: 118,
          fontSize: 31,
          color: C.amber,
          fontFamily: mono,
        }}
      >
        The app being built is not saved after the fact. It is live database state.
      </div>
      <div style={{ position: 'absolute', top: 716, left: 118, display: 'flex', gap: 16, opacity: fadeIn(frame, 100) }}>
        <Pill accent={C.blue}>room-scoped subscriptions</Pill>
        <Pill accent={C.green}>deterministic reducers</Pill>
        <Pill accent={C.ai}>private benchmark secrets</Pill>
      </div>
    </Stage>
  );
};

export const ProofScene: React.FC<{
  n: string;
  kicker: string;
  title: string;
  caption: string;
  src: string;
  badge: string;
  accent?: string;
}> = ({ n, kicker, title, caption, src, badge, accent = C.green }) => {
  const frame = useCurrentFrame();
  return (
    <Stage>
      {/* Two columns: the real hosted screenshot (proof) on the left, the
          narrative on the right. Bounded height so nothing clips. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 56 }}>
        <BrowserShot src={src} show={14} width={1040} />
        <div style={{ width: 600 }}>
          <div style={{ ...useUp(2), display: 'flex', gap: 14, alignItems: 'center', marginBottom: 18 }}>
            <Pill accent={accent}>{n}</Pill>
            <span style={{ fontFamily: mono, fontSize: 22, color: C.inkSoft }}>{kicker}</span>
          </div>
          <div style={{ ...useUp(6), fontFamily: fraunces, fontSize: 48, lineHeight: 1.08 }}>{title}</div>
          <div style={{ ...useUp(12), fontSize: 26, color: C.inkSoft, marginTop: 16, lineHeight: 1.35 }}>
            {caption}
          </div>
          <div
            style={{
              opacity: fadeIn(frame, 40),
              marginTop: 26,
              borderLeft: `4px solid ${accent}`,
              paddingLeft: 22,
              fontSize: 23,
              lineHeight: 1.3,
              color: C.ink,
            }}
          >
            {badge}
          </div>
        </div>
      </div>
    </Stage>
  );
};

export const Scorecard: React.FC = () => {
  const frame = useCurrentFrame();
  const rows = [
    ['Innovation', 'AI agents are first-class multiplayer clients, not chatbots bolted on.'],
    ['UX', 'Live room, live preview, activity feed, benchmark verdicts.'],
    ['Completeness', 'Hosted on Vercel, Maincloud module, HumanEval PASS verified.'],
    ['Sponsor tech', 'SpacetimeDB is the backend, rules engine, artifact store, and sync layer.'],
  ];
  return (
    <Stage>
      <Kicker>Judge scorecard</Kicker>
      <div style={{ ...useUp(6), fontFamily: fraunces, fontSize: 70, maxWidth: 1450, lineHeight: 1.08 }}>
        This is not a CRUD app with realtime sprinkled on top.
      </div>
      <div style={{ marginTop: 50, display: 'grid', gap: 18, width: 1500 }}>
        {rows.map(([label, body], i) => (
          <div
            key={label}
            style={{
              opacity: fadeIn(frame, 28 + i * 10),
              display: 'grid',
              gridTemplateColumns: '270px 1fr',
              gap: 30,
              alignItems: 'center',
              padding: '24px 28px',
              border: `1px solid ${C.line}`,
              borderRadius: 16,
              background: C.panel,
            }}
          >
            <div style={{ fontFamily: mono, color: C.green, fontSize: 25 }}>{label}</div>
            <div style={{ fontSize: 30, color: C.inkSoft }}>{body}</div>
          </div>
        ))}
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
      <div style={{ ...useUp(8), fontFamily: fraunces, fontSize: 82, lineHeight: 1.05, maxWidth: 1450 }}>
        The submission is live.
        <br />
        <span style={{ color: C.green }}>The database is the arena.</span>
      </div>
      <div style={{ opacity: fadeIn(frame, 38), marginTop: 42, display: 'flex', gap: 16 }}>
        <Pill>hosted demo</Pill>
        <Pill>GitHub repo</Pill>
        <Pill>Maincloud backend</Pill>
        <Pill>verified tests</Pill>
      </div>
      <div style={{ opacity: fadeIn(frame, 56), marginTop: 58, fontFamily: mono, fontSize: 30, color: C.ink }}>
        client-alpha-seven-64.vercel.app
      </div>
      <div style={{ opacity: fadeIn(frame, 66), marginTop: 12, fontFamily: mono, fontSize: 26, color: C.inkSoft }}>
        github.com/Ali-Maq/agentic-build-room
      </div>
    </Stage>
  );
};
