"use client";

import Link from "next/link";
import Button from "@/components/ui/Button";

export default function Footer() {
  const signinHref = "/api/auth/signin?callbackUrl=/dashboard";
  const links = {
    Producto: [
      { label: "Como funciona", href: "#como-funciona" },
      { label: "Comercios", href: "#comercios" },
    ],
    Empezar: [
      { label: "Crear cuenta", href: signinHref },
      { label: "Iniciar sesion", href: signinHref },
    ],
  };

  return (
    <footer id="contacto" className="bg-[var(--espresso-900)] text-[rgba(243,239,232,.72)]">
      <div className="max-w-[1200px] mx-auto px-5 md:px-8 py-20">
        {/* CTA */}
        <div className="flex flex-wrap items-center justify-between gap-7 pb-16 border-b border-[rgba(255,255,255,.12)]">
          <h2 className="m-0 max-w-[620px] font-[family-name:var(--font-display)] font-extrabold text-[clamp(32px,3.8vw,48px)] leading-[1.02] tracking-[-0.03em] text-white">
            Deja de capturar facturas a mano.
          </h2>
          <div className="flex items-center gap-3.5 flex-wrap">
            <Button variant="primary" size="lg" arrow as={Link} href="/api/auth/signin?callbackUrl=/dashboard">
              Comenzar gratis
            </Button>
            <span className="text-sm font-medium text-[rgba(243,239,232,.6)]">
              Gratis los primeros 10 tickets
            </span>
          </div>
        </div>

        {/* Link grid */}
        <div className="grid grid-cols-2 md:grid-cols-[1.8fr_1fr_1fr] gap-10 py-14">
          {/* Brand */}
          <div className="max-w-[300px] col-span-2 md:col-span-1">
            <Link href="/" className="flex items-center gap-2.5 no-underline">
              <span className="w-[30px] h-[30px] rounded-lg grid place-items-center text-white bg-[var(--brand)] font-[family-name:var(--font-display)] font-extrabold text-[18px]">
                F
              </span>
              <span className="font-[family-name:var(--font-display)] font-bold text-[21px] tracking-[-0.02em] text-white">
                Factur<span className="text-[color:var(--brand)]">i</span>n
              </span>
            </Link>
            <p className="mt-4 text-[15px] leading-relaxed text-[rgba(243,239,232,.6)]">
              Foto del ticket - tu factura, automatica. CFDI 4.0 valido ante el SAT, sin capturar nada a mano.
            </p>
          </div>

          {/* Link columns */}
          {Object.entries(links).map(([title, items]) => (
            <div key={title} className="flex flex-col gap-3.5">
              <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[rgba(243,239,232,.45)]">
                {title}
              </span>
              {items.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="text-[15px] no-underline hover:text-white transition-colors text-[rgba(243,239,232,.72)]"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-8 border-t border-[rgba(255,255,255,.12)]">
          <span className="text-[13.5px] text-[rgba(243,239,232,.5)]">
            2026 Facturin - CFDI 4.0 valido ante el SAT - Hecho en Mexico
          </span>
          <a
            href="#top"
            className="inline-flex items-center gap-2 text-[13.5px] font-medium no-underline transition-colors hover:text-white text-[rgba(243,239,232,.6)]"
          >
            Volver arriba
            <span className="w-7 h-7 rounded-full grid place-items-center border border-[rgba(255,255,255,.16)]">
              &#8593;
            </span>
          </a>
        </div>
      </div>
    </footer>
  );
}
