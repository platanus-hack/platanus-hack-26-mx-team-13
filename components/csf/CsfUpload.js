"use client";

import { useRef, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import toast from "react-hot-toast";
import { uploadCsfFile } from "@/libs/upload";

// CSF constancias are always PDFs. We gate on the client for a fast UX; the
// server (generate-upload-token + R2 signature) is the real enforcement.
const ACCEPT = "application/pdf";

const csfSchema = z.object({
  file: z
    .instanceof(File, { message: "Selecciona un PDF" })
    .refine((f) => f.type === "application/pdf", "Selecciona un archivo PDF"),
});

/**
 * CsfUpload — pick the CSF constancia PDF and upload it straight to R2 via a
 * presigned PUT URL (#6). Produces the object `key` the parser (#8) consumes.
 *
 * The file input is wired through react-hook-form (Controller) + a zod schema;
 * the actual upload runs through the shared `uploadCsfFile` helper. The form is
 * fire-on-pick (no submit button), so picking a file validates then uploads.
 *
 * @param {Object} [props]
 * @param {(key: string) => void} [props.onUploaded] - Called with the R2 object key.
 */
export default function CsfUpload({ onUploaded, compact = false }) {
  const [isUploading, setIsUploading] = useState(false);
  const [key, setKey] = useState(null);
  const fileInputRef = useRef(null);

  const { control, handleSubmit, reset } = useForm({
    resolver: zodResolver(csfSchema),
    defaultValues: { file: null },
  });

  async function onValid({ file }) {
    setIsUploading(true);
    const toastId = toast.loading("Subiendo CSF...");
    try {
      const objectKey = await uploadCsfFile(file);
      setKey(objectKey);
      toast.success("CSF subido", { id: toastId });
      onUploaded?.(objectKey);
    } catch (error) {
      toast.error(
        error?.response?.data?.error || error.message || "Algo salió mal",
        { id: toastId }
      );
    } finally {
      setIsUploading(false);
      reset();
    }
  }

  function onInvalid(errors) {
    if (errors.file?.message) toast.error(errors.file.message);
  }

  // Hidden file input driven by RHF: on pick, set the value then submit (which
  // validates + uploads). Reset the input value so re-picking the same file fires.
  const fileField = (
    <Controller
      name="file"
      control={control}
      render={({ field }) => (
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          disabled={isUploading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            field.onChange(file);
            handleSubmit(onValid, onInvalid)();
          }}
        />
      )}
    />
  );

  // Compact mode for dashboard: smaller ghost button
  if (compact) {
    return (
      <>
        {fileField}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="inline-flex items-center justify-center gap-2 py-2 px-4 text-[13px] font-semibold leading-none rounded-full border transition-all disabled:opacity-50"
          style={{
            background: "transparent",
            borderColor: "var(--border-strong)",
            color: "var(--text-strong)",
          }}
        >
          {isUploading ? "Subiendo..." : "Actualizar CSF"}
        </button>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {fileField}

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={isUploading}
        className="flex h-12 items-center justify-center gap-2 rounded-full bg-foreground px-6 text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
      >
        {isUploading ? "Subiendo..." : "Subir CSF PDF"}
      </button>

      {key && (
        <p className="break-all text-xs text-zinc-500 dark:text-zinc-400">
          Subido: {key}
        </p>
      )}
    </div>
  );
}
