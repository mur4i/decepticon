import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Decepticon",
  description: "The first Autonomous Open-Source Entity.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
