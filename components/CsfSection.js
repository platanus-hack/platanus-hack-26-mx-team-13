"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import CsfUpload from "@/components/CsfUpload";
import { getTaxRegimeName } from "@/data/sat-catalogs";

/**
 * CsfSection — orchestrates the Block-1 CSF flow on the dashboard.
 *
 * Wraps <CsfUpload /> (upload to R2 → object key) and, once a key is produced,
 * calls POST /api/user/extract-csf to parse the PDF and persist the user's
 * Company. The saved fiscal profile (RFC, razón social, régimen) is then shown
 * inline. Re-uploading the same RFC updates the profile in place.
 *
 * @param {Object} [props]
 * @param {Object|null} [props.initialCompany] - The user's existing Company
 *   (plain JSON), or null if they have not uploaded a CSF yet.
 */
export default function CsfSection({ initialCompany = null, compact = false }) {
  const [company, setCompany] = useState(initialCompany);
  const [isExtracting, setIsExtracting] = useState(false);
  const router = useRouter();

  async function handleUploaded(key) {
    setIsExtracting(true);
    const toastId = toast.loading("Leyendo tu CSF...");

    try {
      const res = await fetch("/api/user/extract-csf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(body.error || "No pudimos leer tu CSF");
      }

      setCompany(body.company);
      // In compact mode the visible profile card is the parent's (server-rendered
      // `company` prop), not this component's state — refresh so it picks up the
      // newly-saved CSF without a manual hard reload.
      router.refresh();
      toast.success("Perfil fiscal guardado", { id: toastId });
    } catch (error) {
      toast.error(error.message || "Algo salio mal", { id: toastId });
    } finally {
      setIsExtracting(false);
    }
  }

  // In compact mode, only show the upload button (profile shown by parent)
  if (compact) {
    return (
      <div className="flex flex-col gap-2">
        <CsfUpload onUploaded={handleUploaded} compact />
        {isExtracting && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Extrayendo datos fiscales...
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <CsfUpload onUploaded={handleUploaded} />

      {isExtracting && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Extracting your fiscal data…
        </p>
      )}

      {company && <FiscalProfile company={company} />}
    </div>
  );
}

/**
 * FiscalProfile — renders the saved Company's key fiscal fields.
 */
function FiscalProfile({ company }) {
  const regimes = (company.taxRegime || [])
    .map((code) => getTaxRegimeName(code) || code)
    .filter(Boolean);

  return (
    <dl className="rounded-xl border border-black/[.08] bg-black/[.02] p-4 text-sm dark:border-white/[.145] dark:bg-white/[.03]">
      <Field label="RFC" value={company.rfc} mono />
      <Field label="Razón social" value={company.businessName} />
      <Field
        label="Régimen fiscal"
        value={regimes.length ? regimes.join(", ") : null}
      />
    </dl>
  );
}

function Field({ label, value, mono = false }) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5 first:pt-0 last:pb-0">
      <dt className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </dt>
      <dd
        className={`text-black dark:text-zinc-50 ${
          mono ? "font-mono" : "font-medium"
        }`}
      >
        {value || "—"}
      </dd>
    </div>
  );
}
