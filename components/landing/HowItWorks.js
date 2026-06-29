"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";

export default function HowItWorks() {
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
      gradient: "linear-gradient(150deg, #0F7A38 0%, #0C4824 60%, #072813 100%)",
    },
    {
      num: "02",
      title: "Toma la foto del ticket",
      desc: "Facturin lee la imagen y extrae comercio, folio, subtotal y total — todo validado contra el SAT en segundos.",
      gradient: "linear-gradient(150deg, #F5A524 0%, #C9711A 58%, #7C3E0C 100%)",
    },
    {
      num: "03",
      title: "Descarga tu CFDI",
      desc: "Recibes el CFDI 4.0 valido en PDF y XML, listo para tu contabilidad. Sin capturar nada a mano.",
      gradient: "linear-gradient(150deg, #16A34A 0%, #0C6F33 58%, #04280F 100%)",
    },
  ];

  return (
    <section id="como-funciona" className="bg-[var(--bg-page)]">
      <div className="max-w-[1200px] mx-auto px-5 md:px-8 pt-20 md:pt-[130px] pb-2">
        <div className="max-w-[820px]">
          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--brand)]">
            <span className="w-2 h-2 rounded-sm bg-[var(--brand)]" />
            Como funciona
          </span>
          <h2 className="mt-5 font-[family-name:var(--font-display)] font-extrabold text-[clamp(40px,5.4vw,72px)] leading-[0.98] tracking-[-0.04em] text-[color:var(--text-strong)]">
            Tres pasos.
            <br />
            Cero captura manual.
          </h2>
          <p className="mt-5 max-w-[520px] text-xl leading-relaxed text-[color:var(--text-body)]">
            Configuras tu perfil fiscal una vez. Despues, cada ticket es solo una foto — Facturin hace el resto.
          </p>
        </div>
      </div>

      {/* Mobile: static stacked steps (no scroll-jack) */}
      <div className="lg:hidden max-w-[640px] mx-auto px-5 pt-10 pb-6 flex flex-col gap-5">
        {steps.map((s) => (
          <div
            key={s.num}
            className="rounded-[var(--radius-xl)] overflow-hidden bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-[var(--shadow-md)]"
          >
            <div className="relative h-24" style={{ background: s.gradient }}>
              <span className="absolute left-5 bottom-4 inline-flex items-center font-mono text-[13px] font-semibold text-white py-1.5 px-3.5 rounded-full bg-[rgba(7,28,12,.5)] backdrop-blur-[8px] border border-[rgba(255,255,255,.18)]">
                {s.num} - {s.title}
              </span>
            </div>
            <p className="m-0 p-5 text-[15.5px] leading-relaxed text-[color:var(--text-body)]">
              {s.desc}
            </p>
          </div>
        ))}
      </div>

      {/* Desktop: pinned scroll-jacked scroller */}
      <div id="fctHiwWrap" className="relative h-[300vh] hidden lg:block">
        <div className="sticky top-0 min-h-screen max-w-[1200px] mx-auto grid lg:grid-cols-[0.82fr_1.18fr] gap-8 lg:gap-[60px] items-start lg:items-center px-5 py-10 md:p-12">
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
                  <h3 className="m-0 font-[family-name:var(--font-display)] font-bold text-[25px] tracking-[-0.02em] text-[color:var(--text-strong)]">
                    {s.title}
                  </h3>
                  <p
                    className={`m-0 text-[15.5px] leading-relaxed overflow-hidden transition-all duration-[450ms] ${
                      step === i ? "max-h-36 opacity-100 mt-2.5" : "max-h-0 opacity-0"
                    } text-[color:var(--text-body)]`}
                  >
                    {s.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Stage */}
          <div className="relative w-full aspect-[4/3] rounded-[var(--radius-2xl)] overflow-hidden bg-[var(--bg-inset)] shadow-[0_50px_90px_-40px_rgba(12,40,15,.45)]">
            {/* Visual 1 */}
            <div
              className={`absolute inset-0 transition-opacity duration-200 ${step === 0 ? "opacity-100" : "opacity-0"}`}
              style={{ background: "linear-gradient(150deg, #0F7A38 0%, #0C4824 60%, #072813 100%)" }}
            >
              <div className="absolute inset-0 grid place-items-center p-[8%]">
                <div className="w-[74%] max-w-[340px] rounded-[var(--radius-lg)] overflow-hidden bg-[var(--bg-surface)] shadow-[0_36px_70px_-22px_rgba(0,0,0,.5)] rotate-[-1.5deg]">
                  <div className="flex items-center gap-2 py-4 px-4 border-b border-[var(--border-subtle)]">
                    <span className="w-7 h-7 rounded-lg grid place-items-center text-[15px] bg-[var(--brand-soft)] text-[color:var(--brand)]">
                      <span className="text-lg">&#128196;</span>
                    </span>
                    <span className="text-sm font-bold text-[color:var(--text-strong)]">
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
                        <span className="text-[13px] text-[color:var(--text-muted)]">{row.label}</span>
                        <span className={`text-[13px] font-semibold ${row.mono ? "font-mono" : ""} text-[color:var(--text-body)]`}>
                          {row.value}
                        </span>
                      </div>
                    ))}
                    <div className="flex items-center gap-2 mt-1 py-2.5 px-3 rounded-sm bg-[var(--brand-soft)] text-[color:var(--success-text)]">
                      <span className="w-4 h-4 rounded-full grid place-items-center text-white text-[11px] bg-[var(--brand)]">
                        <Check className="w-2.5 h-2.5" strokeWidth={3} />
                      </span>
                      <span className="text-[12.5px] font-semibold">Perfil fiscal listo</span>
                    </div>
                  </div>
                </div>
              </div>
              <span className="absolute left-6 bottom-6 inline-flex items-center font-mono text-[13px] font-semibold text-white py-2 px-4 rounded-full bg-[rgba(7,28,12,.5)] backdrop-blur-[8px] border border-[rgba(255,255,255,.18)]">
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
                  className="relative w-40 h-52 rounded-2xl flex-none overflow-hidden border border-[rgba(255,255,255,.35)] shadow-[0_28px_54px_-18px_rgba(0,0,0,.5)]"
                  style={{ background: "repeating-linear-gradient(135deg, #EEEBE2 0 8px, #F6F4EE 8px 16px)" }}
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
                  <div className="absolute left-0 right-0 h-[3px] bg-white shadow-[0_0_16px_3px_rgba(255,255,255,.9)] animate-[fct-scan_2.2s_ease-in-out_infinite]" />
                </div>
                <div className="flex flex-col gap-3 whitespace-nowrap">
                  <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-[rgba(255,255,255,.75)]">
                    Leyendo ticket
                  </span>
                  {[
                    { label: "Comercio", value: "OXXO" },
                    { label: "Folio", value: "A-10482", mono: true },
                    { label: "Total", value: "$284.50", mono: true, bold: true },
                  ].map((row) => (
                    <div key={row.label} className="flex justify-between gap-7">
                      <span className="text-sm text-[rgba(255,255,255,.75)]">{row.label}</span>
                      <span className={`text-sm ${row.mono ? "font-mono" : ""} ${row.bold ? "font-bold text-[15px]" : "font-bold"} text-white`}>
                        {row.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <span className="absolute left-6 bottom-6 inline-flex items-center font-mono text-[13px] font-semibold text-white py-2 px-4 rounded-full bg-[rgba(7,28,12,.5)] backdrop-blur-[8px] border border-[rgba(255,255,255,.18)]">
                02 - Toma la foto
              </span>
            </div>

            {/* Visual 3 */}
            <div
              className={`absolute inset-0 transition-opacity duration-200 ${step === 2 ? "opacity-100" : "opacity-0"}`}
              style={{ background: "linear-gradient(150deg, #16A34A 0%, #0C6F33 58%, #04280F 100%)" }}
            >
              <div className="absolute inset-0 grid place-items-center p-[8%]">
                <div className="w-[74%] max-w-[340px] rounded-[var(--radius-lg)] overflow-hidden bg-[var(--bg-surface)] shadow-[0_36px_70px_-22px_rgba(0,0,0,.5)] rotate-[1.5deg]">
                  <div className="flex items-center gap-2.5 py-5 px-5">
                    <span className="w-8 h-8 rounded-full grid place-items-center text-white bg-[var(--brand)]">
                      <Check className="w-4 h-4" strokeWidth={3} />
                    </span>
                    <span className="text-[15px] font-bold text-[color:var(--text-strong)]">
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
                        className="flex items-center gap-3 py-3 px-3 rounded-sm border border-[var(--border-subtle)]"
                      >
                        <span
                          className="font-mono text-[10px] font-bold text-white py-0.5 px-2 rounded"
                          style={{ background: file.color }}
                        >
                          {file.ext}
                        </span>
                        <span className="text-[13.5px] font-semibold text-[color:var(--text-body)]">
                          {file.name}
                        </span>
                        <span className="ml-auto text-[color:var(--text-muted)]">
                          &#8595;
                        </span>
                      </div>
                    ))}
                    <div className="flex items-center gap-2 mt-0.5 py-2.5 px-3 rounded-sm bg-[var(--brand-soft)] text-[color:var(--success-text)]">
                      <span className="text-sm">&#128737;</span>
                      <span className="text-[12.5px] font-semibold">Valido ante el SAT</span>
                    </div>
                  </div>
                </div>
              </div>
              <span className="absolute left-6 bottom-6 inline-flex items-center font-mono text-[13px] font-semibold text-white py-2 px-4 rounded-full bg-[rgba(7,28,12,.5)] backdrop-blur-[8px] border border-[rgba(255,255,255,.18)]">
                03 - Descarga tu CFDI
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
