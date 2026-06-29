"use client";

import axios from "axios";
import { toast } from "react-hot-toast";
import { signIn } from "next-auth/react";
import config from "@/config";

// Centralized HTTP client for our own /api routes (replaces raw fetch).
// Both instances unwrap `response.data`, so `await apiClient.get(url)` returns the body.
const baseConfig = { baseURL: "/api" };
const unwrap = (response) => response.data;

// Default client: surfaces errors via react-hot-toast and bounces to login on 401.
// Use for one-shot user actions where the backend error string is good enough and the
// caller's catch only needs to clean up (e.g. dismiss a loading toast). The catch MUST
// NOT call toast.error again — the interceptor already did, or you'd double-toast.
const apiClient = axios.create(baseConfig);
apiClient.interceptors.response.use(unwrap, function (error) {
  // Aborted/superseded requests (AbortController, unmount) are not user-facing.
  if (axios.isCancel(error)) return Promise.reject(error);

  let message = "";
  if (error.response?.status === 401) {
    toast.error("Inicia sesión para continuar");
    return signIn(undefined, { callbackUrl: config.auth.callbackUrl });
  } else if (error.response?.status === 403) {
    message = error?.response?.data?.error || "No tienes acceso a esta función";
  } else {
    message = error?.response?.data?.error || error.message || error.toString();
  }

  error.message = typeof message === "string" ? message : JSON.stringify(message);
  console.error(error.message);
  toast.error(error.message || "Algo salió mal");
  return Promise.reject(error);
});

// Silent client: unwraps but NEVER toasts and NEVER redirects. Use when the caller owns
// the feedback: polling loops, non-fatal calls (OCR), inline-error flows (invoice),
// background refreshes that keep stale data, or any flow that drives its own
// toast.loading -> success/error lifecycle.
export const apiClientSilent = axios.create(baseConfig);
apiClientSilent.interceptors.response.use(unwrap, (error) => Promise.reject(error));

export default apiClient;
