import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "数独推演器",
  description: "逐步展示人类逻辑技巧的数独求解器。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
