import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tier 4 Advisor Cockpit",
  description: "A guided, evidence-grounded throughput audit from client intake to approved deliverables.",
  openGraph: {
    title: "Tier 4 Advisor Cockpit",
    description: "A guided, evidence-grounded throughput audit from client intake to approved deliverables.",
    images: [{ url: "/tier4-advisor-social.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Tier 4 Advisor Cockpit",
    description: "A guided, evidence-grounded throughput audit from client intake to approved deliverables.",
    images: ["/tier4-advisor-social.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
