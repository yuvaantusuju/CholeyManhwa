import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';

export type ArchiveFormat = 'pdf' | 'cbz' | 'zip' | 'kindle-pdf';
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

// -------- Kindle device presets (device screen resolution in px) --------
export const KINDLE_PRESETS = {
  'paperwhite-11': { width: 1236, height: 1648, label: 'Kindle Paperwhite (11th gen)' },
  'oasis': { width: 1264, height: 1680, label: 'Kindle Oasis' },
  'scribe': { width: 1860, height: 2480, label: 'Kindle Scribe' },
  'basic': { width: 1072, height: 1448, label: 'Kindle Basic / Kids' },
} as const;
export type KindlePreset = keyof typeof KINDLE_PRESETS;

export type KindlePdfOptions = {
  preset?: KindlePreset;
  width?: number;        // overrides preset if provided
  height?: number;       // overrides preset if provided
  grayscale?: boolean;    // default true, smaller files + matches e-ink
  rightToLeft?: boolean;  // manga reading order when splitting spreads, default true
};

const sanitize = (name: string) => name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'chapter';
const pad = (value: number, total: number) => String(value).padStart(Math.max(3, String(total).length), '0');

const CONCURRENCY = { IMAGE: 16, CHAPTER: 3 };

async function mapPool<T, R>(
  items: T[], 
  concurrency: number, 
  worker: (item: T, index: number) => Promise<R>, 
  onDone?: (done: number, total: number) => void
): Promise<(R | null)[]> {
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

// ---------------------------------------------------------------------------
// Kindle-optimized PDF generation & Image Normalization
// ---------------------------------------------------------------------------

/**
 * Normalizes image formats like WebP or AVIF into standard browser-supported 2D Canvas PNG blobs
 * to prevent createImageBitmap decoding errors during slicing and resizing.
 */
async function ensureDecodableImage(image: ImageFile): Promise<ImageFile> {
  if (image.contentType.includes('jpeg') || image.contentType.includes('jpg') || image.contentType.includes('png')) {
    return image;
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(image.blob);
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        URL.revokeObjectURL(url);
        return reject(new Error('Canvas context unavailable for image normalization.'));
      }

      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);

      canvas.toBlob(async (blob) => {
        if (!blob) return reject(new Error('Failed to normalize image format.'));
        const bytes = new Uint8Array(await blob.arrayBuffer());
        resolve({
          blob,
          bytes,
          ext: 'png',
          contentType: 'image/png',
        });
      }, 'image/png');
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The source image could not be decoded.'));
    };

    img.src = url;
  });
}

/**
 * Handles Webtoon / Manhwa long vertical strips by slicing them 
 * vertically according to the target screen aspect ratio.
 */
async function splitVerticalStripIfNeeded(image: ImageFile, targetWidth: number, targetHeight: number): Promise<ImageFile[]> {
  const { width, height } = await imageDimensions(image.blob);
  const targetRatio = targetHeight / targetWidth;
  
  // If height isn't significantly longer than standard aspect ratio, return as is
  if (height <= width * targetRatio * 1.2) {
    return [image];
  }

  const bitmap = await createImageBitmap(image.blob);
  const sliceHeight = Math.round(width * targetRatio);
  const totalSlices = Math.ceil(height / sliceHeight);
  const slices: ImageFile[] = [];

  for (let i = 0; i < totalSlices; i++) {
    const sy = i * sliceHeight;
    const currentSliceHeight = Math.min(sliceHeight, height - sy);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = currentSliceHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context unavailable.');

    ctx.drawImage(bitmap, 0, sy, width, currentSliceHeight, 0, 0, width, currentSliceHeight);

    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((val) => (val ? resolve(val) : reject(new Error('Slice failed.'))), 'image/png')
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    slices.push({ blob, bytes, ext: 'png', contentType: 'image/png' });
  }

  bitmap.close();
  return slices;
}

/**
 * Splits a wide "double-page spread" image into two separate images
 * (right half, then left half, for manga reading order — or left-then-right
 * if rightToLeft is false).
 */
async function splitSpreadIfNeeded(image: ImageFile, rightToLeft: boolean): Promise<ImageFile[]> {
  const { width, height } = await imageDimensions(image.blob);
  if (width <= height) return [image];

  const bitmap = await createImageBitmap(image.blob);
  const halfWidth = Math.round(width / 2);

  const cropHalf = async (sx: number): Promise<ImageFile> => {
    const canvas = document.createElement('canvas');
    canvas.width = halfWidth;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is unavailable.');
    ctx.drawImage(bitmap, sx, 0, halfWidth, height, 0, 0, halfWidth, height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('Spread split failed.'))), 'image/png')
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return { blob, bytes, ext: 'png', contentType: 'image/png' };
  };

  const leftHalf = await cropHalf(0);
  const rightHalf = await cropHalf(halfWidth);
  bitmap.close();

  return rightToLeft ? [rightHalf, leftHalf] : [leftHalf, rightHalf];
}

/**
 * Fits an image into the target Kindle screen size (contain-fit, centered,
 * white background so nothing gets stretched or squished), with optional
 * grayscale conversion for smaller files on e-ink displays.
 */
async function fitToKindleScreen(image: ImageFile, targetWidth: number, targetHeight: number, grayscale: boolean): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(image.blob);
  const scale = Math.min(targetWidth / bitmap.width, targetHeight / bitmap.height);
  const drawWidth = Math.round(bitmap.width * scale);
  const drawHeight = Math.round(bitmap.height * scale);
  const offsetX = Math.round((targetWidth - drawWidth) / 2);
  const offsetY = Math.round((targetHeight - drawHeight) / 2);

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable.');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  ctx.drawImage(bitmap, offsetX, offsetY, drawWidth, drawHeight);
  bitmap.close();

  if (grayscale) {
    const imgData = ctx.getImageData(0, 0, targetWidth, targetHeight);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      data[i] = data[i + 1] = data[i + 2] = gray;
    }
    ctx.putImageData(imgData, 0, 0);
  }

  const jpeg = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('Kindle page render failed.'))), 'image/jpeg', 0.85)
  );
  return new Uint8Array(await jpeg.arrayBuffer());
}

async function createKindlePdf(images: ImageFile[], options: KindlePdfOptions = {}) {
  const preset = KINDLE_PRESETS[options.preset ?? 'paperwhite-11'];
  const targetWidth = options.width ?? preset.width;
  const targetHeight = options.height ?? preset.height;
  const grayscale = options.grayscale ?? true;
  const rightToLeft = options.rightToLeft ?? true;

  const pdf = await PDFDocument.create();

  for (const rawImage of images) {
    // 1. Convert non-standard images (WebP/AVIF) to decodable PNG blobs
    const image = await ensureDecodableImage(rawImage);

    // 2. Slice long manhwa/webtoon images vertically
    const verticalSlices = await splitVerticalStripIfNeeded(image, targetWidth, targetHeight);

    for (const slice of verticalSlices) {
      // 3. Split horizontal double spreads
      const parts = await splitSpreadIfNeeded(slice, rightToLeft);

      for (const part of parts) {
        const jpegBytes = await fitToKindleScreen(part, targetWidth, targetHeight, grayscale);
        const embedded = await pdf.embedJpg(jpegBytes);
        const page = pdf.addPage([targetWidth, targetHeight]);
        page.drawImage(embedded, { x: 0, y: 0, width: targetWidth, height: targetHeight });
      }
    }
  }

  if (!pdf.getPageCount()) throw new Error('No valid panels could be added to the Kindle PDF.');
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

export async function downloadArchive({ title, chapters, format, kindleOptions, onProgress, signal }: {
  title: string;
  chapters: Chapter[];
  format: ArchiveFormat;
  kindleOptions?: KindlePdfOptions;
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
      const images = await mapPool(imageUrls, CONCURRENCY.IMAGE, (imageUrl) => fetchImage(imageUrl, chapter.url, signal), (done, total) => {
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
      } else if (format === 'kindle-pdf') {
        sendProgress({ phase: 'Building Kindle PDF…', currentChapter: chapterIndex + 1, totalChapters, currentImage: allImages.length, totalImages: allImages.length, chapterName: result.chapter.name, percent: 92 + Math.round((chapterIndex + 1) / totalChapters * 6) });
        const pdfBytes = await createKindlePdf(allImages, kindleOptions);
        archive.file(`${seriesName} - ${folderName} (Kindle).pdf`, pdfBytes, { compression: 'STORE' });
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
    if ((format === 'pdf' || format === 'kindle-pdf') && totalChapters === 1) {
      const onlyFile = Object.values(archive.files).find((file) => !file.dir);
      if (!onlyFile) throw new Error('PDF file was not created.');
      output = await onlyFile.async('blob');
      filename = onlyFile.name;
    } else {
      output = await archive.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true });
      const suffix = format === 'pdf' ? 'pdfs' : format === 'kindle-pdf' ? 'kindle-pdfs' : format;
      filename = format === 'pdf' || format === 'kindle-pdf' ? `${seriesName}-${suffix}.zip` : `${seriesName}.${format}`;
    }

    saveBlob(output, filename);
    onProgress({ phase: 'Complete', currentChapter: totalChapters, totalChapters, currentImage: totalPanels, totalImages: totalPanels, chapterName: '', percent: 100, speedHint: `${successfulChapters} chapter${successfulChapters === 1 ? '' : 's'} · ${totalPanels} panels · ${formatBytes(totalBytes)} saved` });
  } finally {
    if (etaTimer) window.clearInterval(etaTimer);
  }
}
