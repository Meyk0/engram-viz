import type { Metadata } from "next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Engram - See your AI think",
  description: "A 3D brain visualizer that makes LLM memory visible in real time.",
  icons: {
    icon: [{ url: "/engram-icon.png", type: "image/png", sizes: "512x512" }],
    apple: [{ url: "/engram-icon.png", type: "image/png", sizes: "512x512" }]
  },
  openGraph: {
    title: "Engram - See your AI think",
    description: "A 3D brain visualizer that makes LLM memory visible in real time.",
    url: "/",
    siteName: "Engram",
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
    title: "Engram - See your AI think",
    description: "A 3D brain visualizer that makes LLM memory visible in real time.",
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
