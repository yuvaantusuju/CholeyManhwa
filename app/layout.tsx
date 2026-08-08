import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Choley Manhwa Downloader",
  description:
    "Turn manga, manhwa and webtoon links into real, offline-ready chapter archives — without the clutter.",
  themeColor: "#f8f5ee",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
