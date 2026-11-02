import type { Metadata } from "next";
import "../pro/pro.css";
import "./field.css";

export const metadata: Metadata = { title: "Field Assist" };

export default function FieldLayout({ children }: { children: React.ReactNode }) {
  return <div className="pro-root">{children}</div>;
}
