import { NextResponse } from 'next/server';
import { assertSafeRemoteUrl, fetchBinary } from '../../lib/scraper';

const headersCommon = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };

export async function GET(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: headersCommon });
  try {
    const url = new URL(req.url);
    const imageUrl = String(url.searchParams.get('url') || '').trim();
    const referer = String(url.searchParams.get('referer') || '').trim();
    if (!imageUrl) return NextResponse.json({ error: 'Missing image URL.' }, { status: 400, headers: headersCommon });
    await assertSafeRemoteUrl(imageUrl);
    if (referer) await assertSafeRemoteUrl(referer);
    const { buffer, contentType } = await fetchBinary(imageUrl, referer || undefined);
    const resp = new Response(new Uint8Array(buffer), { status: 200, headers: { ...headersCommon, 'Content-Type': contentType || 'image/jpeg', 'Cache-Control': 'public, max-age=86400, immutable', 'Content-Length': String(buffer.length), 'X-Content-Type-Options': 'nosniff', 'Access-Control-Expose-Headers': 'Content-Type, Content-Length' } });
    return resp;
  } catch (error: any) {
    console.error('Image proxy error:', error);
    const blocked = /403|blocked|html|private network/i.test(error.message || '');
    return NextResponse.json({ error: error.message || 'Failed to fetch image.', code: blocked ? 'SOURCE_BLOCKED' : 'PROXY_ERROR' }, { status: blocked ? 403 : 500, headers: headersCommon });
  }
}
