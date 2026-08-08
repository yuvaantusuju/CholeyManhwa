"use client";

import { useEffect, useState } from "react";
import { BookOpen, Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

export function Logo() {
  return (
    <a className="brand" href="#top" aria-label="Choley Manhwa Downloader home">
      <span className="brand-mark">
        <BookOpen size={18} strokeWidth={2.4} />
      </span>
      <span className="brand-copy">
        <strong>CHOLEY</strong>
        <small>MANHWA DOWNLOADER</small>
      </span>
    </a>
  );
}

export function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={onToggle}
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
    >
      <span className={theme === "light" ? "active" : ""}>
        <Sun size={15} />
      </span>
      <span className={theme === "dark" ? "active" : ""}>
        <Moon size={15} />
      </span>
    </button>
  );
}

export function Header({
  theme,
  onToggleTheme,
  onOpenDownloader,
}: {
  theme: Theme;
  onToggleTheme: () => void;
  onOpenDownloader: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="shell header-inner">
        <Logo />
        <nav className="desktop-nav" aria-label="Main navigation">
          <a href="#how">How it works</a>
          <a href="#features">Features</a>
          <a href="#about">About</a>
        </nav>
        <div className="header-actions">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          <button className="header-cta" type="button" onClick={onOpenDownloader}>
            Open downloader <span aria-hidden>→</span>
          </button>
        </div>
        <div className="mobile-actions">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          <button
            className="menu-button"
            type="button"
            aria-label="Open menu"
            onClick={() => setOpen(true)}
          >
            ☰
          </button>
        </div>
      </div>
      {open && (
        <div className="mobile-menu">
          <div className="mobile-menu-top">
            <Logo />
            <button type="button" onClick={() => setOpen(false)} aria-label="Close menu">
              ✕
            </button>
          </div>
          <a href="#how" onClick={() => setOpen(false)}>How it works</a>
          <a href="#features" onClick={() => setOpen(false)}>Features</a>
          <a href="#about" onClick={() => setOpen(false)}>About</a>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onOpenDownloader();
            }}
          >
            Open downloader
          </button>
        </div>
      )}
    </header>
  );
}

export function useTheme(): [Theme, () => void, boolean] {
  const [theme, setTheme] = useState<Theme>("light");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("choley-theme");
    if (saved === "light" || saved === "dark") {
      setTheme(saved);
    } else if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setTheme("dark");
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("choley-theme", theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#0d0f14" : "#f8f5ee");
  }, [theme, ready]);

  return [theme, () => setTheme((t) => (t === "light" ? "dark" : "light")), ready];
}
