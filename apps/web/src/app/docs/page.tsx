import { redirect } from "next/navigation";

const defaultDocsUrl = "https://github.com/Meyk0/engram-viz/blob/main/docs/quickstart.mdx";

export default function DocsRedirectPage(): never {
  redirect(process.env.NEXT_PUBLIC_DOCS_URL ?? defaultDocsUrl);
}
