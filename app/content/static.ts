// Static site content (replaces Supabase page_content table).
// Edit this file to update hero/features/about copy.

export type DownloadFormat = {
  id: number;
  name: string;
  extension: string;
  description: string;
  recommended: boolean;
};

export const downloadFormats: DownloadFormat[] = [
  {
    id: 1,
    name: "PDF",
    extension: "pdf",
    description: "Single high-quality PDF per chapter. Best for phones and tablets.",
    recommended: true,
  },
  {
    id: 2,
    name: "CBZ",
    extension: "cbz",
    description: "Comic-book zip. Opens in most reader apps including Panels and Paperback.",
    recommended: false,
  },
  {
    id: 3,
    name: "ZIP",
    extension: "zip",
    description: "Raw panel images bundled in a numbered zip archive.",
    recommended: false,
  },
];

export type ContentItem = {
  id: number;
  section: "feature" | "about" | "about_point";
  slug: string;
  eyebrow: string;
  title: string;
  description: string;
  icon: string;
  sort_order: number;
};

export const pageContent: ContentItem[] = [
  {
    id: 1,
    section: "feature",
    slug: "real-panels",
    eyebrow: "REAL PANELS",
    title: "Original-quality images",
    description: "We pull the actual panel files from the source and package them — no compression, no watermarks.",
    icon: "zap",
    sort_order: 1,
  },
  {
    id: 2,
    section: "feature",
    slug: "three-formats",
    eyebrow: "THREE FORMATS",
    title: "PDF, CBZ, or ZIP",
    description: "Choose a single multi-page PDF, a reader-friendly CBZ, or a raw numbered zip — whatever your reader prefers.",
    icon: "format",
    sort_order: 2,
  },
  {
    id: 3,
    section: "feature",
    slug: "private",
    eyebrow: "PRIVATE BY DEFAULT",
    title: "No login, no telemetry",
    description: "Searches and downloads stay in your browser. We never store the series you read.",
    icon: "shield",
    sort_order: 3,
  },
  {
    id: 4,
    section: "feature",
    slug: "offline",
    eyebrow: "READ OFFLINE",
    title: "Built for travel",
    description: "Take a long flight, commute through tunnels, or read on a beach — your library is on the device, not in a cloud.",
    icon: "mobile",
    sort_order: 4,
  },
  {
    id: 5,
    section: "feature",
    slug: "ranges",
    eyebrow: "SMART RANGES",
    title: "Pick exactly what you want",
    description: "One chapter, the latest 10, or a custom range — no more downloading 300 chapters to read one arc.",
    icon: "layers",
    sort_order: 5,
  },
  {
    id: 6,
    section: "feature",
    slug: "mirrors",
    eyebrow: "AD FREE",
    title: "Ad free",
    description: "Choley delivers a clean reading experience with no ads or distractions.",
    icon: "link",
    sort_order: 6,
  },
  {
    id: 7,
    section: "about",
    slug: "about",
    eyebrow: "ABOUT CHOLEY",
    title: "A focused downloader for people who actually read.",
    description:
      "Choley started as a personal tool to keep a long-running webtoon readable on a long-haul flight. It became the project you are using now — a small, fast, opinionated downloader that does one thing and does it well.",
    icon: "heart",
    sort_order: 1,
  },
  {
    id: 8,
    section: "about_point",
    slug: "no-account",
    eyebrow: "",
    title: "No account required",
    description: "Sign-ups are friction. We trust you to archive what you love.",
    icon: "lock",
    sort_order: 1,
  },
  {
    id: 9,
    section: "about_point",
    slug: "no-tracking",
    eyebrow: "",
    title: "No tracking pixels",
    description: "No analytics, no session replay, no third-party scripts.",
    icon: "shield",
    sort_order: 2,
  },
  {
    id: 10,
    section: "about_point",
    slug: "personal-use",
    eyebrow: "",
    title: "Personal archival",
    description: "Designed for your own offline library — please respect creators and publishers.",
    icon: "heart",
    sort_order: 3,
  },
];
