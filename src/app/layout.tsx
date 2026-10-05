import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// 纯 SVG 图标（无 emoji）：肤色圆角底 + 三个白点
const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='24' fill='%23cc975b'/%3E%3Ccircle cx='30' cy='50' r='7' fill='%23fff'/%3E%3Ccircle cx='50' cy='50' r='7' fill='%23fff'/%3E%3Ccircle cx='70' cy='50' r='7' fill='%23fff'/%3E%3C/svg%3E";

export const metadata: Metadata = {
  title: "图咕 · 免登录聊天室",
  description: "图咕——匿名图话聊天室，发图发字，支持图片原图直发。",
  keywords: ["图咕", "聊天室", "免登录", "匿名", "图片分享"],
  icons: { icon: FAVICON },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const themeScript = `(function(){try{var m=matchMedia('(prefers-color-scheme: dark)');document.documentElement.classList.toggle('dark',m.matches);m.addEventListener('change',function(e){document.documentElement.classList.toggle('dark',e.matches)});}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
