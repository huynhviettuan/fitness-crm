import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

// The Vietnamese subset is required for diacritics (docs/23 §1).
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin", "vietnamese"],
});

// The UI language comes from the signed-in user or the request (src/i18n/request.ts).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");
  return {
    title: { default: t("name"), template: `%s · ${t("name")}` },
    // The home-screen app on an iPhone (M6.4).
    appleWebApp: { capable: true, title: "Gym CRM", statusBarStyle: "default" },
    icons: { apple: "/icons/apple-touch-icon.png" },
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();

  return (
    <html lang={locale} className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full">
        <NextIntlClientProvider>
          <TooltipProvider>
            {children}
            <Toaster position="top-right" />
          </TooltipProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
