"use client";

import { useState } from "react";
import Link from "next/link";
import { Camera, ChevronRight } from "lucide-react";
import { Button, Badge, Card } from "@/components/ui";
import CsfSection from "@/components/CsfSection";
import TicketsSection from "@/components/TicketsSection";
import { UploadFlow } from "@/components/upload/UploadFlow";
import { getTaxRegimeName } from "@/data/sat-catalogs";

export default function DashboardView({ user, company }) {
  const [showUpload, setShowUpload] = useState(false);
  // Bumped when an upload finishes so the "Recientes" list reloads (no hard refresh).
  const [reloadKey, setReloadKey] = useState(0);
  const firstName = user?.name?.split(" ")[0] || "Usuario";

  // Get fiscal profile data from company prop using correct field names
  const fiscalProfile = company
    ? {
        rfc: company.rfc,
        razonSocial: company.businessName,
        regimen: company.taxRegime?.length
          ? company.taxRegime.map((code) => {
              const name = getTaxRegimeName(code);
              return name ? `${code} - ${name}` : code;
            }).join(", ")
          : null,
        cp: company.fiscalAddress?.postalCode,
        verified: true,
      }
    : null;

  return (
    <>
      <div className="max-w-[1040px] mx-auto px-8 py-10">
        {/* Greeting */}
        <div className="flex flex-wrap items-end justify-between gap-4 mb-2">
          <div>
            <h1
              className="m-0"
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: 34,
                letterSpacing: "-0.02em",
                color: "var(--ink)",
              }}
            >
              Hola, {firstName}
            </h1>
            <p className="text-base mt-2" style={{ color: "var(--text-muted)" }}>
              {fiscalProfile
                ? "Sube tus tickets para generar facturas."
                : "Sube tu CSF para comenzar a facturar tus tickets."
              }
            </p>
          </div>
          <Button variant="primary" arrow onClick={() => setShowUpload(true)}>
            Subir ticket
          </Button>
        </div>

        {/* Two columns */}
        <div className="grid md:grid-cols-[0.9fr_1.1fr] gap-5 mt-6">
          {/* Fiscal profile card */}
          <Card
            title="Tu perfil fiscal"
            subtitle="Extraido de tu Constancia de Situacion Fiscal."
            headerRight={fiscalProfile && <Badge tone="success" dot>Verificado</Badge>}
          >
            {fiscalProfile ? (
              <>
                <div className="mt-4">
                  {[
                    { label: "RFC", value: fiscalProfile.rfc, mono: true },
                    { label: "Razon social", value: fiscalProfile.razonSocial },
                    { label: "Regimen fiscal", value: fiscalProfile.regimen },
                    { label: "Codigo postal", value: fiscalProfile.cp, mono: true, noBorder: true },
                  ].map((row) => (
                    <div
                      key={row.label}
                      className={`flex flex-col gap-0.5 py-[10px] ${row.noBorder ? "" : "border-b border-[var(--border-subtle)]"}`}
                    >
                      <span
                        className="text-[10px] font-semibold uppercase"
                        style={{ letterSpacing: "0.07em", color: "var(--text-faint)" }}
                      >
                        {row.label}
                      </span>
                      <span
                        className={`text-[15px] font-medium ${row.mono ? "font-mono" : ""}`}
                        style={{ color: "var(--text-strong)" }}
                      >
                        {row.value || "—"}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-4">
                  <CsfSection initialCompany={company} compact />
                </div>
              </>
            ) : (
              <div className="mt-4">
                <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
                  Sube tu Constancia de Situacion Fiscal (PDF del SAT) para configurar tu perfil.
                </p>
                <CsfSection initialCompany={company} />
              </div>
            )}
          </Card>

          {/* Upload + recent */}
          <Card title="Subir un ticket" subtitle="Toma una foto del recibo o sube una imagen.">
            {/* Dropzone */}
            <div
              className="mt-4 py-[30px] px-5 text-center cursor-pointer rounded-xl transition-all border-2 border-dashed hover:border-[var(--brand)] hover:bg-[var(--brand-soft)]"
              style={{
                borderColor: "var(--border-strong)",
                background: "var(--bg-subtle)",
              }}
              onClick={() => setShowUpload(true)}
            >
              <span
                className="w-[52px] h-[52px] rounded-full inline-grid place-items-center mb-3"
                style={{ background: "var(--brand-soft)", color: "var(--brand-press)" }}
              >
                <Camera className="w-6 h-6" strokeWidth={1.8} />
              </span>
              <div className="text-[15px] font-semibold" style={{ color: "var(--text-strong)" }}>
                Arrastra o toma una foto
              </div>
              <div className="text-[13px] mt-1" style={{ color: "var(--text-faint)" }}>
                JPG o PNG - hasta 10 MB
              </div>
            </div>

            {/* Buttons */}
            <div className="flex gap-2.5 mt-[14px]">
              <Button variant="primary" size="sm" fullWidth onClick={() => setShowUpload(true)}>
                Tomar foto
              </Button>
              <Button variant="secondary" size="sm" fullWidth onClick={() => setShowUpload(true)}>
                Subir archivo
              </Button>
            </div>

            {/* Recent tickets section */}
            <div className="flex items-center justify-between mt-[22px] mb-[10px]">
              <span
                className="text-[11px] font-semibold uppercase"
                style={{ letterSpacing: "0.07em", color: "var(--text-faint)" }}
              >
                Recientes
              </span>
              <Link
                href="/tickets"
                className="flex items-center gap-0.5 text-[13px] font-semibold no-underline"
                style={{ color: "var(--text-link)" }}
              >
                Ver todos
                <ChevronRight className="w-[14px] h-[14px]" strokeWidth={1.9} />
              </Link>
            </div>

            {/* Uses existing TicketsSection component for ticket list */}
            <TicketsSection compact reloadKey={reloadKey} />
          </Card>
        </div>
      </div>

      {/* Upload modal — on close, reload the "Recientes" list so the new ticket shows. */}
      {showUpload && (
        <UploadFlow
          onClose={() => {
            setShowUpload(false);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </>
  );
}
