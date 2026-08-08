import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import { fetchPage, absoluteUrl } from '../../lib/scraper';

const BASE = 'https://www.toongod.cc';

function setCorsHeaders() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
}

function cleanText(value: any) { return String(value || '').replace(/\s+/g, ' ').trim(); }

function parseSearchResults(html: string, pageUrl?: string) {
  const $ = cheerio.load(html);
  const results: any[] = [];
  const seen = new Set<string>();

  const push = ({ title, url, cover, latestChapter }: any) => {
    if (!title || !url) return;
    let full = absoluteUrl(pageUrl || BASE, url);
    if (!full) return;
    try {
      const parsed = new URL(full);
      if (parsed.hostname.includes('toongod')) {
        parsed.protocol = 'https:';
        parsed.hostname = 'www.toongod.cc';
        full = parsed.href;
      }
    } catch {}
    if (!/\/(webtoon|manga)\/[^/]+\/?$/i.test(full.replace(/\?.*$/, ''))) return;
    const key = full.replace(/\/$/, '').toLowerCase();
    const cleanedTitle = cleanText(title);
    if (!cleanedTitle || seen.has(key)) return;
    seen.add(key);
    results.push({ title: cleanedTitle, url: full.endsWith('/') ? full : `${full}/`, cover: cover || null, latestChapter: latestChapter ? cleanText(latestChapter) : null });
  };

  $('.latest-list .latest-item, .latest-item').each((_, element) => {
    const item = $(element);
    const link = item.find('.mm-name a').first().attr('href') || item.find('.latest-left a').first().attr('href') || item.find('a[href*="/webtoon/"], a[href*="/manga/"]').first().attr('href');
    const title = item.find('.mm-name a').attr('title') || item.find('h4.title-smaller, h3, h4').first().text() || item.find('.latest-left a').attr('title') || item.find('a[href*="/webtoon/"], a[href*="/manga/"]').first().attr('title') || item.find('a[href*="/webtoon/"], a[href*="/manga/"]').first().text();
    const image = item.find('img.img-latest, img').first();
    const coverRaw = image.attr('data-src') || image.attr('data-lazy-src') || image.attr('data-original') || image.attr('src');
    const chapterAnchor = item.find('ul li a, .chapter a, .latest-chap a').first();
    let latestChapter = chapterAnchor.attr('title') || chapterAnchor.text();
    if (latestChapter?.includes(' - ')) latestChapter = latestChapter.split(' - ').slice(1).join(' - ');
    push({ title, url: link, cover: coverRaw ? absoluteUrl(pageUrl || BASE, coverRaw) : null, latestChapter });
  });

  if (!results.length) {
    $('.c-tabs-item__content, .row.c-tabs-item__content, .tab-content-wrap .row, .page-item-detail').each((_, element) => {
      const item = $(element);
      const anchor = item.find('.post-title a, .entry-title a, h3 a, h4 a, a').filter((_, node) => /\/(webtoon|manga)\/[^/]+\/?$/i.test($(node).attr('href') || '')).first();
      const image = item.find('img').first();
      const coverRaw = image.attr('data-src') || image.attr('data-lazy-src') || image.attr('data-original') || image.attr('src');
      push({ title: anchor.attr('title') || anchor.text(), url: anchor.attr('href'), cover: coverRaw ? absoluteUrl(pageUrl || BASE, coverRaw) : null, latestChapter: item.find('.latest-chap .chapter a, .latest-chap a, .chapter a').first().text() || null });
    });
  }

  if (!results.length) {
    $('a[href*="/webtoon/"], a[href*="/manga/"]').each((_, element) => {
      const anchor = $(element);
      const href = anchor.attr('href') || '';
      if (!/\/(webtoon|manga)\/[^/]+\/?$/i.test(href)) return;
      const parent = anchor.closest('.latest-item, .item, li, article, .row, div');
      const image = parent.find('img').first().length ? parent.find('img').first() : anchor.find('img').first();
      const coverRaw = image.attr('data-src') || image.attr('data-lazy-src') || image.attr('src');
      push({ title: anchor.attr('title') || anchor.text(), url: href, cover: coverRaw ? absoluteUrl(pageUrl || BASE, coverRaw) : null, latestChapter: null });
    });
  }

  return results.slice(0, 20);
}

export async function GET(req: Request) {
  const headers = setCorsHeaders();
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  const url = new URL(req.url);
  const query = String(url.searchParams.get('q') || '').trim();
  if (query.length < 2) return NextResponse.json({ success: false, query, results: [], error: 'Enter at least 2 characters.' }, { status: 400, headers });

  try {
    let page: any;
    try {
      page = await fetchPage(`${BASE}/search/?s=${encodeURIComponent(query)}`, { timeout: 28000 });
    } catch {
      page = await fetchPage(`${BASE}/?s=${encodeURIComponent(query)}&post_type=wp-manga`, { timeout: 28000 });
    }
    const results = parseSearchResults(page.html, page.finalUrl || BASE);
    return NextResponse.json({ success: true, query, count: results.length, results, source: 'toongod.cc' }, { headers });
  } catch (error: any) {
    console.error('Search API error:', error);
    return NextResponse.json({ success: false, query, results: [], error: error.code === 'SOURCE_BLOCKED' ? 'ToonGod search is temporarily blocked. You can still paste a direct ToonGod series URL.' : error.message || 'Search failed.' }, { status: error.code === 'SOURCE_BLOCKED' ? 502 : 500, headers });
  }
}
