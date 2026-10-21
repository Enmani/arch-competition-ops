import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Public_Sans } from "next/font/google";
import { type ReactNode } from "react";

import { getDictionary, getRequestLocale } from "@/i18n/server";
import { getSiteOrigin } from "@/lib/page-metadata";

import "./globals.css";

// Weights follow what the stylesheets request: regular text, 600 and 700 (headings and bold).
const displayFont = Barlow_Condensed({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "600", "700"],
});

const sansFont = Public_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "600", "700"],
});

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getRequestLocale();
  const { meta } = getDictionary(locale);
  const origin = await getSiteOrigin();

  return {
    applicationName: meta.siteName,
    description: meta.description,
    metadataBase: origin ? new URL(origin) : undefined,
    openGraph: { locale: meta.ogLocale, siteName: meta.siteName, type: "website" },
    title: { default: meta.siteName, template: `%s | ${meta.siteName}` },
  };
};

export const viewport: Viewport = {
  themeColor: "#eef0e8",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

type RootLayoutProps = {
  children: ReactNode;
};

const RootLayout = async ({ children }: RootLayoutProps) => {
  // Server-rendered from the URL's locale, so there is no English-then-flip on first paint.
  const locale = await getRequestLocale();

  return (
    <html
      className={`${displayFont.variable} ${sansFont.variable}`}
      data-scroll-behavior="smooth"
      lang={locale}
    >
      <body>{children}</body>
    </html>
  );
};

export default RootLayout;
