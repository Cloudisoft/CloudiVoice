import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Noto_Sans_Devanagari } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });
const devanagari = Noto_Sans_Devanagari({
  subsets: ["devanagari"],
  weight: ["400", "500", "600"],
  variable: "--font-devanagari",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: {
    default: "CloudiVoice — AI voice agents that sound remarkably human",
    template: "%s · CloudiVoice",
  },
  description:
    "Build AI voice agents that speak Hindi, English and Indian languages to qualify leads, book appointments and support customers — on transparent per-minute pricing in rupees. A Cloudisoft product.",
  icons: {
    icon: [
      { url: "/brand/mark-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/mark-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/brand/mark-192.png",
  },
  openGraph: {
    title: "CloudiVoice — AI voice agents that sound remarkably human",
    description: "India-first AI voice agents in Hindi, English and regional languages. By Cloudisoft.",
    images: ["/brand/mark-512.png"],
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#050814",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} ${devanagari.variable}`}>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
