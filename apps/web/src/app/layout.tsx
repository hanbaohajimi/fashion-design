import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Toaster } from "sonner";

import { AuthProvider } from "../modules/auth/AuthProvider";
import { QueryProvider } from "../modules/projects/QueryProvider";
import { CreativeContinuity } from "../modules/projects/CreativeContinuity";
import { MotionEnvironment } from "../components/interactions/MotionEnvironment";
import { WorkspaceShell } from "../components/WorkspaceShell";
import { FeatureGuideProvider } from "../components/feature-guide/FeatureGuideProvider";
import { Suspense } from "react";

import "./globals.css";
import "tldraw/tldraw.css";

export const metadata: Metadata = {
  applicationName: "森织设计工作室",
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
    default: "森织设计工作室",
    template: "%s 森织",
  },
};

interface RootLayoutProps {
  readonly children: ReactNode;
}

export const viewport: Viewport = {
  width: "device-width", initialScale: 1, viewportFit: "cover",
  interactiveWidget: "resizes-content", themeColor: "#f5f4ee", colorScheme: "light",
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="zh-CN">
      <body>
        <MotionEnvironment />
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
        <div className="app-root" id="main-content" tabIndex={-1}>
          <AuthProvider>
            <FeatureGuideProvider><Suspense fallback={null}><WorkspaceShell>
              <CreativeContinuity />
              <QueryProvider>{children}</QueryProvider>
            </WorkspaceShell></Suspense></FeatureGuideProvider>
          </AuthProvider>
        </div>
        {/* 全局通知与本轮浅色工作台使用同一主题。 */}
        <Toaster
          theme="light"
          position="bottom-right"
          richColors
          closeButton
          duration={4000}
          offset={{ bottom: "calc(32px + env(safe-area-inset-bottom, 0px))", right: "calc(32px + env(safe-area-inset-right, 0px))", left: "calc(32px + env(safe-area-inset-left, 0px))" }}
          mobileOffset={{ bottom: "calc(16px + env(safe-area-inset-bottom, 0px))", right: "calc(16px + env(safe-area-inset-right, 0px))", left: "calc(16px + env(safe-area-inset-left, 0px))" }}
          toastOptions={{
            closeButtonAriaLabel: "关闭通知",
            style: {
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-sm, 13px)",
            },
          }}
        />
      </body>
    </html>
  );
}
