import type { Metadata } from "next";
import "./globals.css";
import LanguageSwitcher from "@/components/LanguageSwitcher";

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
      <body>
        <LanguageSwitcher />
        {children}
      </body>
    </html>
  );
}
