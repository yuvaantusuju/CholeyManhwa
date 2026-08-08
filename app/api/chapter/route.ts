export const runtime = 'edge';
import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import { assertSafeRemoteUrl, fetchPage } from '../../lib/scraper';

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };

function looksLikeImageUrl(url?: string | null) {
  if (!url || url.startsWith('data:')) return false;
  const lower = url.toLowerCase();
  if (['logo', 'avatar', 'icon', 'favicon', 'spinner', 'loading', '/ads', 'advert', 'pixel', '1x1', 'blank.gif', 'placeholder', 'gravatar', 'emoji'].some((term) => lower.includes(term))) return false;
  return /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(lower) || ['/wp-content/uploads', '/comics/', '/chapters/', '/manga/', 'cdn', 'chapter'].some((term) => lower.includes(term));
}

function bestFromSrcset(srcset?: string | null) {
  if (!srcset) return null;
  let best: string | null = null;
  let width = -1;
  for (const item of srcset.split(',')) {
    const bits = item.trim().split(/\s+/);
    const match = (bits[1] || '').match(/(\d+)w/);
    const candidateWidth = match ? Number(match[1]) : 0;
    if (bits[0] && candidateWidth >= width) { best = bits[0]; width = candidateWidth; }
  }
  return best;
}

function upgradeImageUrl(raw: string) {
  try {
    const url = new URL(raw);
    url.pathname = url.pathname.replace(/-\d{2,4}x\d{2,4}(?=\.[a-z]+$)/i, '');
    ['w', 'h', 'width', 'height', 'resize', 'fit', 'quality', 'q'].forEach((key) => url.searchParams.delete(key));
    return url.href;
  } catch { return raw; }
}

function extractImages($: cheerio.CheerioAPI, baseUrl: string) {
  const seen = new Set<string>();
  const images: string[] = [];
  const push = (raw?: string | null) => {
    const cleaned = String(raw || '').trim().replace(/[\r\n\t]+/g, '');
    if (!cleaned || cleaned.startsWith('data:')) return;
    const absolute = (baseUrl && new URL(cleaned, baseUrl).href) || null;
    if (!absolute || !looksLikeImageUrl(absolute)) return;
    const upgraded = upgradeImageUrl(absolute);
    if (!seen.has(upgraded)) { seen.add(upgraded); images.push(upgraded); }
  };
  const containers = ['.reading-content', '.read-container', '#readerarea', '.reader-area', '.chapter-content', '.page-break', '#chapter-content', '.entry-content .page-break', '.entry-content', '.manga-reader', '#images', '.comic-view', '.chapter-images'];
  let scope: cheerio.Cheerio<any> | null = null;
  for (const selector of containers) {
    const element = $(selector);
    if (element.length && element.find('img').length) { scope = element; break; }
  }
  if (!scope) scope = $.root();
  scope.find('img').each((_, element) => {
    const image = $(element);
    const candidates = [image.attr('data-large_image'), image.attr('data-full-url'), image.attr('data-original'), image.attr('data-src'), image.attr('data-lazy-src'), image.attr('data-url'), image.attr('data-cdn'), bestFromSrcset(image.attr('data-srcset')) || bestFromSrcset(image.attr('srcset')), image.attr('src')];
    const candidate = candidates.find((v) => v && !String(v).startsWith('data:'));
    if (candidate) push(candidate as string);
  });
  if (images.length < 2) {
    const scripts = $('script').map((_, el) => $(el).html() || '').get().join('\n');
    const patterns = [/https?:\/\/[^"'\s>]+\.(?:jpe?g|png|webp)/gi, /["'](\/[^"']+\/chapters\/[^"']+\.(?:jpe?g|png|webp))["']/gi];
    for (const expr of patterns) {
      let match: RegExpExecArray | null;
      while ((match = expr.exec(scripts)) !== null) push(match[1] || match[0]);
    }
  }
  return images;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'GET') return NextResponse.json({ error: 'Method not allowed' }, { status: 405, headers });
  try {
    const chapterUrl = String(url.searchParams.get('url') || '').trim();
    if (!chapterUrl) return NextResponse.json({ error: 'Missing chapter URL.' }, { status: 400, headers });
    await assertSafeRemoteUrl(chapterUrl);
    const page = await fetchPage(chapterUrl);
    const images = extractImages(cheerio.load(page.html), page.finalUrl);
    if (!images.length) return NextResponse.json({ error: 'No panel images were found on this chapter page.', images: [] }, { status: 422, headers });
    return NextResponse.json({ chapterUrl: page.finalUrl, originalUrl: chapterUrl, usedMirror: page.usedMirror, imageCount: images.length, images }, { headers });
  } catch (error: any) {
    console.error('Chapter API error:', error);
    return NextResponse.json({ error: error.message || 'Failed to parse chapter.' }, { status: error.code === 'SOURCE_BLOCKED' ? 403 : 500, headers });
  }
}
