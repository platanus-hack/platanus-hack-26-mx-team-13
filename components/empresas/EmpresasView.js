"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { Building2 } from "lucide-react";
import { Card } from "@/components/ui";
import CsfUpload from "@/components/CsfUpload";
import CompanyCard from "@/components/empresas/CompanyCard";

// Manage the user's empresas/constancias: list them, add another (CSF upload →
// extract-csf), set the default, soft-delete. Seeded from the server then kept
// authoritative by re-fetching GET /api/user/companies after every mutation.
export default function EmpresasView({ initialCompanies = [], initialDefaultId = null }) {
  const [companies, setCompanies] = useState(initialCompanies);
  const [defaultId, setDefaultId] = useState(initialDefaultId);
  const [pendingId, setPendingId] = useState(null);
  const [extracting, setExtracting] = useState(false);

  async function refresh() {
    try {
      const res = await fetch("/api/user/companies");
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setCompanies(data.companies || []);
      setDefaultId(data.defaultCompanyId || null);
    } catch {
      toast.error("No se pudieron recargar las empresas");
    }
  }

  async function handleCsfUploaded(key) {
    setExtracting(true);
    const toastId = toast.loading("Leyendo tu CSF...");
    try {
      const res = await fetch("/api/user/extract-csf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "No pudimos leer tu CSF");
      toast.success("Constancia guardada", { id: toastId });
      await refresh();
    } catch (error) {
      toast.error(error.message || "Algo salió mal", { id: toastId });
    } finally {
      setExtracting(false);
    }
  }

  async function setDefault(companyId) {
    setPendingId(companyId);
    try {
      const res = await fetch("/api/user/companies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      if (!res.ok) throw new Error("failed");
      toast.success("Empresa predeterminada actualizada");
      await refresh();
    } catch {
      toast.error("No se pudo actualizar la predeterminada");
    } finally {
      setPendingId(null);
    }
  }

  async function remove(companyId) {
    if (
      typeof window !== "undefined" &&
      !window.confirm("¿Eliminar esta constancia? No podrás facturar con ella.")
    ) {
      return;
    }
    setPendingId(companyId);
    try {
      const res = await fetch(`/api/user/companies/${companyId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("failed");
      toast.success("Constancia eliminada");
      await refresh();
    } catch {
      toast.error("No se pudo eliminar");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="max-w-[1040px] mx-auto px-6 sm:px-8 py-10">
      <div className="flex items-start justify-between gap-4 mb-7 flex-wrap">
        <div>
          <h1
            className="m-0"
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              fontSize: 30,
              letterSpacing: "-0.02em",
              color: "var(--ink)",
            }}
          >
            Mis Empresas
          </h1>
          <p className="text-[15px] mt-1.5" style={{ color: "var(--text-muted)" }}>
            Tus constancias de situación fiscal. Elige cuál usar al subir cada ticket.
          </p>
        </div>
        {companies.length > 0 && (
          <div className="flex flex-col items-end gap-1">
            <CsfUpload onUploaded={handleCsfUploaded} compact />
            {extracting && (
              <span className="text-[12px]" style={{ color: "var(--text-faint)" }}>
                Extrayendo datos...
              </span>
            )}
          </div>
        )}
      </div>

      {companies.length === 0 ? (
        <Card className="text-center py-12">
          <span
            className="w-14 h-14 rounded-full inline-grid place-items-center mb-4"
            style={{ background: "var(--brand-soft)", color: "var(--brand-press)" }}
          >
            <Building2 className="w-7 h-7" strokeWidth={1.8} />
          </span>
          <div className="text-lg font-semibold mb-1" style={{ color: "var(--text-strong)" }}>
            Aún no tienes constancias
          </div>
          <p className="text-[14px] mb-5" style={{ color: "var(--text-muted)" }}>
            Sube tu primera constancia de situación fiscal (CSF) para empezar a facturar.
          </p>
          <div className="flex justify-center">
            <CsfUpload onUploaded={handleCsfUploaded} />
          </div>
          {extracting && (
            <p className="text-[13px] mt-3" style={{ color: "var(--text-faint)" }}>
              Extrayendo datos...
            </p>
          )}
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 gap-5">
          {companies.map((c) => (
            <CompanyCard
              key={c.id}
              company={c}
              isDefault={c.id === defaultId}
              pending={pendingId === c.id}
              onSetDefault={() => setDefault(c.id)}
              onDelete={() => remove(c.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
