import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AuthProvider } from "../modules/auth/AuthProvider";
import { QueryProvider } from "../modules/projects/QueryProvider";

import "./globals.css";
import "tldraw/tldraw.css";

export const metadata: Metadata = {
  applicationName: "Atelier 设计工作室",
  category: "design",
  description: "专业服装设计师的创作工作台",
  formatDetection: {
    address: false,
    email: false,
    telephone: false,
  },
  referrer: "strict-origin-when-cross-origin",
  robots: {
    follow: false,
    index: false,
  },
  title: {
    default: "Atelier 设计工作室",
    template: "%s · Atelier",
  },
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
          <AuthProvider>
            <QueryProvider>{children}</QueryProvider>
          </AuthProvider>
        </div>
      </body>
    </html>
  );
}
