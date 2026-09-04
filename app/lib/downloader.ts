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

export const KINDLE_PRESETS = {
  'paperwhite-11': { width: 1236, height: 1648, label: 'Kindle Paperwhite (11th gen)' },
  oasis: { width: 1264, height: 1680, label: 'Kindle Oasis' },
  scribe: { width: 1860, height: 2480, label: 'Kindle Scribe' },
  basic: { width: 1072, height: 1448, label: 'Kindle Basic / Kids' },
} as const;
export type KindlePreset = keyof typeof KINDLE_PRESETS;

export type KindlePdfOptions = {
  preset?: KindlePreset;
  width?: number;
  height?: number;
  grayscale?: boolean;
  rightToLeft?: boolean;
};

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

type KindlePagePart = {
  image: ImageFile;
  sourceY: number;
  sourceHeight: number;
};

async function splitImageForKindle(
  image: ImageFile,
  targetWidth: number,
  targetHeight: number,
): Promise<KindlePagePart[]> {
  const { width, height } = await imageDimensions(image.blob);
  if (!width || !height) return [];

  /*
   * IMPORTANT:
   * Do not resize an entire long manga/manhwa page into one Kindle page.
   *
   * Example:
   *   source = 1440 x 10000
   *   Kindle  = 1236 x 1648
   *
   * The old code squeezed 10000px of content into 1648px.
   * Instead, we keep the source width and divide the long image vertically
   * into several Kindle-shaped pages.
   */

  const targetRatio = targetWidth / targetHeight;
  const sourcePageHeight = Math.floor(width / targetRatio);

  // Wide image / two-page spread:
  // split it horizontally first so it is not squeezed into a portrait page.
  if (width / height > 1.15) {
    const halfWidth = Math.floor(width / 2);
    const parts: KindlePagePart[] = [];

    for (const sourceX of [0, halfWidth]) {
      const partBlob = await cropImage(
        image.blob,
        sourceX,
        0,
        sourceX === 0 ? halfWidth : width - halfWidth,
        height,
      );

      const part: ImageFile = {
        blob: partBlob,
        bytes: new Uint8Array(await partBlob.arrayBuffer()),
        ext: "png",
        contentType: "image/png",
      };

      const subParts = await splitImageForKindle(
        part,
        targetWidth,
        targetHeight,
      );

      parts.push(...subParts);
    }

    // Manga normally reads right-to-left.
    return parts.reverse();
  }

  // Normal portrait page that already fits reasonably well.
  if (height <= sourcePageHeight * 1.08) {
    return [{ image, sourceY: 0, sourceHeight: height }];
  }

  const parts: KindlePagePart[] = [];
  let sourceY = 0;

  while (sourceY < height) {
    const remaining = height - sourceY;
    const chunkHeight = Math.min(sourcePageHeight, remaining);

    const chunkBlob = await cropImage(
      image.blob,
      0,
      sourceY,
      width,
      chunkHeight,
    );

    const chunk: ImageFile = {
      blob: chunkBlob,
      bytes: new Uint8Array(await chunkBlob.arrayBuffer()),
      ext: "png",
      contentType: "image/png",
    };

    parts.push({
      image: chunk,
      sourceY: 0,
      sourceHeight: chunkHeight,
    });

    sourceY += chunkHeight;
  }

  return parts;
}

async function cropImage(
  blob: Blob,
  sourceX: number,
  sourceY: number,
  sourceWidth: number,
  sourceHeight: number,
): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth));
  canvas.height = Math.max(1, Math.round(sourceHeight));

  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Canvas is unavailable.");
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  context.drawImage(
    bitmap,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  bitmap.close();

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) =>
        value
          ? resolve(value)
          : reject(new Error("Image crop failed.")),
      "image/png",
    );
  });
}

async function renderKindlePage(
  image: ImageFile,
  targetWidth: number,
  targetHeight: number,
  grayscale: boolean,
) {
  const bitmap = await createImageBitmap(image.blob);

  const scale = Math.min(
    targetWidth / bitmap.width,
    targetHeight / bitmap.height,
  );

  const drawWidth = Math.max(1, Math.round(bitmap.width * scale));
  const drawHeight = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Canvas is unavailable.");
  }

  // White Kindle page background.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, targetWidth, targetHeight);

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  // Center without stretching.
  context.drawImage(
    bitmap,
    Math.round((targetWidth - drawWidth) / 2),
    Math.round((targetHeight - drawHeight) / 2),
    drawWidth,
    drawHeight,
  );

  bitmap.close();

  if (grayscale) {
    const imageData = context.getImageData(
      0,
      0,
      targetWidth,
      targetHeight,
    );

    for (let index = 0; index < imageData.data.length; index += 4) {
      const gray =
        0.299 * imageData.data[index] +
        0.587 * imageData.data[index + 1] +
        0.114 * imageData.data[index + 2];

      imageData.data[index] = gray;
      imageData.data[index + 1] = gray;
      imageData.data[index + 2] = gray;
    }

    context.putImageData(imageData, 0, 0);
  }

  const jpeg = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value
          ? resolve(value)
          : reject(new Error("Kindle page render failed.")),
      "image/jpeg",
      0.90,
    ),
  );

  return new Uint8Array(await jpeg.arrayBuffer());
}

async function createKindlePdf(
  images: ImageFile[],
  options: KindlePdfOptions = {},
) {
  const preset = KINDLE_PRESETS[options.preset ?? "paperwhite-11"];

  /*
   * These are the pixel dimensions of the Kindle display preset.
   * The PDF page keeps exactly the same portrait aspect ratio.
   */
  const targetWidth = options.width ?? preset.width;
  const targetHeight = options.height ?? preset.height;

  const pdf = await PDFDocument.create();

  for (const image of images) {
    if (!image?.blob) continue;

    const parts = await splitImageForKindle(
      image,
      targetWidth,
      targetHeight,
    );

    // If the source is RTL manga, reverse the resulting page order.
    const orderedParts = options.rightToLeft
      ? parts.reverse()
      : parts;

    for (const part of orderedParts) {
      const jpegBytes = await renderKindlePage(
        part.image,
        targetWidth,
        targetHeight,
        options.grayscale ?? false,
      );

      const embedded = await pdf.embedJpg(jpegBytes);

      const page = pdf.addPage([targetWidth, targetHeight]);

      page.drawImage(embedded, {
        x: 0,
        y: 0,
        width: targetWidth,
        height: targetHeight,
      });
    }
  }

  if (!pdf.getPageCount()) {
    throw new Error("No valid panels could be added to the Kindle PDF.");
  }

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
