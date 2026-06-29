import Link from "next/link";

export default function Logo({ size = "md" }) {
  const sizes = {
    sm: { box: 28, text: 20 },
    md: { box: 30, text: 21 },
  };
  const s = sizes[size] || sizes.md;
  return (
    <Link href="/" className="flex items-center gap-2.5 no-underline">
      <span
        className="rounded-lg grid place-items-center text-white bg-[var(--brand)] font-[family-name:var(--font-display)] font-extrabold shadow-[var(--shadow-brand)]"
        style={{ width: s.box, height: s.box, fontSize: s.box * 0.6 }}
      >
        F
      </span>
      <span
        className="font-[family-name:var(--font-display)] font-bold tracking-[-0.02em] text-[color:var(--ink)]"
        style={{ fontSize: s.text }}
      >
        Factur<span className="text-[color:var(--brand)]">i</span>n
      </span>
    </Link>
  );
}
