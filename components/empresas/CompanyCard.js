"use client";

import { Card, Badge, Button } from "@/components/ui";
import { getTaxRegimeName } from "@/data/sat-catalogs";

// One empresa/constancia in the /empresas grid: fiscal identity + set-default /
// delete actions. `pending` disables the buttons while a mutation is in flight.
export default function CompanyCard({ company, isDefault, pending, onSetDefault, onDelete }) {
  const regimes = (company.taxRegime || [])
    .map((c) => `${c} - ${getTaxRegimeName(c) || c}`)
    .join(", ");

  return (
    <Card>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <div
            className="text-lg font-semibold leading-tight"
            style={{ fontFamily: "var(--font-display)", color: "var(--text-strong)" }}
          >
            {company.businessName || company.tradeName || "Empresa"}
          </div>
          <div className="text-[13px] font-mono mt-1" style={{ color: "var(--text-muted)" }}>
            {company.rfc}
          </div>
        </div>
        {isDefault && <Badge tone="brand">Predeterminada</Badge>}
      </div>

      {regimes && (
        <p className="text-[13px] mb-4" style={{ color: "var(--text-muted)" }}>
          {regimes}
        </p>
      )}

      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={isDefault || pending}
          onClick={onSetDefault}
        >
          {isDefault ? "Predeterminada" : "Hacer predeterminada"}
        </Button>
        <Button variant="coral" size="sm" disabled={pending} onClick={onDelete}>
          Eliminar
        </Button>
      </div>
    </Card>
  );
}
