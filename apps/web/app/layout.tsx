import type { Metadata } from "next";
import { DM_Sans, Fraunces } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "Atlas Finance AI",
  description: "Turn bank statements into structured financial intelligence",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${dmSans.variable} ${fraunces.variable} font-sans`}>
        <style>{`
          :root {
            --font-sans: ${dmSans.style.fontFamily};
            --font-display: ${fraunces.style.fontFamily};
          }
          .font-display { font-family: var(--font-display), Georgia, serif; }
          .font-sans { font-family: var(--font-sans), system-ui, sans-serif; }
        `}</style>
        {children}
      </body>
    </html>
  );
}
