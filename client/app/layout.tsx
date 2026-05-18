import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { SiteFooter, SiteHeader } from "./site-chrome";
import { WaveSkin } from "./_components/wave-skin";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "WAVE — Urge Surfing Companion",
  description:
    "WAVE is an offline-first, medication-aware urge surfing companion that helps people in SUD recovery ride out cravings in real time.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <WaveSkin>
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </WaveSkin>
      </body>
    </html>
  );
}
