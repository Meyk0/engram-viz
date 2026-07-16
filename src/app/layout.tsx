import type { Metadata } from "next";
import "./globals.css";

const studioUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(studioUrl),
  title: "Engram Studio - Local memory reliability for AI agents",
  description: "Inspect, replay, and regression-test memory-dependent agent failures in local Engram Studio.",
  icons: {
    icon: [{ url: "/engram-icon.png", type: "image/png", sizes: "512x512" }],
    apple: [{ url: "/engram-icon.png", type: "image/png", sizes: "512x512" }]
  },
  openGraph: {
    title: "Engram Studio - Local memory reliability for AI agents",
    description: "Inspect, replay, and regression-test memory-dependent agent failures in local Engram Studio.",
    url: "/",
    siteName: "Engram Studio",
    images: [
      {
        url: "/engram-og.png",
        width: 1200,
        height: 630,
        alt: "Engram 3D brain memory visualizer"
      }
    ],
    type: "website"
  },
  twitter: {
    card: "summary_large_image",
    title: "Engram Studio - Local memory reliability for AI agents",
    description: "Inspect, replay, and regression-test memory-dependent agent failures in local Engram Studio.",
    images: ["/engram-og.png"]
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
