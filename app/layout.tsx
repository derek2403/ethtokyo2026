import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";

import { ConnectButton } from "@/components/ConnectButton";

import "./globals.css";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Keyless Relay",
  description: "Provider API keys stay in one relay; people and agents get ENS names with spending limits instead",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <Providers>
          <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-zinc-200 bg-background/80 px-6 backdrop-blur dark:border-zinc-800">
            <Link href="/" className="font-semibold">
              Keyless Relay
            </Link>
            <ConnectButton />
          </header>
          <main className="mx-auto w-full max-w-5xl px-6 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
