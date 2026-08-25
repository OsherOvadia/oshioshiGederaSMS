import type { Metadata, Viewport } from "next";
import { assistant, frankRuhl } from "./fonts";
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
  // No maximumScale / userScalable: capping zoom fails WCAG 1.4.4, and iOS
  // Safari ignores the cap anyway while Android honours it.
  //
  // viewportFit: "cover" is what makes env(safe-area-inset-*) resolve to real
  // numbers on a notched iPhone. Without it those insets are all 0 and the
  // safe-area padding in globals.css silently does nothing — which is why the
  // layout ran under the notch and the home indicator.
  viewportFit: "cover",
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="he" dir="rtl" className={`${assistant.variable} ${frankRuhl.variable}`}>
      <body>
        <a className="skip-link" href="#main-content">
          דילוג לתוכן הראשי
        </a>
        {children}
      </body>
    </html>
  );
}
