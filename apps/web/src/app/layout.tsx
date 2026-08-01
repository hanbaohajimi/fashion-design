import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AuthProvider } from "../modules/auth/AuthProvider";
import { QueryProvider } from "../modules/projects/QueryProvider";

import "./globals.css";
import "tldraw/tldraw.css";

export const metadata: Metadata = {
  title: "AI 服装设计平台",
  description: "面向专业服装设计工作流的 AI 创意平台",
};

interface RootLayoutProps {
  readonly children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="zh-CN">
      <body>
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
        <div className="app-root" id="main-content" tabIndex={-1}>
          <QueryProvider>
            <AuthProvider>{children}</AuthProvider>
          </QueryProvider>
        </div>
      </body>
    </html>
  );
}
