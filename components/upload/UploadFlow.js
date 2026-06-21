"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { X, Camera, Upload, Check, SwitchCamera } from "lucide-react";
import { Button } from "@/components/ui";
import toast from "react-hot-toast";

const ACCEPT = "image/*";

export function UploadFlow({ onClose }) {
  const [isUploading, setIsUploading] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [stream, setStream] = useState(null);
  const [facingMode, setFacingMode] = useState("environment"); // "environment" = back, "user" = front
  const cameraInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  // Real upload logic (from TicketUpload)
  async function uploadTicket(file) {
    if (!file) return;

    setIsUploading(true);
    const toastId = toast.loading("Subiendo ticket...");

    try {
      // 1. Get presigned URL
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
        throw new Error(error || "No se pudo obtener URL de subida");
      }

      const { uploadUrl, key } = await tokenRes.json();

      // 2. Upload to R2
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });

      if (!putRes.ok) {
        throw new Error("Error al subir a storage");
      }

      // 3. Create Ticket
      const ticketRes = await fetch("/api/user/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageKey: key }),
      });

      if (!ticketRes.ok) {
        const { error } = await ticketRes.json().catch(() => ({}));
        throw new Error(error || "No se pudo crear el ticket");
      }

      const { ticketId } = await ticketRes.json();

      // 4. Run OCR
      toast.loading("Leyendo ticket...", { id: toastId });
      const ocrRes = await fetch(`/api/user/tickets/${ticketId}/ocr`, {
        method: "POST",
      });

      if (ocrRes.ok) {
        toast.success("Ticket procesado", { id: toastId });
      } else {
        const { error } = await ocrRes.json().catch(() => ({}));
        toast.error(error || "Subido, pero no se pudo leer", { id: toastId });
      }

      // Close modal on success
      onClose();
    } catch (error) {
      toast.error(error.message || "Algo salio mal", { id: toastId });
      setIsUploading(false);
    }
  }

  function handleChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    uploadTicket(file);
  }

  function handleDrop(event) {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file && file.type.startsWith("image/")) {
      uploadTicket(file);
    }
  }

  function handleDragOver(event) {
    event.preventDefault();
  }

  // Camera functions
  async function startCamera() {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode },
        audio: false,
      });
      setStream(mediaStream);
      setShowCamera(true);
      // Wait for video element to be available
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      }, 100);
    } catch (err) {
      // If getUserMedia fails, fall back to file input with capture
      console.warn("Camera access denied or not available, using fallback");
      cameraInputRef.current?.click();
    }
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
    setShowCamera(false);
  }

  async function toggleFacingMode() {
    const newMode = facingMode === "environment" ? "user" : "environment";
    setFacingMode(newMode);

    // Restart camera with new facing mode
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: newMode },
          audio: false,
        });
        setStream(mediaStream);
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      } catch (err) {
        console.warn("Could not switch camera");
      }
    }
  }

  function capturePhoto() {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;

    // Set canvas size to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw video frame to canvas
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0);

    // Convert to blob and upload
    canvas.toBlob(
      (blob) => {
        if (blob) {
          const file = new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" });
          stopCamera();
          uploadTicket(file);
        }
      },
      "image/jpeg",
      0.9
    );
  }

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [stream]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape" && !isUploading) onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose, isUploading]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "rgba(26, 23, 20, 0.5)", backdropFilter: "blur(4px)" }}
      onClick={() => !isUploading && onClose()}
    >
      <div
        className="w-full max-w-[460px]"
        style={{ fontFamily: "var(--font-sans)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Hidden file inputs */}
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
        {/* Hidden canvas for photo capture */}
        <canvas ref={canvasRef} className="hidden" />

        <div
          className="rounded-[var(--radius-2xl)] overflow-hidden"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            boxShadow: "var(--shadow-md)",
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-[18px_28px]">
            <Link href="/dashboard" className="flex items-center gap-2.5 no-underline">
              <span
                className="w-7 h-7 rounded-lg grid place-items-center text-white flex-none"
                style={{
                  background: "var(--brand)",
                  fontFamily: "var(--font-display)",
                  fontWeight: 800,
                  fontSize: 18,
                  boxShadow: "var(--shadow-brand)",
                }}
              >
                F
              </span>
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 800,
                  fontSize: 24,
                  letterSpacing: "-0.015em",
                  color: "var(--ink)",
                  lineHeight: 1,
                }}
              >
                Factur<span style={{ color: "var(--brand)" }}>i</span>n
              </span>
            </Link>
            <button
              onClick={() => !isUploading && onClose()}
              disabled={isUploading}
              className="w-9 h-9 grid place-items-center rounded-lg border cursor-pointer disabled:opacity-50"
              style={{
                background: "var(--bg-surface)",
                borderColor: "var(--border-default)",
                color: "var(--text-muted)",
              }}
            >
              <X className="w-[18px] h-[18px]" strokeWidth={1.9} />
            </button>
          </div>

          {/* Content */}
          <div className="p-[30px]">
            {showCamera ? (
              /* Camera view */
              <>
                <div className="flex items-center justify-between mb-4">
                  <h1
                    className="m-0"
                    style={{
                      fontFamily: "var(--font-display)",
                      fontWeight: 700,
                      fontSize: 22,
                      letterSpacing: "-0.02em",
                      color: "var(--ink)",
                    }}
                  >
                    Tomar foto
                  </h1>
                  <button
                    onClick={toggleFacingMode}
                    className="w-9 h-9 grid place-items-center rounded-lg border cursor-pointer"
                    style={{
                      background: "var(--bg-subtle)",
                      borderColor: "var(--border-default)",
                      color: "var(--text-muted)",
                    }}
                    title="Cambiar camara"
                  >
                    <SwitchCamera className="w-[18px] h-[18px]" strokeWidth={1.9} />
                  </button>
                </div>
                <div
                  className="relative rounded-xl overflow-hidden mb-4"
                  style={{ background: "#000", aspectRatio: "4/3" }}
                >
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                    style={{ transform: facingMode === "user" ? "scaleX(-1)" : "none" }}
                  />
                </div>
                <div className="flex gap-2.5">
                  <Button variant="secondary" fullWidth onClick={stopCamera}>
                    Cancelar
                  </Button>
                  <Button variant="primary" fullWidth onClick={capturePhoto}>
                    Capturar
                  </Button>
                </div>
              </>
            ) : (
              <>
                <h1
                  className="m-0"
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 700,
                    fontSize: 26,
                    letterSpacing: "-0.02em",
                    color: "var(--ink)",
                  }}
                >
                  {isUploading ? "Procesando..." : "Sube tu ticket"}
                </h1>
                <p className="text-[15px] mt-[7px] mb-[22px]" style={{ color: "var(--text-muted)" }}>
                  {isUploading
                    ? "Subiendo y leyendo tu recibo. No cierres esta ventana."
                    : "Toma una foto del recibo o sube una imagen."}
                </p>

                {isUploading ? (
                  /* Uploading state */
                  <div className="py-9 px-6 text-center rounded-xl" style={{ background: "var(--bg-subtle)" }}>
                    <div
                      className="w-14 h-14 rounded-full grid place-items-center mx-auto mb-4"
                      style={{ background: "var(--brand-soft)" }}
                    >
                      <span
                        className="w-[26px] h-[26px] rounded-full border-[2.5px]"
                        style={{
                          borderColor: "var(--brand-soft)",
                          borderTopColor: "var(--brand)",
                          animation: "fct-spin 0.8s linear infinite",
                        }}
                      />
                    </div>
                    <div className="text-base font-semibold" style={{ color: "var(--text-strong)" }}>
                      Procesando ticket...
                    </div>
                    <div className="text-[13px] mt-1" style={{ color: "var(--text-faint)" }}>
                      Esto puede tardar unos segundos
                    </div>
                  </div>
                ) : (
                  /* Dropzone */
                  <div
                    className="py-9 px-6 text-center cursor-pointer rounded-xl transition-all border-2 border-dashed hover:border-[var(--brand)] hover:bg-[var(--brand-soft)]"
                    style={{
                      borderColor: "var(--border-strong)",
                      background: "var(--bg-subtle)",
                    }}
                    onClick={() => fileInputRef.current?.click()}
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                  >
                    <span
                      className="w-14 h-14 rounded-full inline-grid place-items-center mb-[14px]"
                      style={{ background: "var(--brand-soft)", color: "var(--brand-press)" }}
                    >
                      <Camera className="w-[26px] h-[26px]" strokeWidth={1.8} />
                    </span>
                    <div className="text-base font-semibold" style={{ color: "var(--text-strong)" }}>
                      Arrastra o haz clic para subir
                    </div>
                    <div className="text-[13px] mt-1" style={{ color: "var(--text-faint)" }}>
                      JPG o PNG - hasta 10 MB
                    </div>
                  </div>
                )}

                {/* Buttons */}
                {!isUploading && (
                  <div className="flex gap-2.5 mt-4">
                    <Button
                      variant="primary"
                      fullWidth
                      onClick={startCamera}
                    >
                      Tomar foto
                    </Button>
                    <Button
                      variant="secondary"
                      fullWidth
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Subir archivo
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/*
 * ============================================================================
 * ANIMACIONES PARA FUTURO USO
 * ============================================================================
 * Cuando el flujo completo este listo (generacion de CFDI, etc.), se pueden
 * usar estas animaciones de pasos de procesamiento y pantalla de exito.
 *
 * Processing steps config:
 * const steps = [
 *   { icon: Upload, label: "Subiendo la foto" },
 *   { icon: Search, label: "Leyendo el ticket con OCR" },
 *   { icon: Sparkles, label: "Extrayendo datos con IA" },
 * ];
 *
 * StepRow component for animated progress:
 * function StepRow({ icon: Icon, label, state }) {
 *   // state: "pending" | "active" | "done"
 *   return (
 *     <div className={`flex items-center gap-[13px] transition-opacity duration-300 ${
 *       state === "pending" ? "opacity-40" : "opacity-100"
 *     }`}>
 *       <span className={`w-7 h-7 rounded-full flex-none grid place-items-center transition-all ${
 *         state === "done"
 *           ? "bg-[var(--brand)] text-white"
 *           : state === "active"
 *           ? "bg-[var(--brand-soft)] text-[var(--brand-press)]"
 *           : "bg-[var(--bg-inset)] text-[var(--brand-press)]"
 *       }`}>
 *         {state === "done" ? (
 *           <Check className="w-[14px] h-[14px]" strokeWidth={2.5} />
 *         ) : (
 *           <Icon className="w-[15px] h-[15px]" strokeWidth={1.9} />
 *         )}
 *       </span>
 *       <span className="text-[14.5px] font-medium" style={{ color: "var(--text-body)" }}>
 *         {label}
 *       </span>
 *       {state === "active" && (
 *         <span
 *           className="ml-auto w-2 h-2 rounded-full flex-none"
 *           style={{ background: "var(--brand)", animation: "fct-pulse 1s ease-in-out infinite" }}
 *         />
 *       )}
 *     </div>
 *   );
 * }
 *
 * Done/Success screen:
 * {phase === "done" && (
 *   <div className="rounded-[var(--radius-2xl)] p-[34px] text-center" style={{...}}>
 *     <div className="w-[66px] h-[66px] rounded-full grid place-items-center mx-auto mb-[18px]"
 *       style={{ background: "var(--brand)", boxShadow: "var(--shadow-brand)" }}>
 *       <Check className="w-8 h-8 text-white" strokeWidth={2.4} />
 *     </div>
 *     <h2>Factura lista!</h2>
 *     <p>Generamos el CFDI 4.0 de tu ticket de {result.merchant}.</p>
 *     // Summary card with merchant, RFC, folio, total
 *     // Action buttons: "Procesar otro" / "Ver factura"
 *   </div>
 * )}
 */
