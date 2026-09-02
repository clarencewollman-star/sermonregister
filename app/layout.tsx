import type { Metadata } from "next";
import "admin-lte/dist/css/adminlte.min.css";
import "bootstrap-icons/font/bootstrap-icons.css";
import "react-image-crop/dist/ReactCrop.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lehr Register",
  description: "A private register for Lehr and Gebet services.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="layout-fixed sidebar-expand-lg bg-body-tertiary">
        {children}
      </body>
    </html>
  );
}
