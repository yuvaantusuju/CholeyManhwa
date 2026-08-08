"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  Download,
  FileArchive,
  LoaderCircle,
  MousePointer2,
  ShieldCheck,
} from "lucide-react";
import {
  downloadArchive,
  type ArchiveFormat,
  type Chapter,
  type DownloadProgress,
} from "../lib/downloader";
import SeriesSearch, { type SearchResult } from "./SeriesSearch";
import type { DownloadFormat as DF } from "../content/static";

type SeriesData = {
  title: string;
  cover: string | null;
  sourceUrl: string;
  originalUrl?: string;
  usedMirror?: boolean;
  notice?: string;
  chapterCount: number;
  chapters: Chapter[];
};

type FlowState = "idle" | "analyzing" | "configuring" | "building" | "complete";

export function DownloaderCard({ formats }: { formats: DF[] }) {
  const [url, setUrl] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [series, setSeries] = useState<SeriesData | null>(null);
  const [flow, setFlow] = useState<FlowState>("idle");
  const [chapterStart, setChapterStart] = useState(1);
  const [chapterEnd, setChapterEnd] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedFormat, setSelectedFormat] = useState<ArchiveFormat>("pdf");
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState("");
  const [rangeApplied, setRangeApplied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const recommended = formats.find((f) => f.recommended);
    if (recommended && flow === "idle") {
      setSelectedFormat(recommended.name.toLowerCase() as ArchiveFormat);
    }
  }, [formats, flow]);

  const selectedChapters = useMemo(
    () => series?.chapters.filter((c) => selected.has(c.url)) || [],
    [series, selected]
  );

  const getChapterNumber = (name: string, index: number) => {
    const match = name.match(/(?:chapter|chap|ch\.?|episode|ep\.?)[\s:\-]*([0-9]+(?:\.[0-9]+)?)/i);
    if (match && match[1]) return match[1];
    return String(index + 1);
  };

  const loadSeries = async (rawUrl: string) => {
    setError("");
    try {
      const parsed = new URL(rawUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
    } catch {
      setError("Select a ToonGod search result or paste a complete series link.");
      return;
    }
    setUrl(rawUrl);
    setSearchInput(rawUrl);
    setFlow("analyzing");
    try {
      const response = await fetch(`/api/parse?${new URLSearchParams({ url: rawUrl })}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "We could not parse that series page.");
      const initialEnd = Math.min(3, data.chapters.length);
      setSeries(data);
      setSearchInput(data.title);
      setChapterStart(1);
      setChapterEnd(initialEnd);
      setSelected(new Set(data.chapters.slice(0, initialEnd).map((c: Chapter) => c.url)));
      setFlow("configuring");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "We could not parse that series page.");
      setFlow("idle");
    }
  };

  const analyze = (event: FormEvent) => {
    event.preventDefault();
    void loadSeries(url || searchInput);
  };

  const chooseSearchResult = (result: SearchResult) => {
    setUrl(result.url);
    setSearchInput(result.title);
    void loadSeries(result.url);
  };

  const applyRange = () => {
    if (!series) return;
    let from = Number.isFinite(chapterStart) ? Math.floor(chapterStart) : 1;
    let to = Number.isFinite(chapterEnd) ? Math.floor(chapterEnd) : series.chapters.length;
    if (from < 1) from = 1;
    if (to < 1) to = 1;
    if (from > series.chapters.length) from = series.chapters.length;
    if (to > series.chapters.length) to = series.chapters.length;
    if (to < from) to = from;
    const selectedRange = new Set(series.chapters.slice(from - 1, to).map((c) => c.url));
    setChapterStart(from);
    setChapterEnd(to);
    setSelected(selectedRange);
    setRangeApplied(true);
  };

  const toggleChapter = (chapterUrl: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(chapterUrl)) next.delete(chapterUrl);
      else next.add(chapterUrl);
      return next;
    });
  };

  const build = async () => {
    if (!series) return;
    if (!selectedChapters.length) {
      setError("Select at least one chapter to download.");
      return;
    }
    if (
      selectedFormat === "pdf" &&
      selectedChapters.length > 15 &&
      !window.confirm("Generating more than 15 high-quality PDFs can use significant memory. Continue?")
    ) {
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setError("");
    setProgress({
      phase: "Starting…",
      currentChapter: 0,
      totalChapters: selectedChapters.length,
      currentImage: 0,
      totalImages: 0,
      chapterName: "",
      percent: 0,
    });
    setFlow("building");
    try {
      await downloadArchive({
        title: series.title,
        chapters: selectedChapters,
        format: selectedFormat,
        signal: controller.signal,
        onProgress: setProgress,
      });
      setFlow("complete");
    } catch (buildError) {
      const message = buildError instanceof Error ? buildError.message : "The download could not be completed.";
      setError(message);
      setFlow("configuring");
    } finally {
      abortRef.current = null;
    }
  };

  const reset = () => {
    abortRef.current?.abort();
    setUrl("");
    setSearchInput("");
    setSeries(null);
    setSelected(new Set());
    setProgress(null);
    setError("");
    setFlow("idle");
  };
  const cancel = () => {
    abortRef.current?.abort();
    setError("Download cancelled.");
    setFlow("configuring");
  };
  const proxyCover = series?.cover
    ? `/api/proxy-image?${new URLSearchParams({ url: series.cover, referer: series.sourceUrl })}`
    : "";

  return (
    <section className="downloader-card" id="downloader" aria-labelledby="downloader-title">
      <div className="card-topline">
        <div>
          <span className="eyebrow">SEARCH + DOWNLOADER</span>
          <h2 id="downloader-title">Find your next series</h2>
        </div>
        <span className="private-badge">
          <ShieldCheck size={14} /> Real panel export
        </span>
      </div>

      {(flow === "idle" || flow === "analyzing") && (
        <>
          {flow === "analyzing" ? (
            <div className="search-loading-panel">
              <LoaderCircle className="spin" size={32} />
              <p>Loading series...</p>
            </div>
          ) : (
            <>
              <SeriesSearch
                value={searchInput}
                disabled={false}
                onValueChange={(value) => {
                  setSearchInput(value);
                  setUrl(value);
                  setError("");
                }}
                onSelect={chooseSearchResult}
                onSubmit={analyze}
              />
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <div className="privacy-strip">
                <div className="drop-icon">
                  <MousePointer2 size={20} />
                </div>
                <p>
                  <strong>Search by title.</strong> Choose a manga or manhwa result to load its
                  complete chapter list, or paste a direct series URL.
                </p>
              </div>
            </>
          )}
        </>
      )}

      {(flow === "configuring" || flow === "building" || flow === "complete") && series && (
        <div className="configure-panel">
          <div className="detected-row">
            {series.cover ? (
              <img className="series-cover" src={proxyCover} alt="" />
            ) : (
              <span className="detected-icon">
                <BookOpen size={18} />
              </span>
            )}
            <div className="detected-copy">
              <span>Source verified</span>
              <strong>{series.title}</strong>
              <small>
                {series.chapters.length} chapters found
                {series.usedMirror ? " · mirror active" : ""}
              </small>
            </div>
            {flow !== "building" && (
              <button type="button" className="text-button" onClick={reset}>
                Change
              </button>
            )}
          </div>

          {series.notice && flow === "configuring" && (
            <p className="backend-notice">{series.notice}</p>
          )}

          {flow === "building" ? (
            <div className="building-state" aria-live="polite">
              <div className="building-orbit">
                <FileArchive size={30} />
                <span />
              </div>
              <span className="eyebrow">DOWNLOADING REAL PANELS</span>
              <h3>{progress?.phase || "Preparing archive…"}</h3>
              <p>
                {progress?.chapterName ? `${progress.chapterName} · ` : ""}
                {progress?.totalImages
                  ? `${progress.currentImage} of ${progress.totalImages} panels`
                  : `Chapter ${progress?.currentChapter || 0} of ${progress?.totalChapters || 0}`}
              </p>
              <div className="progress-track">
                <span style={{ width: `${progress?.percent || 0}%` }} />
              </div>
              <div className="progress-meta">
                <span>{progress?.percent || 0}% complete</span>
                <span>
                  {progress?.etaSeconds ? `ETA ${progress.etaSeconds}s · ` : ""}
                  {progress?.speedHint || "Keep this tab open"}
                </span>
              </div>
              <button type="button" className="cancel-button" onClick={cancel}>
                Cancel download
              </button>
            </div>
          ) : flow === "complete" ? (
            <div className="complete-state">
              <span className="success-icon">
                <Check size={31} />
              </span>
              <span className="eyebrow">DOWNLOAD COMPLETE</span>
              <h3>Your archive was saved.</h3>
              <p>
                {progress?.speedHint ||
                  `${selectedChapters.length} chapters were downloaded to your device.`}
              </p>
              <button type="button" className="download-button" onClick={reset}>
                <ArrowRight size={19} /> Download another series
              </button>
            </div>
          ) : (
            <>
              <div className="config-section">
                <div className="section-label chapter-section-label">
                  <span>01</span>
                  <div>
                    <strong>All chapters</strong>
                    <small>Select individual chapters or apply a range</small>
                  </div>
                  <b>
                    {selected.size} of {series.chapters.length}
                  </b>
                </div>
                <div className="chapter-toolbar">
                  <button
                    type="button"
                    onClick={() =>
                      setSelected(new Set(series.chapters.map((c) => c.url)))
                    }
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSelected(
                        new Set(series.chapters.slice(0, 10).map((c) => c.url))
                      )
                    }
                  >
                    Latest 10
                  </button>
                  <button type="button" onClick={() => setSelected(new Set())}>
                    Clear
                  </button>
                </div>
                <div className="range-fields">
                  <label>
                    From chapter
                    <input
                      type="number"
                      min={1}
                      max={series.chapters.length}
                      value={chapterStart}
                      onChange={(e) => {
                        setChapterStart(Number(e.target.value) || 1);
                        setRangeApplied(false);
                      }}
                    />
                  </label>
                  <span className="range-dash">—</span>
                  <label>
                    To chapter
                    <input
                      type="number"
                      min={1}
                      max={series.chapters.length}
                      value={chapterEnd}
                      onChange={(e) => {
                        setChapterEnd(Number(e.target.value) || 1);
                        setRangeApplied(false);
                      }}
                    />
                  </label>
                  <button type="button" className="apply-range-button" onClick={applyRange}>
                    Apply range
                  </button>
                </div>
                <p className="range-help">Use the chapter index shown in the list to select a continuous range.</p>
                <div className="range-preview">
                  {chapterStart <= chapterEnd ? `Ready to select ${Math.max(0, chapterEnd - chapterStart + 1)} chapter${chapterEnd - chapterStart === 0 ? "" : "s"} from ${chapterStart} to ${chapterEnd}.` : "Select a valid range before applying."}
                </div>
                {rangeApplied && (
                  <div className="range-confirmation">
                    ✅ Applied range: chapters {chapterStart} through {chapterEnd} are selected and ticked.
                  </div>
                )}
                <div className="all-chapters-list">
                  {series.chapters.map((chapter, index) => (
                    <label
                      key={chapter.url}
                      className={selected.has(chapter.url) ? "selected" : ""}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(chapter.url)}
                        onChange={() => toggleChapter(chapter.url)}
                      />
                      <i>{getChapterNumber(chapter.name, index)}</i>
                      <span>{chapter.name}</span>
                      {selected.has(chapter.url) && <Check size={14} />}
                    </label>
                  ))}
                </div>
              </div>

              <div className="config-section">
                <div className="section-label">
                  <span>02</span>
                  <div>
                    <strong>Pick a format</strong>
                    <small>Files download directly to your device</small>
                  </div>
                </div>
                <div className="format-grid">
                  {formats.map((format) => {
                    const value = format.name.toLowerCase() as ArchiveFormat;
                    return (
                      <button
                        type="button"
                        key={format.id}
                        className={`format-option ${selectedFormat === value ? "selected" : ""}`}
                        onClick={() => setSelectedFormat(value)}
                      >
                        <div className="format-icon">{format.name.slice(0, 1)}</div>
                        <span>
                          <strong>{format.name}</strong>
                          <small>{format.description}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="export-summary">
                  <strong>Export preview</strong>
                  <p>
                    {selectedChapters.length ? `Download ${selectedChapters.length} ${selectedChapters.length === 1 ? "chapter" : "chapters"} as ${selectedFormat.toUpperCase()}.` : "Select chapters and a format to see export details."}
                  </p>
                </div>
              </div>

              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}

              <button type="button" className="build-button" onClick={build} disabled={!selectedChapters.length}>
                <Download size={20} /> Export {selectedChapters.length} {selectedChapters.length === 1 ? "chapter" : "chapters"} as {selectedFormat.toUpperCase()}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
