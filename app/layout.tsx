import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Python Canvas",
  description: "A simple online Python IDE that runs fully in the browser.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
