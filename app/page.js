"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, ChevronRight } from "lucide-react";
import Button from "@/components/ui/Button";

// Logo component
function Logo({ size = "md" }) {
  const sizes = {
    sm: { box: 28, text: 20 },
    md: { box: 30, text: 21 },
  };
  const s = sizes[size] || sizes.md;
  return (
    <Link href="/" className="flex items-center gap-2.5 no-underline">
      <span
        className="rounded-lg grid place-items-center text-white"
        style={{
          width: s.box,
          height: s.box,
          background: "var(--brand)",
          fontFamily: "var(--font-display)",
          fontWeight: 800,
          fontSize: s.box * 0.6,
          boxShadow: "var(--shadow-brand)",
        }}
      >
        F
      </span>
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          fontSize: s.text,
          letterSpacing: "-0.02em",
          color: "var(--ink)",
        }}
      >
        Factur<span style={{ color: "var(--brand)" }}>i</span>n
      </span>
    </Link>
  );
}

// Hero section
function HeroSection() {
  return (
    <section className="relative min-h-screen overflow-hidden" style={{ background: "var(--espresso-900)" }}>
      {/* Animated background */}
      <div className="absolute inset-[-12%] z-0 blur-[8px]">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0C4824] via-[#0F7A38] via-[26%] via-[#5E9A3C] via-[44%] via-[#F5A524] via-[68%] to-[#B23D14]" />
        <div
          className="absolute w-[46%] h-[60%] -left-[6%] -top-[10%] rounded-full"
          style={{
            background: "radial-gradient(circle, #0C4824 0%, rgba(12,72,36,0) 70%)",
            animation: "fct-drift 17s ease-in-out infinite",
          }}
        />
        <div
          className="absolute w-[55%] h-[70%] -right-[8%] -bottom-[14%] rounded-full"
          style={{
            background: "radial-gradient(circle, #F2683F 0%, rgba(242,104,63,0) 68%)",
            animation: "fct-drift2 21s ease-in-out infinite",
          }}
        />
        <div
          className="absolute w-[40%] h-[50%] right-[18%] -top-[6%] rounded-full"
          style={{
            background: "radial-gradient(circle, #F5A524 0%, rgba(245,165,36,0) 70%)",
            animation: "fct-drift 24s ease-in-out infinite",
          }}
        />
        <div
          className="absolute inset-0 mix-blend-soft-light opacity-50"
          style={{ background: "repeating-linear-gradient(108deg, rgba(255,255,255,.10) 0 2px, transparent 2px 13px)" }}
        />
      </div>

      {/* Vignettes */}
      <div
        className="absolute inset-0 z-[1]"
        style={{ background: "linear-gradient(98deg, rgba(7,28,12,.62) 0%, rgba(7,28,12,.30) 32%, rgba(7,28,12,0) 60%)" }}
      />
      <div
        className="absolute inset-x-0 top-0 h-40 z-[1]"
        style={{ background: "linear-gradient(180deg, rgba(7,28,12,.34), transparent)" }}
      />

      {/* Content */}
      <div className="relative z-[2] max-w-[1240px] mx-auto px-8">
        {/* Nav */}
        <header
          className="flex items-center gap-4 mt-[22px] py-2 pr-2 pl-[22px] rounded-full"
          style={{
            background: "rgba(251,250,247,.92)",
            backdropFilter: "blur(10px)",
            border: "1px solid rgba(255,255,255,.5)",
            boxShadow: "0 10px 34px -12px rgba(12,40,15,.5)",
          }}
        >
          <Logo size="sm" />
          <nav className="hidden md:flex items-center gap-1 ml-2">
            {["Producto", "Como funciona", "Precios", "Empresas"].map((item) => (
              <a
                key={item}
                href="#"
                className="py-2 px-3.5 rounded-full text-[15px] font-medium no-underline transition-colors"
                style={{ color: "var(--text-body)" }}
              >
                {item}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="quiet" size="sm" as={Link} href="/api/auth/signin?callbackUrl=/dashboard">
              Iniciar sesion
            </Button>
            <Button variant="primary" size="sm" arrow as={Link} href="/api/auth/signin?callbackUrl=/dashboard">
              Crear cuenta
            </Button>
          </div>
        </header>

        {/* Hero grid */}
        <div className="grid md:grid-cols-2 gap-12 items-center py-20 md:py-[92px] min-h-[calc(100vh-120px)]">
          {/* Left: copy */}
          <div>
            <h1
              className="m-0 text-white"
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 800,
                fontSize: "clamp(54px, 6.6vw, 96px)",
                lineHeight: 0.95,
                letterSpacing: "-0.035em",
              }}
            >
              Foto del ticket.
              <br />
              Tu factura,
              <br />
              automatica.
            </h1>
            <p className="mt-7 max-w-[478px] text-xl leading-relaxed" style={{ color: "rgba(243,239,232,.92)" }}>
              Subele la foto de tu ticket y Facturin lee los datos, valida tu RFC y genera el CFDI por ti. Sin capturar nada a mano.
            </p>
            <div className="flex items-center gap-3.5 flex-wrap mt-8">
              <Button variant="primary" size="lg" arrow as={Link} href="/api/auth/signin?callbackUrl=/dashboard">
                Comenzar gratis
              </Button>
              <span className="text-sm font-medium" style={{ color: "rgba(243,239,232,.78)" }}>
                Gratis los primeros 10 tickets
              </span>
            </div>
            <div className="flex items-center gap-2.5 mt-16">
              <span className="w-[9px] h-[9px] rounded-sm flex-none" style={{ background: "var(--accent-coral)" }} />
              <span
                className="text-xs font-semibold uppercase"
                style={{ letterSpacing: "0.08em", color: "rgba(243,239,232,.72)" }}
              >
                Hecho en Mexico - CFDI 4.0 valido ante el SAT
              </span>
            </div>
          </div>

          {/* Right: demo card */}
          <div className="justify-self-end w-full max-w-[452px]" style={{ animation: "fct-float 7s ease-in-out infinite" }}>
            <div
              className="rounded-[var(--radius-2xl)] overflow-hidden"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-subtle)",
                boxShadow: "0 40px 80px -24px rgba(12,40,15,.5), 0 12px 28px -14px rgba(12,40,15,.3)",
              }}
            >
              {/* Card header */}
              <div
                className="flex items-center gap-3 py-4 px-5"
                style={{ borderBottom: "1px solid var(--border-subtle)" }}
              >
                <span
                  className="w-[34px] h-[34px] rounded-[9px] grid place-items-center text-white flex-none"
                  style={{
                    background: "var(--brand)",
                    fontFamily: "var(--font-display)",
                    fontWeight: 800,
                    fontSize: 18,
                  }}
                >
                  F
                </span>
                <div className="flex flex-col leading-tight">
                  <span className="font-bold text-[15px]" style={{ color: "var(--text-strong)" }}>
                    Facturin
                  </span>
                  <span className="flex items-center gap-1.5 text-[12.5px]" style={{ color: "var(--text-muted)" }}>
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: "var(--brand)", animation: "fct-blink 1.3s ease-in-out infinite" }}
                    />
                    Leyendo tu ticket...
                  </span>
                </div>
                <div className="ml-auto flex items-end gap-[3px] h-[18px]">
                  {[60, 100, 50, 80].map((h, i) => (
                    <span
                      key={i}
                      className="w-[3px] rounded-sm origin-bottom"
                      style={{
                        height: `${h}%`,
                        background: "var(--accent-amber)",
                        animation: `fct-wave 1s ease-in-out ${i * 0.15}s infinite`,
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Card body */}
              <div className="p-5">
                <div className="flex items-center gap-3.5 mb-4">
                  {/* Receipt thumbnail */}
                  <div
                    className="relative w-[84px] h-[104px] rounded-xl flex-none overflow-hidden"
                    style={{
                      border: "1px solid var(--border-default)",
                      background: "repeating-linear-gradient(135deg, #EEEBE2 0 7px, #F6F4EE 7px 14px)",
                    }}
                  >
                    <div className="absolute inset-0 p-2.5 flex flex-col gap-1.5">
                      <span className="h-1.5 w-[70%] rounded-sm" style={{ background: "rgba(26,23,20,.22)" }} />
                      <span className="h-1 w-[48%] rounded-sm" style={{ background: "rgba(26,23,20,.16)" }} />
                      <span className="h-1 w-[60%] rounded-sm mt-auto" style={{ background: "rgba(26,23,20,.16)" }} />
                      <span className="h-1 w-[40%] rounded-sm" style={{ background: "rgba(26,23,20,.16)" }} />
                    </div>
                    <span
                      className="absolute left-1.5 bottom-1.5 font-mono text-[8.5px]"
                      style={{ letterSpacing: "0.05em", color: "var(--text-faint)" }}
                    >
                      FOTO.JPG
                    </span>
                  </div>
                  <span
                    className="w-7 h-7 rounded-full grid place-items-center flex-none"
                    style={{ background: "var(--bg-inset)", color: "var(--text-muted)" }}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </span>
                  <div className="flex-1 flex flex-col gap-2">
                    {[
                      { label: "Comercio", value: "OXXO" },
                      { label: "RFC emisor", value: "OXX970814HS9", mono: true },
                      { label: "Folio", value: "A-10482", mono: true },
                    ].map((row) => (
                      <div key={row.label} className="flex justify-between items-baseline">
                        <span className="text-[12.5px]" style={{ color: "var(--text-muted)" }}>
                          {row.label}
                        </span>
                        <span
                          className={`text-sm font-semibold ${row.mono ? "font-mono text-[12.5px]" : ""}`}
                          style={{ color: row.mono ? "var(--text-body)" : "var(--text-strong)" }}
                        >
                          {row.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Total */}
                <div
                  className="flex justify-between items-center py-3 px-4 rounded-[var(--radius-md)] mb-3"
                  style={{ background: "var(--bg-subtle)" }}
                >
                  <span className="text-[13px] font-semibold" style={{ color: "var(--text-muted)" }}>
                    Total
                  </span>
                  <span className="font-mono text-[17px] font-bold" style={{ color: "var(--text-strong)" }}>
                    $284.50 MXN
                  </span>
                </div>

                {/* Success strip */}
                <div
                  className="flex items-center gap-2 py-3 px-4 rounded-[var(--radius-md)]"
                  style={{ background: "var(--brand-soft)", color: "var(--success-text)" }}
                >
                  <span
                    className="w-5 h-5 rounded-full grid place-items-center text-white flex-none"
                    style={{ background: "var(--brand)" }}
                  >
                    <Check className="w-3 h-3" strokeWidth={3} />
                  </span>
                  <span className="text-[13.5px] font-semibold">CFDI generado - listo para descargar</span>
                </div>
              </div>

              {/* Card footer */}
              <div className="px-5 pb-4">
                <Button variant="secondary" size="md" arrow fullWidth>
                  Ver como funciona
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// Merchants carousel
function MerchantsSection() {
  const merchants = [
    { name: "OXXO", style: { color: "#E4002B", fontWeight: 800 } },
    { name: "Costco.", style: { color: "#005DAA", fontWeight: 800 }, dot: "#E4002B" },
    { name: "Walmart", style: { color: "#0071CE", fontWeight: 700 }, icon: "\u2738", iconColor: "#FFC220" },
    { name: "7-Eleven", style: { color: "#008061", fontWeight: 700 }, badge: true },
    { name: "AlSuper", style: { fontWeight: 800 }, sub: "Chihuahua" },
  ];

  return (
    <section className="py-16" style={{ background: "var(--bg-page)" }}>
      <p
        className="text-center mb-10 text-[13px] font-semibold uppercase px-8"
        style={{ letterSpacing: "0.1em", color: "var(--text-muted)" }}
      >
        Factura tus compras en los comercios de siempre
      </p>
      <div
        className="relative overflow-hidden"
        style={{
          WebkitMaskImage: "linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)",
          maskImage: "linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)",
        }}
      >
        <div
          className="flex w-max"
          style={{ animation: "fct-marquee 26s linear infinite" }}
        >
          {[0, 1].map((track) => (
            <div key={track} className="flex items-center gap-20 pr-20" aria-hidden={track === 1}>
              {merchants.map((m, i) => (
                <span key={`${track}-${i}`} className="whitespace-nowrap flex items-center gap-2" style={{ fontFamily: "var(--font-display)", fontSize: 30, ...m.style }}>
                  {m.icon && <span style={{ fontSize: 22, color: m.iconColor }}>{m.icon}</span>}
                  {m.badge && (
                    <span className="w-9 h-9 rounded-lg grid place-items-center text-[19px]" style={{ background: "#F47521", color: "#008061", fontWeight: 800 }}>
                      7
                    </span>
                  )}
                  {m.sub ? (
                    <span className="flex flex-col leading-none">
                      <span>
                        Al<span style={{ color: "#E4002B" }}>Super</span>
                      </span>
                      <span className="text-[9.5px] font-semibold uppercase mt-1" style={{ letterSpacing: "0.14em", color: "var(--text-faint)" }}>
                        {m.sub}
                      </span>
                    </span>
                  ) : m.badge ? (
                    <span style={{ fontSize: 23 }}>Eleven</span>
                  ) : m.dot ? (
                    <span>
                      {m.name.slice(0, -1)}<span style={{ color: m.dot }}>.</span>
                    </span>
                  ) : (
                    m.name
                  )}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// How it works section
function HowItWorksSection() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      const el = document.getElementById("fctHiwWrap");
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const total = el.offsetHeight - window.innerHeight;
      const p = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 0;
      setStep(p >= 0.66 ? 2 : p >= 0.33 ? 1 : 0);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const steps = [
    {
      num: "01",
      title: "Sube tu CSF",
      desc: "Subele tu Constancia de Situacion Fiscal una sola vez. Facturin arma tu perfil: RFC, razon social y regimen.",
    },
    {
      num: "02",
      title: "Toma la foto del ticket",
      desc: "Facturin lee la imagen y extrae comercio, folio, subtotal y total — todo validado contra el SAT en segundos.",
    },
    {
      num: "03",
      title: "Descarga tu CFDI",
      desc: "Recibes el CFDI 4.0 valido en PDF y XML, listo para tu contabilidad. Sin capturar nada a mano.",
    },
  ];

  return (
    <section style={{ background: "var(--bg-page)" }}>
      <div className="max-w-[1200px] mx-auto px-8 pt-[130px] pb-2">
        <div className="max-w-[820px]">
          <span
            className="inline-flex items-center gap-2 text-xs font-semibold uppercase"
            style={{ letterSpacing: "0.12em", color: "var(--brand)" }}
          >
            <span className="w-2 h-2 rounded-sm" style={{ background: "var(--brand)" }} />
            Como funciona
          </span>
          <h2
            className="mt-5"
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              fontSize: "clamp(40px, 5.4vw, 72px)",
              lineHeight: 0.98,
              letterSpacing: "-0.04em",
              color: "var(--text-strong)",
            }}
          >
            Tres pasos.
            <br />
            Cero captura manual.
          </h2>
          <p className="mt-5 max-w-[520px] text-xl leading-relaxed" style={{ color: "var(--text-body)" }}>
            Configuras tu perfil fiscal una vez. Despues, cada ticket es solo una foto — Facturin hace el resto.
          </p>
        </div>
      </div>

      {/* Pinned scroller */}
      <div id="fctHiwWrap" className="relative h-[300vh]">
        <div className="sticky top-0 min-h-screen max-w-[1200px] mx-auto grid lg:grid-cols-[0.82fr_1.18fr] gap-[60px] items-center p-12">
          {/* Steps */}
          <div>
            {steps.map((s, i) => (
              <div
                key={i}
                className={`grid grid-cols-[auto_1fr] gap-5 py-6 cursor-pointer transition-opacity duration-300 ${
                  step === i ? "opacity-100" : "opacity-40"
                } ${i > 0 ? "border-t border-[var(--border-default)]" : ""}`}
                onClick={() => {
                  const el = document.getElementById("fctHiwWrap");
                  if (!el) return;
                  const total = el.offsetHeight - window.innerHeight;
                  const top = window.scrollY + el.getBoundingClientRect().top + total * (i / 3) + 6;
                  window.scrollTo({ top, behavior: "smooth" });
                }}
              >
                <span
                  className={`font-mono text-sm font-semibold pt-1 ${step === i ? "text-[var(--brand)]" : "text-[var(--text-muted)]"}`}
                >
                  {s.num}
                </span>
                <div>
                  <h3
                    className="m-0"
                    style={{
                      fontFamily: "var(--font-display)",
                      fontWeight: 700,
                      fontSize: 25,
                      letterSpacing: "-0.02em",
                      color: "var(--text-strong)",
                    }}
                  >
                    {s.title}
                  </h3>
                  <p
                    className={`m-0 text-[15.5px] leading-relaxed overflow-hidden transition-all duration-[450ms] ${
                      step === i ? "max-h-36 opacity-100 mt-2.5" : "max-h-0 opacity-0"
                    }`}
                    style={{ color: "var(--text-body)" }}
                  >
                    {s.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Stage */}
          <div
            className="relative w-full aspect-[4/3] rounded-[var(--radius-2xl)] overflow-hidden"
            style={{ background: "var(--bg-inset)", boxShadow: "0 50px 90px -40px rgba(12,40,15,.45)" }}
          >
            {/* Visual 1 */}
            <div
              className={`absolute inset-0 transition-opacity duration-200 ${step === 0 ? "opacity-100" : "opacity-0"}`}
              style={{ background: "linear-gradient(150deg, #0F7A38 0%, #0C4824 60%, #072813 100%)" }}
            >
              <div className="absolute inset-0 grid place-items-center p-[8%]">
                <div
                  className="w-[74%] max-w-[340px] rounded-[var(--radius-lg)] overflow-hidden"
                  style={{
                    background: "var(--bg-surface)",
                    boxShadow: "0 36px 70px -22px rgba(0,0,0,.5)",
                    transform: "rotate(-1.5deg)",
                  }}
                >
                  <div className="flex items-center gap-2 py-4 px-4 border-b border-[var(--border-subtle)]">
                    <span className="w-7 h-7 rounded-lg grid place-items-center text-[15px]" style={{ background: "var(--brand-soft)", color: "var(--brand)" }}>
                      <span className="text-lg">&#128196;</span>
                    </span>
                    <span className="text-sm font-bold" style={{ color: "var(--text-strong)" }}>
                      Constancia de Situacion Fiscal
                    </span>
                  </div>
                  <div className="p-4 flex flex-col gap-3">
                    {[
                      { label: "RFC", value: "GODE920817H1A", mono: true },
                      { label: "Razon social", value: "Elena Godinez" },
                      { label: "Regimen", value: "Sueldos y salarios" },
                    ].map((row) => (
                      <div key={row.label} className="flex justify-between">
                        <span className="text-[13px]" style={{ color: "var(--text-muted)" }}>{row.label}</span>
                        <span className={`text-[13px] font-semibold ${row.mono ? "font-mono" : ""}`} style={{ color: "var(--text-body)" }}>
                          {row.value}
                        </span>
                      </div>
                    ))}
                    <div
                      className="flex items-center gap-2 mt-1 py-2.5 px-3 rounded-sm"
                      style={{ background: "var(--brand-soft)", color: "var(--success-text)" }}
                    >
                      <span className="w-4 h-4 rounded-full grid place-items-center text-white text-[11px]" style={{ background: "var(--brand)" }}>
                        <Check className="w-2.5 h-2.5" strokeWidth={3} />
                      </span>
                      <span className="text-[12.5px] font-semibold">Perfil fiscal listo</span>
                    </div>
                  </div>
                </div>
              </div>
              <span
                className="absolute left-6 bottom-6 inline-flex items-center font-mono text-[13px] font-semibold text-white py-2 px-4 rounded-full"
                style={{ background: "rgba(7,28,12,.5)", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,.18)" }}
              >
                01 - Sube tu CSF
              </span>
            </div>

            {/* Visual 2 */}
            <div
              className={`absolute inset-0 transition-opacity duration-200 ${step === 1 ? "opacity-100" : "opacity-0"}`}
              style={{ background: "linear-gradient(150deg, #F5A524 0%, #C9711A 58%, #7C3E0C 100%)" }}
            >
              <div className="absolute inset-0 flex items-center justify-center gap-8 p-[8%]">
                <div
                  className="relative w-40 h-52 rounded-2xl flex-none overflow-hidden"
                  style={{
                    border: "1px solid rgba(255,255,255,.35)",
                    background: "repeating-linear-gradient(135deg, #EEEBE2 0 8px, #F6F4EE 8px 16px)",
                    boxShadow: "0 28px 54px -18px rgba(0,0,0,.5)",
                  }}
                >
                  <div className="absolute inset-0 p-5 flex flex-col gap-2">
                    {[72, 50, 60, 42].map((w, i) => (
                      <span
                        key={i}
                        className={`h-2 rounded-sm ${i > 1 ? "mt-auto" : ""}`}
                        style={{ width: `${w}%`, background: `rgba(26,23,20,${i === 0 ? 0.24 : 0.16})` }}
                      />
                    ))}
                  </div>
                  <div
                    className="absolute left-0 right-0 h-[3px] bg-white"
                    style={{ boxShadow: "0 0 16px 3px rgba(255,255,255,.9)", animation: "fct-scan 2.2s ease-in-out infinite" }}
                  />
                </div>
                <div className="flex flex-col gap-3 whitespace-nowrap">
                  <span className="text-[11px] font-bold uppercase" style={{ letterSpacing: "0.1em", color: "rgba(255,255,255,.75)" }}>
                    Leyendo ticket
                  </span>
                  {[
                    { label: "Comercio", value: "OXXO" },
                    { label: "Folio", value: "A-10482", mono: true },
                    { label: "Total", value: "$284.50", mono: true, bold: true },
                  ].map((row) => (
                    <div key={row.label} className="flex justify-between gap-7">
                      <span className="text-sm" style={{ color: "rgba(255,255,255,.75)" }}>{row.label}</span>
                      <span className={`text-sm ${row.mono ? "font-mono" : ""} ${row.bold ? "font-bold text-[15px]" : "font-bold"} text-white`}>
                        {row.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <span
                className="absolute left-6 bottom-6 inline-flex items-center font-mono text-[13px] font-semibold text-white py-2 px-4 rounded-full"
                style={{ background: "rgba(7,28,12,.5)", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,.18)" }}
              >
                02 - Toma la foto
              </span>
            </div>

            {/* Visual 3 */}
            <div
              className={`absolute inset-0 transition-opacity duration-200 ${step === 2 ? "opacity-100" : "opacity-0"}`}
              style={{ background: "linear-gradient(150deg, #16A34A 0%, #0C6F33 58%, #04280F 100%)" }}
            >
              <div className="absolute inset-0 grid place-items-center p-[8%]">
                <div
                  className="w-[74%] max-w-[340px] rounded-[var(--radius-lg)] overflow-hidden"
                  style={{
                    background: "var(--bg-surface)",
                    boxShadow: "0 36px 70px -22px rgba(0,0,0,.5)",
                    transform: "rotate(1.5deg)",
                  }}
                >
                  <div className="flex items-center gap-2.5 py-5 px-5">
                    <span className="w-8 h-8 rounded-full grid place-items-center text-white" style={{ background: "var(--brand)" }}>
                      <Check className="w-4 h-4" strokeWidth={3} />
                    </span>
                    <span className="text-[15px] font-bold" style={{ color: "var(--text-strong)" }}>
                      CFDI 4.0 generado
                    </span>
                  </div>
                  <div className="px-5 pb-5 flex flex-col gap-3">
                    {[
                      { ext: "PDF", name: "factura.pdf", color: "var(--accent-coral)" },
                      { ext: "XML", name: "factura.xml", color: "var(--brand)" },
                    ].map((file) => (
                      <div
                        key={file.ext}
                        className="flex items-center gap-3 py-3 px-3 rounded-sm"
                        style={{ border: "1px solid var(--border-subtle)" }}
                      >
                        <span
                          className="font-mono text-[10px] font-bold text-white py-0.5 px-2 rounded"
                          style={{ background: file.color }}
                        >
                          {file.ext}
                        </span>
                        <span className="text-[13.5px] font-semibold" style={{ color: "var(--text-body)" }}>
                          {file.name}
                        </span>
                        <span className="ml-auto" style={{ color: "var(--text-muted)" }}>
                          &#8595;
                        </span>
                      </div>
                    ))}
                    <div
                      className="flex items-center gap-2 mt-0.5 py-2.5 px-3 rounded-sm"
                      style={{ background: "var(--brand-soft)", color: "var(--success-text)" }}
                    >
                      <span className="text-sm">&#128737;</span>
                      <span className="text-[12.5px] font-semibold">Valido ante el SAT</span>
                    </div>
                  </div>
                </div>
              </div>
              <span
                className="absolute left-6 bottom-6 inline-flex items-center font-mono text-[13px] font-semibold text-white py-2 px-4 rounded-full"
                style={{ background: "rgba(7,28,12,.5)", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,.18)" }}
              >
                03 - Descarga tu CFDI
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// Footer
function FooterSection() {
  const links = {
    Producto: ["Como funciona", "Precios", "Comercios", "Para empresas"],
    Recursos: ["Centro de ayuda", "Guia del CFDI 4.0", "Estado del SAT", "API para developers"],
    Empresa: ["Nosotros", "Blog", "Contacto", "Privacidad y terminos"],
  };

  return (
    <footer style={{ background: "var(--espresso-900)", color: "rgba(243,239,232,.72)" }}>
      <div className="max-w-[1200px] mx-auto px-8 py-20">
        {/* CTA */}
        <div
          className="flex flex-wrap items-center justify-between gap-7 pb-16"
          style={{ borderBottom: "1px solid rgba(255,255,255,.12)" }}
        >
          <h2
            className="m-0 max-w-[620px]"
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              fontSize: "clamp(32px, 3.8vw, 48px)",
              lineHeight: 1.02,
              letterSpacing: "-0.03em",
              color: "#fff",
            }}
          >
            Deja de capturar facturas a mano.
          </h2>
          <div className="flex items-center gap-3.5 flex-wrap">
            <Button variant="primary" size="lg" arrow as={Link} href="/api/auth/signin?callbackUrl=/dashboard">
              Comenzar gratis
            </Button>
            <span className="text-sm font-medium" style={{ color: "rgba(243,239,232,.6)" }}>
              Gratis los primeros 10 tickets
            </span>
          </div>
        </div>

        {/* Link grid */}
        <div className="grid grid-cols-2 md:grid-cols-[1.6fr_1fr_1fr_1fr] gap-10 py-14">
          {/* Brand */}
          <div className="max-w-[300px] col-span-2 md:col-span-1">
            <Link href="/" className="flex items-center gap-2.5 no-underline">
              <span
                className="w-[30px] h-[30px] rounded-lg grid place-items-center text-white"
                style={{ background: "var(--brand)", fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 18 }}
              >
                F
              </span>
              <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 21, letterSpacing: "-0.02em", color: "#fff" }}>
                Factur<span style={{ color: "var(--brand)" }}>i</span>n
              </span>
            </Link>
            <p className="mt-4 text-[15px] leading-relaxed" style={{ color: "rgba(243,239,232,.6)" }}>
              Foto del ticket - tu factura, automatica. CFDI 4.0 valido ante el SAT, sin capturar nada a mano.
            </p>
          </div>

          {/* Link columns */}
          {Object.entries(links).map(([title, items]) => (
            <div key={title} className="flex flex-col gap-3.5">
              <span
                className="text-xs font-semibold uppercase"
                style={{ letterSpacing: "0.1em", color: "rgba(243,239,232,.45)" }}
              >
                {title}
              </span>
              {items.map((item) => (
                <a
                  key={item}
                  href="#"
                  className="text-[15px] no-underline hover:text-white transition-colors"
                  style={{ color: "rgba(243,239,232,.72)" }}
                >
                  {item}
                </a>
              ))}
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div
          className="flex flex-wrap items-center justify-between gap-4 pt-8"
          style={{ borderTop: "1px solid rgba(255,255,255,.12)" }}
        >
          <span className="text-[13.5px]" style={{ color: "rgba(243,239,232,.5)" }}>
            2026 Facturin - CFDI 4.0 valido ante el SAT - Hecho en Mexico
          </span>
          <div className="flex items-center gap-2.5">
            {[{ label: "X", icon: "\uD835\uDD4F" }, { label: "Instagram", icon: "\u25CE" }, { label: "LinkedIn", icon: "in" }].map((s) => (
              <a
                key={s.label}
                href="#"
                aria-label={s.label}
                className="w-9 h-9 rounded-full grid place-items-center text-sm no-underline transition-all border"
                style={{
                  borderColor: "rgba(255,255,255,.16)",
                  color: "rgba(243,239,232,.72)",
                }}
              >
                {s.icon}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}

export default function Home() {
  return (
    <>
      <HeroSection />
      <MerchantsSection />
      <HowItWorksSection />
      <FooterSection />
    </>
  );
}
