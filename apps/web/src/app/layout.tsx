import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AuthProvider } from "../modules/auth/AuthProvider";
import { QueryProvider } from "../modules/projects/QueryProvider";

import "../styles/design-system.css";
import "./globals.css";
import "tldraw/tldraw.css";

export const metadata: Metadata = {
  title: "Atelier 设计工作室",
  description: "专业服装设计师的创作工作台",
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
