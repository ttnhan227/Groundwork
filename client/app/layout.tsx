import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;

  return {
    metadataBase: new URL(origin),
    title: "InsightPDF — Intelligent document workspace",
    description: "Securely upload, organize, and prepare PDF documents for intelligent workflows.",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      title: "InsightPDF",
      description: "Your intelligent document workspace",
      images: [{ url: `${origin}/og.png`, width: 1536, height: 1024, alt: "InsightPDF document workspace" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "InsightPDF",
      description: "Your intelligent document workspace",
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
