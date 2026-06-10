import type { Metadata, Viewport } from "next";
import { heebo, secularOne } from "./fonts";
import "./globals.css";

const appUrl = process.env.APP_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: "מועדון ה-VIP | סושי גדרה",
  description:
    "הצטרפו בחינם למועדון ה-VIP — מבצעי 1+1, הטבת יום הולדת ועדכונים חמים ישירות ב-SMS.",
  openGraph: {
    title: "מועדון ה-VIP | סושי גדרה",
    description: "מבצעי 1+1, הטבת יום הולדת ועדכונים חמים ישירות ב-SMS.",
    type: "website",
    locale: "he_IL",
    images: [{ url: "/hero/bg1.jpg" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#0c0a09",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="he" dir="rtl" className={`${heebo.variable} ${secularOne.variable}`}>
      <body>{children}</body>
    </html>
  );
}
