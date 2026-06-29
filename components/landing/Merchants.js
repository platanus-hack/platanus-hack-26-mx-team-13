"use client";

export default function Merchants() {
  const merchants = [
    { name: "OXXO", style: { color: "#E4002B", fontWeight: 800 } },
    { name: "Costco.", style: { color: "#005DAA", fontWeight: 800 }, dot: "#E4002B" },
    { name: "Walmart", style: { color: "#0071CE", fontWeight: 700 }, icon: "✸", iconColor: "#FFC220" },
    { name: "7-Eleven", style: { color: "#008061", fontWeight: 700 }, badge: true },
    { name: "AlSuper", style: { fontWeight: 800 }, sub: "Chihuahua" },
  ];

  return (
    <section id="comercios" className="py-16 bg-[var(--bg-page)]">
      <p className="text-center mb-10 text-[13px] font-semibold uppercase px-5 md:px-8 tracking-[0.1em] text-[color:var(--text-muted)]">
        Factura tus compras en los comercios de siempre
      </p>
      <div
        className="relative overflow-hidden"
        style={{
          WebkitMaskImage: "linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)",
          maskImage: "linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)",
        }}
      >
        <div className="flex w-max animate-[fct-marquee_26s_linear_infinite]">
          {[0, 1].map((track) => (
            <div key={track} className="flex items-center gap-20 pr-20" aria-hidden={track === 1}>
              {merchants.map((m, i) => (
                <span key={`${track}-${i}`} className="whitespace-nowrap flex items-center gap-2 font-[family-name:var(--font-display)] text-[30px]" style={{ ...m.style }}>
                  {m.icon && <span className="text-[22px]" style={{ color: m.iconColor }}>{m.icon}</span>}
                  {m.badge && (
                    <span className="w-9 h-9 rounded-lg grid place-items-center text-[19px] bg-[#F47521] text-[#008061] font-extrabold">
                      7
                    </span>
                  )}
                  {m.sub ? (
                    <span className="flex flex-col leading-none">
                      <span>
                        Al<span className="text-[#E4002B]">Super</span>
                      </span>
                      <span className="text-[9.5px] font-semibold uppercase mt-1 tracking-[0.14em] text-[color:var(--text-faint)]">
                        {m.sub}
                      </span>
                    </span>
                  ) : m.badge ? (
                    <span className="text-[23px]">Eleven</span>
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
