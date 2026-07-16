import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./marketing.css";

const title = "Engram | Memory reliability for AI agents";
const description =
  "Capture the memory decision behind a bad agent answer, diagnose it, replay a controlled correction, and keep the fix as a regression test.";

export const metadata: Metadata = {
  title,
  description,
  metadataBase: new URL("https://engram-viz.dev"),
  openGraph: {
    title,
    description,
    images: ["/engram-og.png"],
    type: "website"
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/engram-og.png"]
  },
  icons: {
    icon: "/engram-icon.png"
  }
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#050510",
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
