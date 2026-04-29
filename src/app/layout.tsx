import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Engram - See your AI think",
  description: "A 3D brain visualizer that makes LLM memory visible in real time."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
