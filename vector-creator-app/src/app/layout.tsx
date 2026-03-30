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
  title: "VectorEase | Image to Laser-Ready Vector in Seconds",
  description: "Convert any photo into layered SVGs optimized for LightBurn and Falcon Pro. Upload, tune your layers, and cut. No tracing skills required.",
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
