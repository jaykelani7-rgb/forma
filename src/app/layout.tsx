import type { Metadata } from "next";
import { connection } from "next/server";
import { BRAND } from "@/lib/model";
import { macDownloadUrl } from "@/lib/mac-download";
import { WorkspaceBoundary } from "@/components/workspace-boundary";
import "./globals.css";
import "./ribbon.css";
import "../../packages/ribbon/studio.css";
export const metadata: Metadata = {
  title: `${BRAND} — A practice in progress`,
  description:
    "A thoughtful workspace for competitive programming and DSA. Small steps. Lasting understanding.",
  appleWebApp: { capable: true, title: BRAND, statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};
const themeScript = `try{var t=localStorage.getItem('forma.theme');document.documentElement.dataset.theme=!t||t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light'}catch(e){}`;
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await connection();
  const publicHome = macDownloadUrl() !== null;
  return (
    <html lang="en" data-design="ribbon" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <WorkspaceBoundary publicHome={publicHome}>{children}</WorkspaceBoundary>
      </body>
    </html>
  );
}
