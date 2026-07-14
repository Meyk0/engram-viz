import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

const googleAnalyticsId = "G-DQX8CR91QK";
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Engram - Make AI memory visible",
  description: "An interactive 3D view of observable LLM memory operations: what is stored, retrieved, consolidated, and used to answer.",
  icons: {
    icon: [{ url: "/engram-icon.png", type: "image/png", sizes: "512x512" }],
    apple: [{ url: "/engram-icon.png", type: "image/png", sizes: "512x512" }]
  },
  openGraph: {
    title: "Engram - Make AI memory visible",
    description: "Explore observable LLM memory operations: what is stored, retrieved, consolidated, and used to answer.",
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
    title: "Engram - Make AI memory visible",
    description: "Explore observable LLM memory operations: what is stored, retrieved, consolidated, and used to answer.",
    images: ["/engram-og.png"]
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Script
          async
          src={`https://www.googletagmanager.com/gtag/js?id=${googleAnalyticsId}`}
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${googleAnalyticsId}');
          `}
        </Script>
        {children}
      </body>
    </html>
  );
}
