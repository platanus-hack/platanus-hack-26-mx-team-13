"use client";

import { useRef, useState } from "react";
import toast from "react-hot-toast";

// CSF constancias are always PDFs. We gate on the client for a fast UX; the
// server (generate-upload-token + R2 signature) is the real enforcement.
const ACCEPT = "application/pdf";

/**
 * CsfUpload — pick the CSF constancia PDF and upload it straight to R2 via a
 * presigned PUT URL (#6). Produces the object `key` the parser (#8) consumes.
 *
 * Flow on file pick:
 *   1. POST /api/user/generate-upload-token { kind: "csf" } -> presigned PUT URL + key
 *   2. PUT the file bytes directly to R2                     (never proxied through Next.js)
 *   3. On 200, surface the object key + success toast.
 *
 * @param {Object} [props]
 * @param {(key: string) => void} [props.onUploaded] - Called with the R2 object key.
 */
export default function CsfUpload({ onUploaded }) {
  const [isUploading, setIsUploading] = useState(false);
  const [key, setKey] = useState(null);
  const fileInputRef = useRef(null);

  async function uploadCsf(file) {
    if (!file) return;

    // Reject non-PDFs client-side before hitting the network.
    if (file.type !== "application/pdf") {
      toast.error("Please select a PDF file");
      return;
    }

    setIsUploading(true);
    const toastId = toast.loading("Uploading CSF…");

    try {
      // 1. Ask the server for a presigned PUT URL scoped to this user.
      const tokenRes = await fetch("/api/user/generate-upload-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name || "csf.pdf",
          contentType: "application/pdf",
          kind: "csf",
        }),
      });

      if (!tokenRes.ok) {
        const { error } = await tokenRes.json().catch(() => ({}));
        throw new Error(error || "Could not get upload URL");
      }

      const { uploadUrl, key: objectKey } = await tokenRes.json();

      // 2. Upload the bytes straight to R2. The Content-Type must match the one
      // baked into the presigned signature or R2 rejects the PUT.
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/pdf" },
        body: file,
      });

      if (!putRes.ok) {
        throw new Error("Upload to storage failed");
      }

      // 3. Keep the key in state to hand off to the parser (#8).
      setKey(objectKey);
      toast.success("CSF uploaded", { id: toastId });
      onUploaded?.(objectKey);
    } catch (error) {
      toast.error(error.message || "Something went wrong", { id: toastId });
    } finally {
      setIsUploading(false);
    }
  }

  function handleChange(event) {
    const file = event.target.files?.[0];
    // Reset so picking the same file again still fires onChange.
    event.target.value = "";
    uploadCsf(file);
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={handleChange}
        disabled={isUploading}
      />

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={isUploading}
        className="flex h-12 items-center justify-center gap-2 rounded-full bg-foreground px-6 text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
      >
        {isUploading ? "Uploading…" : "Upload CSF PDF"}
      </button>

      {key && (
        <p className="break-all text-xs text-zinc-500 dark:text-zinc-400">
          Uploaded: {key}
        </p>
      )}
    </div>
  );
}
