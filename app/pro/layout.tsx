import type { Metadata } from "next";
import "./pro.css";

export const metadata: Metadata = { title: "Inspect Pro" };

export default function ProLayout({ children }: { children: React.ReactNode }) {
  return <div className="pro-root">{children}</div>;
}
