import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { AuthProvider } from "@/components/auth/AuthContext";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://vectorease.com"),
  title: "VectorEase | Image to Laser-Ready Vector in Seconds",
  description: "Convert any photo into layered SVGs optimized for LightBurn and Falcon Pro. Upload, tune your layers, and cut. No tracing skills required.",
  icons: {
    icon: "/brand/favicon.svg",
    shortcut: "/brand/favicon.svg",
    apple: "/brand/logo-mark.svg",
  },
  openGraph: {
    title: "VectorEase | Image to Laser-Ready Vector in Seconds",
    description: "Convert any photo into layered SVGs optimized for LightBurn and Falcon Pro. Upload, tune your layers, and cut. No tracing skills required.",
    url: "https://vectorease.com",
    siteName: "VectorEase",
    images: [
      {
        url: "/brand/og-image.svg",
        width: 1200,
        height: 630,
        alt: "VectorEase — Image to laser-ready vector in seconds",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "VectorEase | Image to Laser-Ready Vector in Seconds",
    description: "Convert any photo into layered SVGs optimized for LightBurn and Falcon Pro.",
    images: ["/brand/og-image.svg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <AuthProvider>
          <Providers>
            {children}
          </Providers>
        </AuthProvider>
      </body>
    </html>
  );
}
