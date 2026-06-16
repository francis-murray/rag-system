import type { Metadata } from "next";
import "./globals.css";


export const metadata: Metadata = {
  title: "RAG System Chat",
  description: "Modern chat UI for querying the RAG backend"
};

type RootLayoutProps = Readonly<{
  children: React.ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
