"use client";

import Link from "next/link";
import { ArrowRight, Layers, Zap, Target, Upload, SlidersHorizontal, Download } from "lucide-react";
import { motion } from "framer-motion";

const fade = {
  hidden: { opacity: 0, y: 32 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.12, duration: 0.6, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
  }),
};

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      {/* ── NAV ── */}
      <nav className="fixed top-0 w-full z-50 border-b border-border-subtle bg-background/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-dd-gold-400 to-dd-gold-600 flex items-center justify-center shadow-lg glow-gold">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M4 4L12 20L20 4" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="text-lg font-bold tracking-tight">
              Vector<span className="text-dd-gold-400">Ease</span>
            </span>
          </div>
          <Link
            href="/login"
            className="px-5 py-2 text-sm font-medium rounded-lg bg-dd-gold-400/10 text-dd-gold-400 border border-dd-gold-400/20 hover:bg-dd-gold-400/20 hover:border-dd-gold-400/40 transition-all duration-200"
          >
            Sign In
          </Link>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="relative pt-32 pb-24 md:pt-44 md:pb-32">
        {/* Background effects */}
        <div className="absolute inset-0 grid-pattern" />
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-dd-gold-400/[0.04] blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 left-1/4 w-[400px] h-[400px] rounded-full bg-dd-blue-500/[0.04] blur-[100px] pointer-events-none" />

        <div className="relative max-w-6xl mx-auto px-6">
          <motion.div
            initial="hidden"
            animate="visible"
            className="max-w-3xl"
          >
            {/* Eyebrow */}
            <motion.div variants={fade} custom={0} className="mb-6">
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium tracking-wide uppercase bg-dd-gold-400/10 text-dd-gold-400 border border-dd-gold-400/15">
                <span className="w-1.5 h-1.5 rounded-full bg-dd-gold-400 animate-pulse-glow" />
                Built for Laser Creators
              </span>
            </motion.div>

            {/* Headline */}
            <motion.h1
              variants={fade}
              custom={1}
              className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold leading-[1.08] tracking-tight mb-6"
            >
              Image to laser-ready{" "}
              <span className="text-gradient-gold">vector</span>{" "}
              in seconds
            </motion.h1>

            {/* Sub */}
            <motion.p
              variants={fade}
              custom={2}
              className="text-lg md:text-xl text-foreground-muted leading-relaxed max-w-xl mb-10"
            >
              Drop any photo. Get layered SVGs mapped directly to your LightBurn
              or Falcon Pro layers. No tracing skills. No Illustrator. Just upload,
              tune, and cut.
            </motion.p>

            {/* CTA */}
            <motion.div variants={fade} custom={3} className="flex flex-wrap gap-4">
              <Link
                href="/login"
                className="group inline-flex items-center gap-2 px-7 py-3.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-dd-gold-500 to-dd-gold-400 text-[#080B12] shadow-lg glow-gold-strong hover:shadow-xl transition-all duration-300 hover:scale-[1.02]"
              >
                Start Creating
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <a
                href="#how-it-works"
                className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl text-sm font-semibold border border-border hover:border-dd-blue-400/40 text-foreground-muted hover:text-dd-blue-400 transition-all duration-200"
              >
                See How It Works
              </a>
            </motion.div>
          </motion.div>

          {/* Hero visual — transformation preview */}
          <motion.div
            variants={fade}
            initial="hidden"
            animate="visible"
            custom={4}
            className="mt-16 md:mt-24 relative"
          >
            <div className="glass rounded-2xl border border-border/50 p-1.5 glow-gold">
              <div className="rounded-xl bg-background-raised overflow-hidden">
                <div className="grid grid-cols-1 md:grid-cols-2">
                  {/* Before */}
                  <div className="p-8 md:p-12 flex flex-col items-center justify-center border-b md:border-b-0 md:border-r border-border-subtle">
                    <span className="text-xs uppercase tracking-widest text-foreground-muted mb-4 font-medium">Original Bitmap</span>
                    <div className="w-48 h-48 rounded-xl bg-background-overlay border border-border-subtle flex items-center justify-center relative overflow-hidden">
                      {/* Simulated raster image blocks */}
                      <div className="grid grid-cols-8 grid-rows-8 gap-px w-36 h-36 opacity-60">
                        {Array.from({ length: 64 }).map((_, i) => (
                          <div
                            key={i}
                            className="rounded-[1px]"
                            style={{
                              backgroundColor: [
                                "#F5A623", "#2567B2", "#1C5194", "#E08E0B",
                                "#9E5409", "#3B8DE8", "#6FADF5", "#C47206"
                              ][i % 8],
                              opacity: 0.3 + (Math.sin(i * 0.7) * 0.5 + 0.5) * 0.7,
                            }}
                          />
                        ))}
                      </div>
                      <div className="absolute inset-0 bg-gradient-to-t from-background-raised/60 to-transparent" />
                    </div>
                    <span className="mt-3 text-sm text-foreground-muted">photo.png</span>
                  </div>

                  {/* After */}
                  <div className="p-8 md:p-12 flex flex-col items-center justify-center relative">
                    <span className="text-xs uppercase tracking-widest text-dd-gold-400 mb-4 font-medium">Layered Vector</span>
                    <div className="w-48 h-48 rounded-xl border border-dd-gold-400/20 bg-background-overlay flex items-center justify-center relative overflow-hidden">
                      <svg width="120" height="120" viewBox="0 0 120 120" fill="none" className="opacity-80">
                        {/* Layer 1 — blue */}
                        <path d="M20 90 Q30 30 60 25 Q90 30 100 90" stroke="#2567B2" strokeWidth="2" fill="none" className="animate-trace" />
                        {/* Layer 2 — gold */}
                        <path d="M30 85 Q40 40 60 35 Q80 40 90 85" stroke="#F5A623" strokeWidth="2" fill="none" className="animate-trace" style={{ animationDelay: "0.5s" }} />
                        {/* Layer 3 — detail */}
                        <circle cx="60" cy="55" r="15" stroke="#6FADF5" strokeWidth="1.5" fill="none" className="animate-trace" style={{ animationDelay: "1s" }} />
                        <circle cx="60" cy="55" r="8" stroke="#FDD889" strokeWidth="1.5" fill="none" className="animate-trace" style={{ animationDelay: "1.3s" }} />
                      </svg>
                      <div className="absolute bottom-2 right-2 flex gap-1">
                        {["#2567B2", "#F5A623", "#6FADF5", "#FDD889"].map((c, i) => (
                          <div key={i} className="w-2.5 h-2.5 rounded-full border border-white/10" style={{ backgroundColor: c }} />
                        ))}
                      </div>
                    </div>
                    <span className="mt-3 text-sm text-dd-gold-400 font-medium">4 layers ready</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Arrow between panels */}
            <div className="hidden md:flex absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-dd-gold-400 items-center justify-center shadow-lg glow-gold-strong z-10">
              <ArrowRight className="w-5 h-5 text-[#080B12]" />
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section id="how-it-works" className="py-24 md:py-32 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-dd-blue-500/[0.02] to-transparent pointer-events-none" />
        <div className="relative max-w-6xl mx-auto px-6">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            className="text-center mb-16"
          >
            <motion.p variants={fade} custom={0} className="text-xs uppercase tracking-widest text-dd-blue-400 font-medium mb-3">
              Three Steps
            </motion.p>
            <motion.h2 variants={fade} custom={1} className="text-3xl md:text-4xl font-bold tracking-tight">
              Upload. Tune. Cut.
            </motion.h2>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            className="grid grid-cols-1 md:grid-cols-3 gap-6"
          >
            {[
              {
                icon: Upload,
                step: "01",
                title: "Drop Your Image",
                desc: "PNG, JPG, or WEBP — any photo, sketch, or design. No size limits, no format headaches.",
                accent: "gold" as const,
              },
              {
                icon: SlidersHorizontal,
                step: "02",
                title: "Tune Your Layers",
                desc: "Choose how many laser layers, adjust smoothness, reduce noise. See the vector update in real time.",
                accent: "blue" as const,
              },
              {
                icon: Download,
                step: "03",
                title: "Export & Engrave",
                desc: "Download layered SVG optimized for LightBurn and Falcon Pro. Each color = one laser operation.",
                accent: "gold" as const,
              },
            ].map((item, i) => (
              <motion.div
                key={item.step}
                variants={fade}
                custom={i}
                className={`group relative rounded-2xl border border-border bg-card p-8 transition-all duration-300 hover:border-dd-${item.accent === "gold" ? "gold" : "blue"}-400/30 hover:bg-card-hover`}
              >
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-5 ${
                  item.accent === "gold"
                    ? "bg-dd-gold-400/10 text-dd-gold-400"
                    : "bg-dd-blue-400/10 text-dd-blue-400"
                }`}>
                  <item.icon className="w-5 h-5" />
                </div>
                <span className={`text-xs font-mono font-bold ${
                  item.accent === "gold" ? "text-dd-gold-400/50" : "text-dd-blue-400/50"
                }`}>
                  {item.step}
                </span>
                <h3 className="text-xl font-semibold mt-1 mb-2">{item.title}</h3>
                <p className="text-foreground-muted text-sm leading-relaxed">{item.desc}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── WHY VECTOREASE ── */}
      <section className="py-24 md:py-32 relative">
        <div className="max-w-6xl mx-auto px-6">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            className="text-center mb-16"
          >
            <motion.p variants={fade} custom={0} className="text-xs uppercase tracking-widest text-dd-gold-400 font-medium mb-3">
              Purpose-Built
            </motion.p>
            <motion.h2 variants={fade} custom={1} className="text-3xl md:text-4xl font-bold tracking-tight">
              Why makers choose VectorEase
            </motion.h2>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {[
              {
                icon: Layers,
                title: "True Layer Separation",
                desc: "Each color in your vector maps directly to a LightBurn layer. No manual cleanup, no guessing which path belongs where.",
              },
              {
                icon: Zap,
                title: "Instant Vectorization",
                desc: "Client-side processing means your images never leave your machine. Fast, private, no upload wait times.",
              },
              {
                icon: Target,
                title: "Laser-Optimized Output",
                desc: "Path smoothing, noise reduction, and artifact removal tuned specifically for clean laser engraving results.",
              },
            ].map((item, i) => (
              <motion.div
                key={item.title}
                variants={fade}
                custom={i}
                className="relative rounded-2xl border border-border bg-card p-8 transition-all duration-300 hover:border-dd-gold-400/20 hover:bg-card-hover"
              >
                <div className="w-12 h-12 rounded-xl bg-dd-blue-400/10 text-dd-blue-400 flex items-center justify-center mb-5">
                  <item.icon className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-semibold mb-2">{item.title}</h3>
                <p className="text-foreground-muted text-sm leading-relaxed">{item.desc}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-24 md:py-32">
        <div className="max-w-6xl mx-auto px-6">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            className="relative rounded-2xl border border-dd-gold-400/20 bg-card overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-80 h-80 bg-dd-gold-400/[0.06] rounded-full blur-[100px] pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-60 h-60 bg-dd-blue-500/[0.06] rounded-full blur-[80px] pointer-events-none" />

            <div className="relative p-12 md:p-16 text-center">
              <motion.h2 variants={fade} custom={0} className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
                Ready to skip the complexity?
              </motion.h2>
              <motion.p variants={fade} custom={1} className="text-foreground-muted text-lg max-w-lg mx-auto mb-8">
                Stop fighting Inkscape. Go from photo to laser bed in under a minute.
              </motion.p>
              <motion.div variants={fade} custom={2}>
                <Link
                  href="/login"
                  className="group inline-flex items-center gap-2 px-8 py-4 rounded-xl text-sm font-semibold bg-gradient-to-r from-dd-gold-500 to-dd-gold-400 text-[#080B12] shadow-lg glow-gold-strong hover:shadow-xl transition-all duration-300 hover:scale-[1.02]"
                >
                  Get Started Free
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </motion.div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t border-border py-10">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-dd-gold-400 to-dd-gold-600 flex items-center justify-center">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                <path d="M4 4L12 20L20 4" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="text-sm font-semibold">VectorEase</span>
          </div>
          <p className="text-xs text-foreground-muted">
            &copy; {new Date().getFullYear()} Dan Deigan. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
