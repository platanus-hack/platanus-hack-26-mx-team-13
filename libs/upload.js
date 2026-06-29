import { apiClientSilent } from "@/libs/api";

// Shared upload pipeline (replaces the logic that was copy-pasted across
// UploadFlow, TicketUpload and CsfUpload). Pure async helpers — no React, no
// toasts: callers (the useUpload hook / form handlers) own the user feedback.
//
// The /api/user/* calls go through apiClientSilent so the caller drives a single
// toast lifecycle (avoids double-toast with the toasting interceptor). The PUT to
// R2 stays a raw fetch on purpose: it targets an external presigned URL, so the
// "/api" baseURL must not apply and axios must not transform the File body.

/**
 * Request a presigned URL and PUT the file straight to R2.
 * @returns {Promise<string>} the R2 object key.
 */
export async function uploadFileToR2(file, { kind, contentType, fileName } = {}) {
  const ct = contentType ?? file.type ?? "application/octet-stream";
  const { uploadUrl, key } = await apiClientSilent.post(
    "/user/generate-upload-token",
    {
      fileName: fileName ?? file.name ?? kind,
      contentType: ct,
      kind,
    }
  );
  // Content-Type must match the one baked into the presigned signature or R2 rejects the PUT.
  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": ct },
    body: file,
  });
  if (!putRes.ok) throw new Error("Error al subir a storage");
  return key;
}

/**
 * Ticket pipeline: R2 -> create Ticket (pinning empresa + uso de CFDI) -> OCR.
 * OCR is non-fatal (the ticket is already saved), so it never throws — the
 * caller decides how to message a failed read via `ocrOk`.
 * @returns {Promise<{ ticketId: string, ocrOk: boolean }>}
 */
export async function uploadTicketFile(file, { companyId, usoCFDI } = {}) {
  const key = await uploadFileToR2(file, { kind: "ticket" });
  const { ticketId } = await apiClientSilent.post("/user/tickets", {
    imageKey: key,
    companyId,
    usoCFDI,
  });
  let ocrOk = true;
  try {
    await apiClientSilent.post(`/user/tickets/${ticketId}/ocr`);
  } catch {
    ocrOk = false; // ticket persisted; it shows as "uploaded" and can be retried.
  }
  return { ticketId, ocrOk };
}

/**
 * CSF pipeline: token + PUT only (always a PDF). The parent then calls
 * extract-csf with the returned key.
 * @returns {Promise<string>} the R2 object key.
 */
export async function uploadCsfFile(file) {
  return uploadFileToR2(file, {
    kind: "csf",
    contentType: "application/pdf",
    fileName: file.name || "csf.pdf",
  });
}
