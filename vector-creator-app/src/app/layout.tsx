import type { Metadata } from "next";
import { Inter, Permanent_Marker } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { AuthProvider } from "@/components/auth/AuthContext";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const permanentMarker = Permanent_Marker({
  weight: "400",
  variable: "--font-permanent-marker",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://app.vectorease.com"),
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
    url: "https://app.vectorease.com",
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
      <body className={`${inter.variable} ${permanentMarker.variable} font-sans antialiased`}>
        <AuthProvider>
          <Providers>
            {children}
          </Providers>
        </AuthProvider>

        {/* ChatBaser (Scale.gg) AI support widget — appears bottom-right on every page.
            Strategy "afterInteractive" loads the script after the page is interactive,
            so it never blocks initial render. Agent ID is the production VectorEase Support agent. */}
        <Script id="chatbaser-widget" strategy="afterInteractive">
          {`
            (function(w,d,s,o,f,js,fjs){
              w['GrooveChat']=o;w[o]=w[o]||function(){(w[o].q=w[o].q||[]).push(arguments)};
              js=d.createElement(s);fjs=d.getElementsByTagName(s)[0];
              js.id=o;js.src=f;js.async=1;fjs.parentNode.insertBefore(js,fjs);
            }(window,document,'script','groovechat','https://chatbaser.ai/widget.js'));
            groovechat('init', '47ed0251-81d5-4341-b0be-23ff40c01630');
          `}
        </Script>
      </body>
    </html>
  );
}
