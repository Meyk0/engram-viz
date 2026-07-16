import type { Metadata } from "next";
import { PublicDemo } from "@/components/PublicDemo/PublicDemo";

export const metadata: Metadata = {
  title: "Guided memory incident demo | Engram",
  description: "Repair a deterministic stale-memory failure in five browser-only steps."
};

export default function DemoPage() {
  return <PublicDemo />;
}
