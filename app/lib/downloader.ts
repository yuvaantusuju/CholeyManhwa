import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';

export type ArchiveFormat = 'pdf' | 'cbz' | 'zip';
export type Chapter = { name: string; url: string };
export type DownloadProgress = {
  phase: string;
  currentChapter: number;
  totalChapters: number;
  currentImage: number;
  totalImages: number;
  chapterName: string;
  percent: number;
  speedHint?: string;
  bytesPerSecond?: number;
  etaSeconds?: number;
};

type ImageFile = { blob: Blob; bytes: Uint8Array<ArrayBuffer>; ext: string; contentType: string };
type ChapterResult = { chapter: Chapter; success: boolean; images: ImageFile[]; error?: string };

const sanitize = (name: string) => name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'chapter';
const pad = (value: number, total: number) => String(value).padStart(Math.max(3, String(total).length), '0');

const CONCURRENCY = { IMAGE: 16, CHAPTER: 3 };

async function mapPool<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>, onDone?: (done: number, total: number) => void): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null);
  let next = 0;
  let done = 0;
  const run = async () => {
    while (next < items.length) {
      const index = next++;
      try { results[index] = await worker(items[index], index); } catch { results[index] = null; }
      done += 1;
      onDone?.(done, items.length);
    }
  };
  const workers = Math.min(concurrency, Math.max(1, items.length));
  await Promise.all(Array.from({ length: workers }, () => run()));
  return results;
}

function extension(contentType: string, url: string) {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  if (contentType.includes('avif')) return 'avif';
  const match = url.match(/\.(jpe?g|png|webp|gif|avif)(\?|$)/i);
  return match ? match[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
}

async function fetchChapterImages(chapterUrl: string, signal?: AbortSignal): Promise<string[]> {
  const response = await fetch(`/api/chapter?${new URLSearchParams({ url: chapterUrl })}`, { signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to load chapter panels.');
  if (!data.images?.length) throw new Error('No panel images found.');
  return data.images;
}

async function fetchImage(url: string, referer: string, signal?: AbortSignal): Promise<ImageFile> {
  const response = await fetch(`/api/proxy-image?${new URLSearchParams({ url, referer, original: '1' })}`, { signal });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Panel request failed (${response.status}).`);
  }
  const contentType = response.headers.get('content-type') || 'image/jpeg';
  const raw = new Uint8Array(await response.arrayBuffer());
  const bytes = new Uint8Array(new ArrayBuffer(raw.byteLength));
  bytes.set(raw);
  return { blob: new Blob([bytes], { type: contentType }), bytes, ext: extension(contentType, url), contentType };
}

function imageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => { resolve({ width: image.naturalWidth, height: image.naturalHeight }); URL.revokeObjectURL(url); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not decode panel.')); };
    image.src = url;
  });
}

async function convertToJpeg(blob: Blob, width: number, height: number): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable.');
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const jpeg = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Image conversion failed.')), 'image/jpeg', 0.9));
  return new Uint8Array(await jpeg.arrayBuffer());
}

async function createPdf(images: ImageFile[]) {
  const pdf = await PDFDocument.create();
  const dimCache = new Map<ImageFile, { width: number; height: number }>();
  for (const image of images) dimCache.set(image, await imageDimensions(image.blob));
  for (const image of images) {
    const dimensions = dimCache.get(image);
    if (!dimensions?.width || !dimensions?.height) continue;
    let embedded;
    if (image.contentType.includes('png')) embedded = await pdf.embedPng(image.bytes);
    else if (image.contentType.includes('jpeg') || image.contentType.includes('jpg')) embedded = await pdf.embedJpg(image.bytes);
    else embedded = await pdf.embedJpg(await convertToJpeg(image.blob, dimensions.width, dimensions.height));
    const page = pdf.addPage([dimensions.width, dimensions.height]);
    page.drawImage(embedded, { x: 0, y: 0, width: dimensions.width, height: dimensions.height });
  }
  if (!pdf.getPageCount()) throw new Error('No valid panels could be added to the PDF.');
  return pdf.save({ useObjectStreams: true });
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export async function downloadArchive({ title, chapters, format, onProgress, signal }: {
  title: string;
  chapters: Chapter[];
  format: ArchiveFormat;
  onProgress: (progress: DownloadProgress) => void;
  signal?: AbortSignal;
}) {
  const archive = new JSZip();
  const seriesName = sanitize(title);
  const totalChapters = chapters.length;
  let successfulChapters = 0;
  let totalPanels = 0;
  let totalBytes = 0;
  const runStart = performance.now();
  let etaTimer: number | undefined;
  let etaAnchor = runStart;
  let etaSnapshots: Array<{ t: number; bytes: number }> = [];

  const sendProgress = (extra: Partial<DownloadProgress>) => {
    const elapsed = Math.max(0.1, (performance.now() - runStart) / 1000);
    const bps = totalBytes / elapsed;
    etaSnapshots.push({ t: performance.now(), bytes: totalBytes });
    if (etaSnapshots.length > 12) etaSnapshots.shift();
    let etaSeconds: number | undefined;
    if (etaSnapshots.length >= 2) {
      const first = etaSnapshots[0];
      const last = etaSnapshots.at(-1)!;
      const window = Math.max(0.5, (last.t - first.t) / 1000);
      const rate = (last.bytes - first.bytes) / window;
      if (rate > 0) {
        const estimatedTotal = (totalBytes / Math.max(0.01, extra.percent || 1)) * 100;
        const remainingBytes = Math.max(0, estimatedTotal - totalBytes);
        etaSeconds = Math.round(remainingBytes / rate);
      }
    }
    onProgress({
      phase: 'Working…',
      currentChapter: 0,
      totalChapters,
      currentImage: 0,
      totalImages: 0,
      chapterName: '',
      percent: 0,
      speedHint: `${formatBytes(bps)}/s · ${totalPanels} panels`,
      bytesPerSecond: bps,
      etaSeconds,
      ...extra,
    });
  };

  if (typeof window !== 'undefined') {
    window.clearInterval(etaTimer);
    etaTimer = window.setInterval(() => {
      if (signal?.aborted) return;
      etaAnchor = performance.now();
      sendProgress({ phase: 'Active download', percent: Math.min(99, (totalBytes > 0 ? Math.min(95, (totalBytes / Math.max(1, totalBytes + 1)) * 100) : 0)) });
    }, 1000);
  }

  try {
    sendProgress({ phase: 'Scanning chapter pages…', currentChapter: 0, totalChapters, currentImage: 0, totalImages: 0, chapterName: '', percent: 0 });

    const chapterResults: ChapterResult[] = (await mapPool(chapters, CONCURRENCY.CHAPTER, async (chapter, index) => {
      if (signal?.aborted) throw new Error('Download cancelled.');
      const chapterNumber = index + 1;
      onProgress({ phase: 'Scanning panels…', currentChapter: chapterNumber, totalChapters, currentImage: 0, totalImages: 0, chapterName: chapter.name, percent: Math.round((chapterNumber / totalChapters) * 10) });
      const imageUrls = await fetchChapterImages(chapter.url, signal);
      const chapterStartBytes = totalBytes;
      const images = await mapPool(imageUrls, CONCURRENCY.IMAGE, (imageUrl) => fetchImage(imageUrl, chapter.url, signal), (done, total) => {
        const elapsed = Math.max(0.1, (performance.now() - chapterStartBytes / Math.max(1, (performance.now() - runStart) / 1000)) / 1000);
        const chapterPercent = Math.round((chapterNumber - 1 + done / Math.max(1, total)) / totalChapters * 90);
        onProgress({ phase: 'Downloading panels…', currentChapter: chapterNumber, totalChapters, currentImage: done, totalImages: total, chapterName: chapter.name, percent: chapterPercent });
      }) as ImageFile[] | null[];
      const validImages = images.filter((image): image is ImageFile => image !== null);
      if (!validImages.length) return { chapter, success: false, images: [] };
      return { chapter, success: true, images: validImages };
    }, (done, total) => {
      sendProgress({ phase: 'Chapter pages complete', currentChapter: done, totalChapters: total, currentImage: 0, totalImages: 0, chapterName: '', percent: Math.round((done / total) * 90) });
    })).filter((result): result is ChapterResult => result !== null);

    if (signal?.aborted) throw new Error('Download cancelled.');

    let validChapterCount = 0;
    for (let chapterIndex = 0; chapterIndex < chapterResults.length; chapterIndex += 1) {
      const result = chapterResults[chapterIndex];
      if (!result?.success || !result.images.length) throw new Error('No panels were downloaded. Please try again.');
      const allImages = result.images;
      totalPanels += allImages.length;
      totalBytes += allImages.reduce((sum, image) => sum + image.bytes.byteLength, 0);
      validChapterCount += 1;
      const folderName = sanitize(result.chapter.name);

      if (format === 'pdf') {
        sendProgress({ phase: 'Building PDF…', currentChapter: chapterIndex + 1, totalChapters, currentImage: allImages.length, totalImages: allImages.length, chapterName: result.chapter.name, percent: 92 + Math.round((chapterIndex + 1) / totalChapters * 6) });
        const pdfBytes = await createPdf(allImages);
        archive.file(`${seriesName} - ${folderName}.pdf`, pdfBytes, { compression: 'STORE' });
      } else {
        const folder = totalChapters > 1 || format === 'zip' ? archive.folder(folderName) : archive;
        for (let imageIndex = 0; imageIndex < allImages.length; imageIndex += 1) {
          const image = allImages[imageIndex];
          folder?.file(`${pad(imageIndex + 1, allImages.length)}.${image.ext}`, image.blob, { compression: 'STORE' });
        }
      }
      successfulChapters += 1;
    }

    if (!validChapterCount) throw new Error('No chapters could be prepared.');

    sendProgress({ phase: 'Finalizing archive…', currentChapter: totalChapters, totalChapters, currentImage: totalPanels, totalImages: totalPanels, chapterName: '', percent: 98 });

    let output: Blob;
    let filename: string;
    if (format === 'pdf' && totalChapters === 1) {
      const onlyFile = Object.values(archive.files).find((file) => !file.dir);
      if (!onlyFile) throw new Error('PDF file was not created.');
      output = await onlyFile.async('blob');
      filename = onlyFile.name;
    } else {
      output = await archive.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true });
      filename = format === 'pdf' ? `${seriesName}-pdfs.zip` : `${seriesName}.${format}`;
    }

    saveBlob(output, filename);
    onProgress({ phase: 'Complete', currentChapter: totalChapters, totalChapters, currentImage: totalPanels, totalImages: totalPanels, chapterName: '', percent: 100, speedHint: `${successfulChapters} chapter${successfulChapters === 1 ? '' : 's'} · ${totalPanels} panels · ${formatBytes(totalBytes)} saved` });
  } finally {
    if (etaTimer) window.clearInterval(etaTimer);
  }
}
