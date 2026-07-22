import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "YNX Oracle", template: "%s · YNX Oracle" },
  description: "Verifiable YNX market-data health, lineage, and quality controls.",
  applicationName: "YNX Oracle",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f2f0e9" }, { media: "(prefers-color-scheme: dark)", color: "#101210" }] };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><body>{children}</body></html>;
}
