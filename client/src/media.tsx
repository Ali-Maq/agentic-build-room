import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type MediaState = {
  stream: MediaStream | null;
  camOn: boolean;
  micOn: boolean;
  error: string | null;
  start: () => Promise<void>;
  toggleCam: () => void;
  toggleMic: () => void;
};

const Ctx = createContext<MediaState | null>(null);

export function MediaProvider({ children }: { children: ReactNode }) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [camOn, setCamOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const starting = useRef(false);

  const start = async () => {
    if (stream || starting.current) return;
    starting.current = true;
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } },
        audio: true,
      });
      setStream(s);
      s.getVideoTracks().forEach((t) => (t.enabled = true));
      s.getAudioTracks().forEach((t) => (t.enabled = true));
    } catch (e: any) {
      setError(e?.message ?? 'camera/mic blocked');
    } finally {
      starting.current = false;
    }
  };

  const toggleCam = () => {
    setCamOn((on) => {
      const next = !on;
      stream?.getVideoTracks().forEach((t) => (t.enabled = next));
      return next;
    });
  };
  const toggleMic = () => {
    setMicOn((on) => {
      const next = !on;
      stream?.getAudioTracks().forEach((t) => (t.enabled = next));
      return next;
    });
  };

  // Acquire on mount so the lobby preview and room share one stream.
  useEffect(() => {
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Ctx.Provider value={{ stream, camOn, micOn, error, start, toggleCam, toggleMic }}>
      {children}
    </Ctx.Provider>
  );
}

export function useMedia() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useMedia outside MediaProvider');
  return c;
}
