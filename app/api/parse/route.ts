import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import { absoluteUrl, assertSafeRemoteUrl, fetchPage } from '../../lib/scraper';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };

function extractTitle($: cheerio.CheerioAPI) {
  const selectors = ['h1.post-title', 'div.post-title h1', 'h1.entry-title', '.post-title h1', '.manga-title', 'h1', 'meta[property="og:title"]', 'title'];
  for (const selector of selectors) {
    const element = $(selector).first();
    if (!element.length) continue;
    let text = selector.startsWith('meta') ? element.attr('content') : element.text();
    text = String(text || '').replace(/\s+/g, ' ').trim();
    if (text) return text.replace(/\s*[-–|]\s*(ToonGod(?:\.\w+)?|Read.*|Manhua|Manhwa|Manga).*$/i, '').replace(/^Read\s+/i, '').replace(/\s*\[Latest Chapters\]\s*/i, '').trim();
  }
  return 'Unknown Title';
}

function extractCover($: cheerio.CheerioAPI, baseUrl: string) {
  const selectors = ['meta[property="og:image"]', '.summary_image img', '.tab-summary img', '.manga-thumb img', '.thumb img', '.post-thumb img', 'img.wp-post-image', '.series-cover img'];
  for (const selector of selectors) {
    const element = $(selector).first();
    if (!element.length) continue;
    const source = element.attr('content') || element.attr('data-src') || element.attr('data-lazy-src') || element.attr('src');
    const url = absoluteUrl(baseUrl, source);
    if (url && !url.includes('data:image')) return url;
  }
  return null;
}

function cleanChapterName(raw: any) {
  return String(raw || '').replace(/\s+/g, ' ').trim().replace(/\s+(\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{2,4})$/i, '').replace(/\s+\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/, '').replace(/\s*new\s*$/i, '').trim();
}

function extractChapters($: cheerio.CheerioAPI, baseUrl: string) {
  const seen = new Set<string>();
  const chapters: { name: string; url: string }[] = [];
  const push = (name: any, href: any) => {
    const url = absoluteUrl(baseUrl, href);
    if (!url || seen.has(url)) return;
    const lower = url.toLowerCase();
    if (lower.includes('/genre') || lower.includes('/tag') || lower.includes('/author') || lower.includes('/login') || lower.includes('/wp-') || lower.includes('/page/')) return;
    let cleanedName = cleanChapterName(name);
    if (!cleanedName || cleanedName.length < 2) return;
    cleanedName = cleanedName.slice(0, 120);
    if (!/chapter|ch\.?\s*\d|ep\.?\s*\d|episode|chap\b|\d+/i.test(`${cleanedName} ${url}`)) return;
    seen.add(url);
    chapters.push({ name: cleanedName, url });
  };
  const selectors = ['li.wp-manga-chapter a', '.wp-manga-chapter a', '.version-chap li a', '.listing-chapters_wrap a', '.chapter-list a', '#chapterlist a', '.eplister a', '.chapters a', 'ul.main li a', '.manga-chapters a', '.page-content-listing a', 'a[href*="/chapter"]', 'a[href*="-chapter-"]'];
  for (const selector of selectors) {
    $(selector).each((_, element) => {
      const anchor = $(element);
      const name = anchor.find('.chapter-name, .chapternum, span').first().text().trim() || anchor.text();
      push(name, anchor.attr('href'));
    });
    if (chapters.length) break;
  }
  return chapters;
}

async function tryAjaxChapters(seriesUrl: string) {
  try {
    const ajaxUrl = `${seriesUrl.replace(/\/?$/, '/')}ajax/chapters/`;
    const { html, finalUrl } = await fetchPage(ajaxUrl, { method: 'POST', body: '', timeout: 20000, headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Origin: new URL(seriesUrl).origin, Referer: seriesUrl } });
    return extractChapters(cheerio.load(html), finalUrl || seriesUrl);
  } catch { return []; }
}

export async function GET(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const q = String(url.searchParams.get('url') || '').trim();
    if (!q) return NextResponse.json({ error: 'Paste a series URL first.' }, { status: 400, headers: corsHeaders });
    await assertSafeRemoteUrl(q);
    const page = await fetchPage(q);
    const $ = cheerio.load(page.html);
    const title = extractTitle($);
    const cover = extractCover($, page.finalUrl);
    let chapters = extractChapters($, page.finalUrl);
    if (!chapters.length) chapters = await tryAjaxChapters(page.finalUrl);
    if (!chapters.length) return NextResponse.json({ error: 'No chapters were found. Paste a full series page URL rather than a homepage or single image.', title, cover, chapters: [] }, { status: 422, headers: corsHeaders });
    return NextResponse.json({ title, cover, sourceUrl: page.finalUrl, originalUrl: q, usedMirror: page.usedMirror, chapterCount: chapters.length, chapters, notice: page.usedMirror ? `The primary host was blocked, so Choley used ${new URL(page.finalUrl).host}.` : undefined }, { headers: corsHeaders });
  } catch (error: any) {
    console.error('Parse API error:', error);
    const blocked = error.code === 'SOURCE_BLOCKED';
    return NextResponse.json({ error: error.message || 'Failed to parse this series.', code: blocked ? 'SOURCE_BLOCKED' : 'PARSE_ERROR' }, { status: blocked ? 403 : 500, headers: corsHeaders });
  }
}
