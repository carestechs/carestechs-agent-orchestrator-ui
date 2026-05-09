import type { BffConfig } from '../session/types.js';

const HOP_BY_HOP = new Set([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-length',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'upgrade',
]);

const STRIP_INBOUND = new Set([...HOP_BY_HOP, 'authorization', 'cookie']);

export function buildForwardHeaders(
  inbound: Record<string, string | string[] | undefined>,
  apiKey: string,
): Headers {
  const out = new Headers();
  for (const [name, value] of Object.entries(inbound)) {
    if (value === undefined) continue;
    const lower = name.toLowerCase();
    if (STRIP_INBOUND.has(lower)) continue;
    if (Array.isArray(value)) {
      for (const v of value) out.append(name, v);
    } else {
      out.set(name, value);
    }
  }
  out.set('authorization', `Bearer ${apiKey}`);
  out.set('accept-encoding', 'identity');
  return out;
}

export interface ForwardJsonRequest {
  method: string;
  path: string; // segment after /api/v1, including leading slash
  query: URLSearchParams;
  headers: Record<string, string | string[] | undefined>;
  body: BodyInit | null;
}

export interface ForwardJsonResult {
  status: number;
  headers: Headers;
  body: Uint8Array;
}

export async function forwardJson(
  req: ForwardJsonRequest,
  config: BffConfig,
): Promise<ForwardJsonResult> {
  const url = buildUpstreamUrl(config.orchestratorBaseUrl, req.path, req.query);
  const headers = buildForwardHeaders(req.headers, config.orchestratorApiKey);

  const init: RequestInit = {
    method: req.method,
    headers,
    body: req.body,
  };
  if (req.body !== null && req.body !== undefined) {
    // Node fetch requires duplex when sending a stream/Buffer body for non-GET.
    (init as RequestInit & { duplex?: 'half' }).duplex = 'half';
  }

  const upstream = await fetch(url, init);
  const buf = new Uint8Array(await upstream.arrayBuffer());
  return { status: upstream.status, headers: upstream.headers, body: buf };
}

export async function streamTrace(
  runId: string,
  query: URLSearchParams,
  signal: AbortSignal,
  config: BffConfig,
): Promise<Response> {
  const path = `/runs/${encodeURIComponent(runId)}/trace`;
  const url = buildUpstreamUrl(config.orchestratorBaseUrl, path, query);
  const headers = new Headers({
    authorization: `Bearer ${config.orchestratorApiKey}`,
    accept: 'application/x-ndjson',
    'accept-encoding': 'identity',
  });
  return fetch(url, { method: 'GET', headers, signal });
}

function buildUpstreamUrl(base: string, path: string, query: URLSearchParams): string {
  const qs = query.toString();
  const sep = qs.length > 0 ? '?' : '';
  // base has trailing slashes already stripped; v1 prefix is added here.
  return `${base}/v1${path}${sep}${qs}`;
}
