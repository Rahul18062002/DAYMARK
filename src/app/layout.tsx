import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Providers } from "@/components/providers";
import { BRAND } from "@/lib/brand";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: `${BRAND.name} — ${BRAND.tagline}`, template: `%s · ${BRAND.name}` },
  description: BRAND.description,
  applicationName: BRAND.name,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f9fc" },
    { media: "(prefers-color-scheme: dark)", color: "#14161f" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
