import type { Metadata, Viewport } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import "./marketing.css";

const title = "Engram | Memory reliability for AI agents";
const description =
  "Capture the memory decision behind a bad agent answer, diagnose it, replay a controlled correction, and keep the fix as a regression test.";
const googleAnalyticsId = process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID ?? "G-DQX8CR91QK";

export const metadata: Metadata = {
  title,
  description,
  metadataBase: new URL("https://engramviz.com"),
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
            gtag('config', '${googleAnalyticsId}', { anonymize_ip: true });
          `}
        </Script>
        {children}
      </body>
    </html>
  );
}
