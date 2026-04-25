import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TopBar } from "@/components/TopBar";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Sauron Wallet — AI investment analyst",
  description:
    "Multimodal AI investment analyst. Panel alt-data, geopolitical overlays, GPS, your own Bunq spending. Built for Bunq Hackathon 7.0.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body
        className="flex min-h-full flex-col"
        style={{ background: "var(--bunq-bg)", color: "var(--bunq-text)" }}
      >
        <TopBar />
        {children}
      </body>
    </html>
  );
}
