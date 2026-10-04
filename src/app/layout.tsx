import type { Metadata } from "next";
import { BRAND } from "@/lib/model";
import { WorkspaceProvider } from "@/components/provider";
import { Shell } from "@/components/shell";
import { InstallSupport } from "@/components/install";
import "./globals.css";
export const metadata: Metadata = {
  title: `${BRAND} — A practice in progress`,
  description:
    "A thoughtful workspace for competitive programming and DSA. Small steps. Lasting understanding.",
  appleWebApp: { capable: true, title: BRAND, statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};
const themeScript = `try{var t=localStorage.getItem('forma.theme');document.documentElement.dataset.theme=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light'}catch(e){}`;
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <WorkspaceProvider>
          <Shell>{children}</Shell>
          <InstallSupport />
        </WorkspaceProvider>
      </body>
    </html>
  );
}
