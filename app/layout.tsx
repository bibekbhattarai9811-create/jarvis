import type { Metadata, Viewport } from "next";
import "./globals.css";
import InstallApp from "./InstallApp";

export const metadata: Metadata = {
  title: "JARVIS",
  description: "Voice assistant powered by Claude",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "JARVIS", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#03080f",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <InstallApp />
        {children}
      </body>
    </html>
  );
}
