import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cascade — Real-time market intelligence",
  description: "Real-time market cascade intelligence powered by MongoDB and Gemini.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <body>{children}</body>
    </html>
  );
}
