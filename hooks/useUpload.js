"use client";

import { useCallback, useState } from "react";
import toast from "react-hot-toast";
import { uploadTicketFile } from "@/libs/upload";

/**
 * useTicketUpload — owns the toast lifecycle + uploading state for the ticket
 * upload flow. Takes the chosen empresa + uso de CFDI and returns an imperative
 * `uploadTicket(file)` the capture UI calls (camera, drop, file picker).
 *
 * On success it calls `onDone` (typically closes the modal); on error it clears
 * the uploading state so the user can retry.
 */
export function useTicketUpload({ companyId, usoCFDI, onDone } = {}) {
  const [isUploading, setIsUploading] = useState(false);

  const uploadTicket = useCallback(
    async (file) => {
      if (!file) return;

      setIsUploading(true);
      const id = toast.loading("Subiendo ticket...");
      try {
        const { ocrOk } = await uploadTicketFile(file, { companyId, usoCFDI });
        if (ocrOk) {
          toast.success("Ticket procesado", { id });
        } else {
          toast.error("Subido, pero no se pudo leer", { id });
        }
        onDone?.();
      } catch (e) {
        toast.error(
          e?.response?.data?.error || e.message || "Algo salió mal",
          { id }
        );
        setIsUploading(false);
      }
    },
    [companyId, usoCFDI, onDone]
  );

  return { isUploading, uploadTicket };
}
