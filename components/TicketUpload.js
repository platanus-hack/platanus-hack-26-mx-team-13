"use client";

import { useRef, useState } from "react";
import toast from "react-hot-toast";

// Accepted on the client; the server (generate-upload-token + R2 signature) is the
// real gate. Tickets are images only — OCR (Google Vision) operates on raster
// images, so PDFs are not accepted here (CSF uploads handle PDFs separately).
const ACCEPT = "image/*";

/**
 * TicketUpload — upload a receipt photo (mobile camera) or file straight to R2,
 * then create a Ticket (#25).
 *
 * Flow on file pick:
 *   1. POST /api/user/generate-upload-token  -> presigned R2 PUT URL + object key
 *   2. PUT the file bytes directly to R2     (never proxied through Next.js)
 *   3. POST /api/user/tickets { imageKey }    -> creates Ticket (status "uploaded")
 *
 * @param {Object} [props]
 * @param {(ticketId: string) => void} [props.onUploaded] - Called with the new ticketId.
 */
export default function TicketUpload({ onUploaded }) {
  const [isUploading, setIsUploading] = useState(false);
  // Separate refs so mobile gets a camera capture button AND a plain file picker.
  const cameraInputRef = useRef(null);
  const fileInputRef = useRef(null);

  async function uploadTicket(file) {
    if (!file) return;

    setIsUploading(true);
    const toastId = toast.loading("Uploading ticket…");

    try {
      // 1. Ask the server for a presigned PUT URL scoped to this user.
      const tokenRes = await fetch("/api/user/generate-upload-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name || "ticket",
          contentType: file.type || "application/octet-stream",
          kind: "ticket",
        }),
      });

      if (!tokenRes.ok) {
        const { error } = await tokenRes.json().catch(() => ({}));
        throw new Error(error || "Could not get upload URL");
      }

      const { uploadUrl, key } = await tokenRes.json();

      // 2. Upload the bytes straight to R2. The Content-Type must match the one
      // baked into the presigned signature or R2 rejects the PUT.
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });

      if (!putRes.ok) {
        throw new Error("Upload to storage failed");
      }

      // 3. Persist the Ticket pointing at the uploaded object.
      const ticketRes = await fetch("/api/user/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageKey: key }),
      });

      if (!ticketRes.ok) {
        const { error } = await ticketRes.json().catch(() => ({}));
        throw new Error(error || "Could not create ticket");
      }

      const { ticketId } = await ticketRes.json();

      // 4. Process it: Google Vision OCR → Haiku parse. The ticket is already
      // saved, so an OCR failure is non-fatal — show a softer message and still
      // refresh the list (the ticket appears as "Uploaded" and can be retried).
      toast.loading("Reading ticket…", { id: toastId });
      const ocrRes = await fetch(`/api/user/tickets/${ticketId}/ocr`, {
        method: "POST",
      });

      if (ocrRes.ok) {
        toast.success("Ticket read", { id: toastId });
      } else {
        const { error } = await ocrRes.json().catch(() => ({}));
        toast.error(error || "Uploaded, but couldn't read the receipt", {
          id: toastId,
        });
      }

      onUploaded?.(ticketId);
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
    uploadTicket(file);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Hidden inputs: one with camera capture for mobile, one plain file picker. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept={ACCEPT}
        capture="environment"
        className="hidden"
        onChange={handleChange}
        disabled={isUploading}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={handleChange}
        disabled={isUploading}
      />

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={() => cameraInputRef.current?.click()}
          disabled={isUploading}
          className="flex h-12 items-center justify-center gap-2 rounded-full bg-foreground px-6 text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
        >
          {isUploading ? "Uploading…" : "Take photo"}
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="flex h-12 items-center justify-center gap-2 rounded-full border border-solid border-black/[.08] px-6 transition-colors hover:bg-black/[.04] disabled:opacity-50 dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
        >
          Upload file
        </button>
      </div>
    </div>
  );
}
