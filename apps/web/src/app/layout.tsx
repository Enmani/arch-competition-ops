import type { Metadata } from "next";
import { Barlow_Condensed, Public_Sans } from "next/font/google";
import { type ReactNode } from "react";
import type { Viewport } from "next";

import "./globals.css";

const displayFont = Barlow_Condensed({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600", "700"],
});

const sansFont = Public_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Arch Competition Ops",
  description:
    "Public design opportunities from official sources for licensed architects and practices.",
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

const RootLayout = ({ children }: RootLayoutProps) => {
  return (
    <html
      className={`${displayFont.variable} ${sansFont.variable}`}
      data-scroll-behavior="smooth"
      lang="en"
      suppressHydrationWarning
    >
      <body>{children}</body>
    </html>
  );
};

export default RootLayout;
