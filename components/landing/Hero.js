"use client";

import Link from "next/link";
import { Check, ChevronRight } from "lucide-react";
import Button from "@/components/ui/Button";
import Logo from "./Logo";

export default function Hero() {
  return (
    <section id="top" className="relative min-h-screen overflow-hidden bg-[var(--espresso-900)]">
      {/* Animated background */}
      <div className="absolute inset-[-12%] z-0 blur-[8px]">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0C4824] via-[#0F7A38] via-[26%] via-[#5E9A3C] via-[44%] via-[#F5A524] via-[68%] to-[#B23D14]" />
        <div
          className="absolute w-[46%] h-[60%] -left-[6%] -top-[10%] rounded-full animate-[fct-drift_17s_ease-in-out_infinite]"
          style={{ background: "radial-gradient(circle, #0C4824 0%, rgba(12,72,36,0) 70%)" }}
        />
        <div
          className="absolute w-[55%] h-[70%] -right-[8%] -bottom-[14%] rounded-full animate-[fct-drift2_21s_ease-in-out_infinite]"
          style={{ background: "radial-gradient(circle, #F2683F 0%, rgba(242,104,63,0) 68%)" }}
        />
        <div
          className="absolute w-[40%] h-[50%] right-[18%] -top-[6%] rounded-full animate-[fct-drift_24s_ease-in-out_infinite]"
          style={{ background: "radial-gradient(circle, #F5A524 0%, rgba(245,165,36,0) 70%)" }}
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
      <div className="relative z-[2] max-w-[1240px] mx-auto px-5 md:px-8">
        {/* Nav */}
        <header className="flex items-center gap-3 md:gap-4 mt-[22px] py-2 pr-2 pl-4 md:pl-[22px] rounded-full bg-[rgba(251,250,247,.92)] backdrop-blur-[10px] border border-[rgba(255,255,255,.5)] shadow-[0_10px_34px_-12px_rgba(12,40,15,.5)]">
          <Logo size="sm" />
          <nav className="hidden md:flex items-center gap-1 ml-2">
            {[
              { label: "Como funciona", href: "#como-funciona" },
              { label: "Comercios", href: "#comercios" },
            ].map((item) => (
              <a
                key={item.label}
                href={item.href}
                className="py-2 px-3.5 rounded-full text-[15px] font-medium no-underline transition-colors hover:bg-[var(--bg-subtle)] text-[color:var(--text-body)]"
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="quiet" size="sm" as={Link} href="/api/auth/signin?callbackUrl=/dashboard" className="hidden sm:inline-flex">
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
            <h1 className="m-0 text-white font-[family-name:var(--font-display)] font-extrabold text-[clamp(40px,9vw,96px)] leading-[0.95] tracking-[-0.035em]">
              Foto del ticket.
              <br />
              Tu factura,
              <br />
              automatica.
            </h1>
            <p className="mt-7 max-w-[478px] text-xl leading-relaxed text-[rgba(243,239,232,.92)]">
              Subele la foto de tu ticket y Facturin lee los datos, valida tu RFC y genera el CFDI por ti. Sin capturar nada a mano.
            </p>
            <div className="flex items-center gap-3.5 flex-wrap mt-8">
              <Button variant="primary" size="lg" arrow as={Link} href="/api/auth/signin?callbackUrl=/dashboard">
                Comenzar gratis
              </Button>
              <span className="text-sm font-medium text-[rgba(243,239,232,.78)]">
                Gratis los primeros 10 tickets
              </span>
            </div>
            <div className="flex items-center gap-2.5 mt-16">
              <span className="w-[9px] h-[9px] rounded-sm flex-none bg-[var(--accent-coral)]" />
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[rgba(243,239,232,.72)]">
                Hecho en Mexico - CFDI 4.0 valido ante el SAT
              </span>
            </div>
          </div>

          {/* Right: demo card */}
          <div className="justify-self-center md:justify-self-end mx-auto md:mx-0 w-full max-w-[452px] animate-[fct-float_7s_ease-in-out_infinite]">
            <div className="rounded-[var(--radius-2xl)] overflow-hidden bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-[0_40px_80px_-24px_rgba(12,40,15,.5),0_12px_28px_-14px_rgba(12,40,15,.3)]">
              {/* Card header */}
              <div className="flex items-center gap-3 py-4 px-5 border-b border-[var(--border-subtle)]">
                <span className="w-[34px] h-[34px] rounded-[9px] grid place-items-center text-white flex-none bg-[var(--brand)] font-[family-name:var(--font-display)] font-extrabold text-[18px]">
                  F
                </span>
                <div className="flex flex-col leading-tight">
                  <span className="font-bold text-[15px] text-[color:var(--text-strong)]">
                    Facturin
                  </span>
                  <span className="flex items-center gap-1.5 text-[12.5px] text-[color:var(--text-muted)]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--brand)] animate-[fct-blink_1.3s_ease-in-out_infinite]" />
                    Leyendo tu ticket...
                  </span>
                </div>
                <div className="ml-auto flex items-end gap-[3px] h-[18px]">
                  {[60, 100, 50, 80].map((h, i) => (
                    <span
                      key={i}
                      className="w-[3px] rounded-sm origin-bottom bg-[var(--accent-amber)] animate-[fct-wave_1s_ease-in-out_infinite]"
                      style={{ height: `${h}%`, animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </div>
              </div>

              {/* Card body */}
              <div className="p-5">
                <div className="flex items-center gap-3.5 mb-4">
                  {/* Receipt thumbnail */}
                  <div
                    className="relative w-[84px] h-[104px] rounded-xl flex-none overflow-hidden border border-[var(--border-default)]"
                    style={{ background: "repeating-linear-gradient(135deg, #EEEBE2 0 7px, #F6F4EE 7px 14px)" }}
                  >
                    <div className="absolute inset-0 p-2.5 flex flex-col gap-1.5">
                      <span className="h-1.5 w-[70%] rounded-sm bg-[rgba(26,23,20,.22)]" />
                      <span className="h-1 w-[48%] rounded-sm bg-[rgba(26,23,20,.16)]" />
                      <span className="h-1 w-[60%] rounded-sm mt-auto bg-[rgba(26,23,20,.16)]" />
                      <span className="h-1 w-[40%] rounded-sm bg-[rgba(26,23,20,.16)]" />
                    </div>
                    <span className="absolute left-1.5 bottom-1.5 font-mono text-[8.5px] tracking-[0.05em] text-[color:var(--text-faint)]">
                      FOTO.JPG
                    </span>
                  </div>
                  <span className="w-7 h-7 rounded-full grid place-items-center flex-none bg-[var(--bg-inset)] text-[color:var(--text-muted)]">
                    <ChevronRight className="w-4 h-4" />
                  </span>
                  <div className="flex-1 flex flex-col gap-2">
                    {[
                      { label: "Comercio", value: "OXXO" },
                      { label: "RFC emisor", value: "OXX970814HS9", mono: true },
                      { label: "Folio", value: "A-10482", mono: true },
                    ].map((row) => (
                      <div key={row.label} className="flex justify-between items-baseline">
                        <span className="text-[12.5px] text-[color:var(--text-muted)]">
                          {row.label}
                        </span>
                        <span
                          className={`text-sm font-semibold ${row.mono ? "font-mono text-[12.5px] text-[color:var(--text-body)]" : "text-[color:var(--text-strong)]"}`}
                        >
                          {row.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Total */}
                <div className="flex justify-between items-center py-3 px-4 rounded-[var(--radius-md)] mb-3 bg-[var(--bg-subtle)]">
                  <span className="text-[13px] font-semibold text-[color:var(--text-muted)]">
                    Total
                  </span>
                  <span className="font-mono text-[17px] font-bold text-[color:var(--text-strong)]">
                    $284.50 MXN
                  </span>
                </div>

                {/* Success strip */}
                <div className="flex items-center gap-2 py-3 px-4 rounded-[var(--radius-md)] bg-[var(--brand-soft)] text-[color:var(--success-text)]">
                  <span className="w-5 h-5 rounded-full grid place-items-center text-white flex-none bg-[var(--brand)]">
                    <Check className="w-3 h-3" strokeWidth={3} />
                  </span>
                  <span className="text-[13.5px] font-semibold">CFDI generado - listo para descargar</span>
                </div>
              </div>

              {/* Card footer */}
              <div className="px-5 pb-4">
                <Button variant="secondary" size="md" arrow fullWidth as={Link} href="#como-funciona">
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
