"use client";

import { useMemo } from "react";
import { Header, Logo, useTheme } from "./Header";
import { DownloaderCard } from "./DownloaderCard";
import { FeaturesSection, AboutSection } from "./ContentSections";
import {
  ArrowDown,
  ArrowRight,
  CheckCircle2,
  Download,
  Globe2,
  Instagram,
  Layers3,
  LoaderCircle,
  Search,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import type { ContentItem, DownloadFormat } from "../content/static";

export function AppShell({
  formats,
  content,
}: {
  formats: DownloadFormat[];
  content: ContentItem[];
}) {
  const [theme, toggleTheme, ready] = useTheme();
  const features = useMemo(() => content.filter((c) => c.section === "feature"), [content]);
  const about = useMemo(() => content.find((c) => c.section === "about"), [content]);
  const aboutPoints = useMemo(
    () => content.filter((c) => c.section === "about_point"),
    [content]
  );
  const scrollToDownloader = () =>
    document.getElementById("downloader")?.scrollIntoView({ behavior: "smooth", block: "center" });

  return (
    <div id="top" className="app">
      <Header theme={theme} onToggleTheme={toggleTheme} onOpenDownloader={scrollToDownloader} />

      <main>
        <section className="hero shell">
          <div className="hero-copy">
            <div className="hero-kicker">
              <span>
                <Sparkles size={14} />
              </span>{" "}
              Your stories. Offline. Anywhere.
            </div>
            <h1>
              Read later.
              <br />
              <em>Keep forever.</em>
            </h1>
            <p className="hero-lead">
              Turn manga, manhwa and webtoon links into real, offline-ready chapter archives—without
              the clutter.
            </p>
            <div className="hero-actions">
              <button className="primary-hero" type="button" onClick={scrollToDownloader}>
                Start downloading <ArrowDown size={18} />
              </button>
              <a href="#features">
                Explore features <span>↓</span>
              </a>
            </div>
            <div className="trust-row">
              <span>
                <ShieldCheck size={17} /> No login
              </span>
              <span>
                <Zap size={17} /> Real panel downloads
              </span>
              <span>
                <Globe2 size={17} /> Private session
              </span>
            </div>
          </div>
          <div className="hero-workspace">
            <div className="hero-decoration">
              READ
              <br />
              YOUR
              <br />
              WAY
            </div>
            <DownloaderCard formats={formats} />
            <div className="mini-proof">
              <span className="proof-icon">
                <Zap size={17} />
              </span>
              <strong>Privacy</strong>
              <span>
                Real chapters and
                <br />
                panel images
              </span>
            </div>
          </div>
        </section>

        <section className="how-section" id="how">
          <div className="shell">
            <div className="section-intro">
              <span className="eyebrow">SIMPLE BY CHOLEY</span>
              <h2>
                From link to library
                <br />
                in three tiny steps.
              </h2>
              <p>
                No confusing settings, pop-ups or trackers. Just a focused workflow that gets you
                back to reading.
              </p>
            </div>
            <div className="steps-grid">
              <article>
                <span className="step-number">01</span>
                <div className="step-icon blue">
                  <Search size={26} />
                </div>
                <h3>Enter a title</h3>
                <p>Search for your favorite manga, manhwa or webtoon by title.</p>
                <ArrowRight size={22} />
              </article>
              <article>
                <span className="step-number">02</span>
                <div className="step-icon coral">
                  <Layers3 size={26} />
                </div>
                <h3>Choose chapters</h3>
                <p>Pick one chapter, a custom range, or prepare the full available series.</p>
                <ArrowRight size={22} />
              </article>
              <article>
                <span className="step-number">03</span>
                <div className="step-icon lime">
                  <Download size={26} />
                </div>
                <h3>Read offline</h3>
                <p>Original panels are packaged as PDF, CBZ or ZIP on your device.</p>
                <CheckCircle2 size={22} />
              </article>
            </div>
          </div>
        </section>

        <FeaturesSection features={features} loading={!ready} />
        <AboutSection about={about} points={aboutPoints} loading={!ready} onOpenDownloader={scrollToDownloader} />

        <section className="closing-cta shell">
          <div className="closing-copy">
            <span className="eyebrow">READY WHEN YOU ARE</span>
            <h2>
              Your next great read
              <br />
              doesn’t need Wi-Fi.
            </h2>
            <button type="button" onClick={scrollToDownloader}>
              Download a series <ArrowRight size={18} />
            </button>
          </div>
          <div className="closing-art">
            <div className="book book-one">
              SOLO
              <br />
              <span>01</span>
            </div>
            <div className="book book-two">
              TOWER
              <br />
              <span>17</span>
            </div>
            <div className="book book-three">
              BLADE
              <br />
              <span>42</span>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="shell footer-grid">
          <div>
            <Logo />
            <p>
              A focused manga, manhwa and webtoon downloader for readers who value speed, quality and
              privacy.
            </p>
          </div>
          <div>
            <strong>Explore</strong>
            <a href="#how">How it works</a>
            <a href="#features">Features</a>
            <a href="#about">About</a>
          </div>
          <div>
            <strong>Principles</strong>
            <span>Privacy first</span>
            <span>No telemetry</span>
            <span>Personal archival</span>
          </div>
          <div>
            <strong>Creator</strong>
            <a href="https://instagram.com/mykece_" target="_blank" rel="noreferrer">
              <Instagram size={16} /> Instagram
            </a>
            <a href="mailto:hello@choley.app">Contact</a>
          </div>
        </div>
        <div className="shell footer-bottom">
          <span>© 2026 Choley Manhwa Downloader.</span>
          <span>Only archive content you have permission to access.</span>
        </div>
      </footer>
    </div>
  );
}
