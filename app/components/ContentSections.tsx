"use client";

import { CheckCircle2, Sparkles, LoaderCircle, ArrowRight, BookOpen, ShieldCheck, type LucideIcon } from "lucide-react";
import type { ContentItem } from "../content/static";

const iconMap: Record<string, LucideIcon> = {
  zap: Sparkles,
  images: Sparkles,
  layers: Sparkles,
  link: Sparkles,
  shield: ShieldCheck,
  mobile: Sparkles,
  heart: Sparkles,
  lock: ShieldCheck,
  format: Sparkles,
};

export function FeaturesSection({
  features,
  loading,
}: {
  features: ContentItem[];
  loading: boolean;
}) {
  return (
    <section className="features-section shell" id="features">
      <div className="features-heading">
        <span className="eyebrow">WHY CHOOSE US</span>
        <h2>
          Built for <em>readers.</em>
        </h2>
        <p>
          Everything you need to archive your favourite series — fast, premium and beautifully simple.
        </p>
      </div>
      {loading ? (
        <div className="content-loading">
          <LoaderCircle className="spin" size={24} /> Loading features…
        </div>
      ) : (
        <div className="features-grid">
          {features.map((feature, index) => {
            const Icon = iconMap[feature.icon] || Sparkles;
            return (
              <article key={feature.id}>
                <div className={`feature-icon feature-tone-${(index % 3) + 1}`}>
                  <Icon size={25} />
                </div>
                <span className="feature-number">0{index + 1}</span>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function AboutSection({
  about,
  points,
  loading,
  onOpenDownloader,
}: {
  about?: ContentItem;
  points: ContentItem[];
  loading: boolean;
  onOpenDownloader: () => void;
}) {
  return (
    <section className="about-section" id="about">
      <div className="shell about-grid">
        <div className="about-art" aria-hidden="true">
          <div className="about-orbit">
            <span>READ</span>
            <span>COLLECT</span>
            <span>OFFLINE</span>
          </div>
          <div className="reader-card">
            <BookOpen size={42} />
            <strong>
              YOUR
              <br />
              LIBRARY
            </strong>
            <small>ANYWHERE</small>
          </div>
          <div className="privacy-note">
            <ShieldCheck size={19} />
            <span>
              <strong>100% focused</strong>
              <small>No login. No telemetry.</small>
            </span>
          </div>
        </div>
        <div className="about-copy">
          {loading || !about ? (
            <div className="content-loading">
              <LoaderCircle className="spin" size={24} /> Loading our story…
            </div>
          ) : (
            <>
              <span className="eyebrow">{about.eyebrow}</span>
              <h2>{about.title}</h2>
              <p className="about-lead">{about.description}</p>
              <div className="about-points">
                {points.map((point) => {
                  const Icon = iconMap[point.icon] || CheckCircle2;
                  return (
                    <article key={point.id}>
                      <span>
                        <Icon size={19} />
                      </span>
                      <div>
                        <strong>{point.title}</strong>
                        <p>{point.description}</p>
                      </div>
                    </article>
                  );
                })}
              </div>
              <button type="button" onClick={onOpenDownloader}>
                Start downloading <ArrowRight size={18} />
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
