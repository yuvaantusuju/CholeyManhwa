import { lookup } from 'node:dns/promises';
import net from 'node:net';

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function isPrivateAddress(address: string) {
  if (net.isIPv4(address)) {
    const parts = address.split('.').map(Number);
    return (
      parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
      parts[0] >= 224
    );
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return (
      normalized === '::1' || normalized === '::' || normalized.startsWith('fc') ||
      normalized.startsWith('fd') || normalized.startsWith('fe80:') ||
      normalized.startsWith('::ffff:127.') || normalized.startsWith('::ffff:10.') || normalized.startsWith('::ffff:192.168.')
    );
  }
  return true;
}

export async function assertSafeRemoteUrl(input: string) {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error('Invalid URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only HTTP and HTTPS URLs are supported');
  if (parsed.username || parsed.password) throw new Error('Authenticated URLs are not supported');
  if (['localhost', 'localhost.localdomain'].includes(parsed.hostname.toLowerCase())) throw new Error('Local URLs are not supported');
  if (net.isIP(parsed.hostname) && isPrivateAddress(parsed.hostname)) throw new Error('Private network URLs are not supported');
  const addresses = await lookup(parsed.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) throw new Error('Private network URLs are not supported');
  return parsed;
}

export function isCloudflareChallenge(html: string, status?: number) {
  const lower = String(html || '').toLowerCase();
  if ((status === 403 || status === 503) && (!html || html.length < 500 || lower.includes('just a moment') || lower.includes('challenge-platform') || lower.includes('checking your browser') || lower.includes('cloudflare'))) return true;
  return lower.includes('just a moment...') || (lower.includes('cf-browser-verification') && lower.includes('challenge'));
}

const MIRROR_MAP: Record<string, string[]> = {
  'www.toongod.org': ['www.toongod.cc', 'toongod.cc'],
  'toongod.org': ['www.toongod.cc', 'toongod.cc'],
  'www.toongod.com': ['www.toongod.cc', 'toongod.cc'],
  'toongod.com': ['www.toongod.cc', 'toongod.cc'],
};

export function buildMirrorCandidates(inputUrl: string) {
  let parsed: URL;
  try { parsed = new URL(inputUrl); } catch { return [inputUrl]; }
  const hosts = [parsed.host, ...(MIRROR_MAP[parsed.host] || [])];
  return [...new Set(hosts)].map((host) => {
    const candidate = new URL(parsed.href);
    candidate.host = host;
    candidate.protocol = 'https:';
    return candidate.href;
  });
}

function browserHeaders(url: string, extra: Record<string,string> = {}) {
  let origin = 'https://www.google.com';
  try { origin = new URL(url).origin; } catch {}
  return {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    'Upgrade-Insecure-Requests': '1',
    Referer: `${origin}/`,
    ...extra,
  };
}

export async function fetchPage(inputUrl: string, options: { method?: string; body?: any; timeout?: number; headers?: Record<string,string> } = {}) {
  await assertSafeRemoteUrl(inputUrl);
  const candidates = buildMirrorCandidates(inputUrl);
  const errors: string[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const url = candidates[index];
    try {
      await assertSafeRemoteUrl(url);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeout || 28000);
      const response = await fetch(url, {
        method: options.method || 'GET',
        body: options.body,
        headers: browserHeaders(url, options.headers || {}),
        redirect: 'follow',
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const html = await response.text();
      if (isCloudflareChallenge(html, response.status)) {
        errors.push(`${new URL(url).host}: anti-bot challenge`);
        continue;
      }
      if (response.status >= 400) {
        errors.push(`${new URL(url).host}: HTTP ${response.status}`);
        continue;
      }
      if (html.length < 200) {
        errors.push(`${new URL(url).host}: empty response`);
        continue;
      }
      return { html, finalUrl: response.url || url, statusCode: response.status, usedMirror: index > 0, originalUrl: inputUrl };
    } catch (error: any) {
      errors.push(`${new URL(url).host}: ${error.message}`);
    }
  }
  const error = new Error(`The source blocked or rejected the request. ${errors.join(' · ')}`) as any;
  error.code = 'SOURCE_BLOCKED';
  throw error;
}

export async function fetchBinary(inputUrl: string, referer?: string) {
  await assertSafeRemoteUrl(inputUrl);
  let lastError: any;
  for (const candidate of buildMirrorCandidates(inputUrl)) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await assertSafeRemoteUrl(candidate);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 25000);
        const response = await fetch(candidate, {
          method: 'GET',
          headers: {
            'User-Agent': UA,
            Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            Referer: referer || new URL(candidate).origin + '/',
          },
          redirect: 'follow',
          signal: controller.signal,
        });
        clearTimeout(timeout);
        const contentType = String(response.headers.get('content-type') || 'application/octet-stream');
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        if (response.status >= 400) throw new Error(`HTTP ${response.status}`);
        if (contentType.includes('text/html')) throw new Error('Image host returned HTML');
        if (buffer.length < 800) throw new Error('Image response was empty or too small');
        return { buffer, contentType, finalUrl: response.url || candidate };
      } catch (error: any) {
        lastError = error;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 250 * attempt));
      }
    }
  }
  throw lastError || new Error('Failed to fetch image');
}

export function absoluteUrl(base: string, href?: string | null) {
  if (!href) return null;
  try { return new URL(href, base).href; } catch { return null; }
}
