// Model-agnostic LLM gateway for the arena.
// ONE generate() call, many backends — so the "AI collective" can be genuinely
// multi-model/multi-vendor, and so the human-steered side, the agents, and the
// judge can each use whatever is available on this machine.
//
// Available backends discovered on this machine (Jun 2026):
//   - gemini       : GEMINI_API_KEY in env (works today, public internet)
//   - azure        : Azure OpenAI gpt-5.4-pro via Mount Sinai VPN private endpoint
//                    (needs AZURE_API_KEY; ONLY reachable from the Mac on VPN)
//   - openrouter   : any model (anthropic/*, openai/*, google/*) if OPENROUTER_API_KEY set
//   - bedrock      : Claude via AWS Bedrock (profile mssm-bedrock) — see note below
//
// NETWORK NOTE: azure + bedrock only work from the VPN'd Mac, so the runner that
// uses them must run locally during the demo (not on a public Railway/Fly host).

export type Role = 'system' | 'user' | 'assistant';
export type Msg = { role: Role; content: string };

export type GenOpts = {
  provider?: Provider;       // defaults to DEFAULT_PROVIDER
  model?: string;            // provider-specific model id
  system?: string;
  messages: Msg[];
  temperature?: number;
  maxOutputTokens?: number;
  jsonSchema?: object;       // when set, ask for strict JSON and parse it
  onDelta?: (chunk: string) => void; // if set, stream tokens
};

export type GenResult = { text: string; json?: any; provider: Provider; model: string };

export type Provider = 'gemini' | 'azure' | 'openrouter' | 'bedrock';

// ---- Model roster: name a logical agent -> a concrete (provider, model). -----
// This is what makes the "multi-model AI collective" real. Override via env.
export const ROSTER: Record<string, { provider: Provider; model: string }> = {
  // role          provider     model
  solver:   pick('SOLVER',   'gemini',     'gemini-2.5-pro'),
  critic:   pick('CRITIC',   'gemini',     'gemini-2.5-flash'),
  verifier: pick('VERIFIER', 'gemini',     'gemini-2.5-flash'),
  human_llm: pick('HUMAN',   'gemini',     'gemini-2.5-pro'),
  judge:    pick('JUDGE',    'gemini',     'gemini-2.5-pro'),
};

function pick(prefix: string, p: Provider, m: string): { provider: Provider; model: string } {
  const provider = (process.env[`${prefix}_PROVIDER`] as Provider) || p;
  const model = process.env[`${prefix}_MODEL`] || m;
  return { provider, model };
}

const DEFAULT_PROVIDER: Provider = (process.env.LLM_PROVIDER as Provider) || 'gemini';

// Which providers actually have a usable key/route right now.
export function availableProviders(): Provider[] {
  const out: Provider[] = [];
  if (process.env.GEMINI_API_KEY) out.push('gemini');
  if (process.env.AZURE_API_KEY) out.push('azure');
  if (process.env.OPENROUTER_API_KEY) out.push('openrouter');
  if (process.env.AWS_PROFILE || process.env.AWS_ACCESS_KEY_ID) out.push('bedrock');
  return out;
}

// ---------------------------------------------------------------------------
export async function generate(opts: GenOpts): Promise<GenResult> {
  const provider = opts.provider ?? DEFAULT_PROVIDER;
  switch (provider) {
    case 'gemini': return gemini(opts);
    case 'azure': return azure(opts);
    case 'openrouter': return openrouter(opts);
    case 'bedrock': return bedrock(opts);
    default: throw new Error(`unknown provider ${provider}`);
  }
}

function parseJson(text: string): any {
  try { return JSON.parse(text); } catch {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return undefined;
}

// ---- Gemini (Google AI Studio REST) ---------------------------------------
async function gemini(o: GenOpts): Promise<GenResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not set');
  const model = o.model ?? 'gemini-2.5-flash';
  const contents = o.messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const generationConfig: any = {
    temperature: o.temperature ?? 0.7,
    maxOutputTokens: o.maxOutputTokens ?? 1024,
    // flash latency: disable extended thinking unless caller wants it
    thinkingConfig: { thinkingBudget: 0 },
  };
  if (o.jsonSchema) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = o.jsonSchema;
  }
  const body: any = { contents, generationConfig };
  if (o.system) body.systemInstruction = { parts: [{ text: o.system }] };

  const base = `https://generativelanguage.googleapis.com/v1beta/models/${model}`;
  if (o.onDelta) {
    const res = await fetch(`${base}:streamGenerateContent?alt=sse&key=${key}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const text = await readSSE(res, (j) => {
      const t = j?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (t) o.onDelta!(t);
      return t ?? '';
    });
    return { text, json: o.jsonSchema ? parseJson(text) : undefined, provider: 'gemini', model };
  }
  const res = await fetch(`${base}:generateContent?key=${key}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}: ${await res.text()}`);
  const j = await res.json();
  const text = j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';
  return { text, json: o.jsonSchema ? parseJson(text) : undefined, provider: 'gemini', model };
}

// ---- Azure OpenAI (Responses API, private VPN endpoint) -------------------
// Works only from the Mount Sinai VPN. gpt-5.4-pro is the deployed GPT model.
async function azure(o: GenOpts): Promise<GenResult> {
  const key = process.env.AZURE_API_KEY;
  if (!key) throw new Error('AZURE_API_KEY not set');
  const host = process.env.AZURE_OPENAI_HOST
    ?? 'https://aif-shajam-ari-nonprod-eus2-01.cognitiveservices.azure.com';
  const apiVersion = process.env.AZURE_API_VERSION ?? '2025-04-01-preview';
  const model = o.model ?? 'gpt-5.4-pro';
  // Responses API: system -> instructions, conversation -> input array.
  const input = o.messages.map((m) => ({
    role: m.role === 'system' ? 'developer' : m.role,
    content: m.content,
  }));
  const body: any = {
    model,
    input,
    max_output_tokens: o.maxOutputTokens ?? 1024,
    reasoning: { effort: process.env.AZURE_REASONING_EFFORT ?? 'medium' },
  };
  if (o.system) body.instructions = o.system;
  if (o.jsonSchema) {
    body.text = { format: { type: 'json_schema', name: 'out', schema: o.jsonSchema } };
  }
  const res = await fetch(`${host}/openai/responses?api-version=${apiVersion}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'api-key': key },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`azure ${res.status}: ${await res.text()}`);
  const j = await res.json();
  // Responses API: prefer output_text; else flatten output[].content[].text
  const text =
    j.output_text ??
    (j.output ?? [])
      .flatMap((it: any) => it.content ?? [])
      .map((c: any) => c.text ?? '')
      .join('') ??
    '';
  return { text, json: o.jsonSchema ? parseJson(text) : undefined, provider: 'azure', model };
}

// ---- OpenRouter (any model, OpenAI-compatible) ----------------------------
// model ids like: anthropic/claude-opus-4.8, openai/gpt-4o, google/gemini-2.5-pro
async function openrouter(o: GenOpts): Promise<GenResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY not set');
  const model = o.model ?? 'anthropic/claude-sonnet-4-6';
  const messages: Msg[] = o.system ? [{ role: 'system', content: o.system }, ...o.messages] : o.messages;
  const body: any = {
    model, messages,
    temperature: o.temperature ?? 0.7,
    max_tokens: o.maxOutputTokens ?? 1024,
  };
  if (o.jsonSchema) body.response_format = { type: 'json_object' };
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`openrouter ${res.status}: ${await res.text()}`);
  const j = await res.json();
  const text = j?.choices?.[0]?.message?.content ?? '';
  return { text, json: o.jsonSchema ? parseJson(text) : undefined, provider: 'openrouter', model };
}

// ---- Bedrock (Claude) -----------------------------------------------------
// Their existing `claw-bedrock` alias uses AWS_PROFILE=mssm-bedrock, region
// us-east-1, model us.anthropic.claude-opus-4-6-v1 (latest available: bump to
// claude-opus-4-8 / claude-sonnet-4-6 if enabled in the account). Requires the
// AWS SDK + VPN/network to Bedrock. Lazy-imported so the SDK is optional.
async function bedrock(o: GenOpts): Promise<GenResult> {
  const region = process.env.AWS_REGION ?? 'us-east-1';
  const model = o.model ?? 'us.anthropic.claude-sonnet-4-6-v1';
  let BR: any;
  try {
    BR = await import('@aws-sdk/client-bedrock-runtime');
  } catch {
    throw new Error('bedrock provider needs @aws-sdk/client-bedrock-runtime installed');
  }
  const client = new BR.BedrockRuntimeClient({ region });
  const anthropicMsgs = o.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: [{ type: 'text', text: m.content }] }));
  let system = o.system;
  if (o.jsonSchema) {
    system = [
      system,
      'Return only a single valid JSON object. Do not include Markdown, prose,',
      'code fences, or commentary. The JSON object must match this schema:',
      JSON.stringify(o.jsonSchema),
    ]
      .filter(Boolean)
      .join('\n\n');
  }
  const payload: any = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: o.maxOutputTokens ?? 1024,
    messages: anthropicMsgs,
  };
  // Newer Claude profiles on Bedrock (for example Opus 4.8) reject the
  // Messages API `temperature` field. Keep deterministic defaults unless a
  // caller explicitly opts into the legacy field for older models.
  if (process.env.BEDROCK_SEND_TEMPERATURE === '1' && o.temperature !== undefined) {
    payload.temperature = o.temperature;
  }
  if (system) payload.system = system;
  const res = await client.send(
    new BR.InvokeModelCommand({
      modelId: model,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    })
  );
  const j = JSON.parse(new TextDecoder().decode(res.body));
  const text = (j.content ?? []).map((c: any) => c.text ?? '').join('');
  return { text, json: o.jsonSchema ? parseJson(text) : undefined, provider: 'bedrock', model };
}

// ---- SSE reader -----------------------------------------------------------
async function readSSE(res: Response, onJson: (j: any) => string): Promise<string> {
  if (!res.ok || !res.body) throw new Error(`stream ${res.status}: ${await res.text()}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith('data:')) continue;
      const data = s.slice(5).trim();
      if (data === '[DONE]') continue;
      try { full += onJson(JSON.parse(data)); } catch {}
    }
  }
  return full;
}
