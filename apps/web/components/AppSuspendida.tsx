"use client";

import { useEffect, useState } from "react";
import { APP_SUSPENDIDA_EVENT } from "../lib/api";
import { useLanguage } from "./LanguageProvider";

// Pantalla completa cuando ONESYSTEC GENERALE ha apagado la app (el backend responde 503 APP_SUSPENDIDA).
// "Reintentar" recarga: si la app sigue apagada, la primera llamada a la API vuelve a mostrar esta pantalla.
export function AppSuspendida() {
  const { t } = useLanguage();
  const [mensaje, setMensaje] = useState<string | null>(null);

  useEffect(() => {
    const alSuspender = (e: Event) => setMensaje((e as CustomEvent<string>).detail || "");
    window.addEventListener(APP_SUSPENDIDA_EVENT, alSuspender);
    return () => window.removeEventListener(APP_SUSPENDIDA_EVENT, alSuspender);
  }, []);

  if (mensaje === null) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="app-suspendida-titulo"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        padding: "env(safe-area-inset-top, 0px) 28px env(safe-area-inset-bottom, 0px)",
        background: "#070b19",
        color: "#fff",
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          border: "1px solid rgba(252,211,77,.4)",
          background: "rgba(120,53,15,.4)",
        }}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fcd34d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      </div>
      <h1 id="app-suspendida-titulo" style={{ maxWidth: 440, margin: 0, fontSize: 24, fontWeight: 800 }}>
        {t("NAKAMA CAR non è disponibile in questo momento")}
      </h1>
      <p style={{ maxWidth: 440, margin: 0, fontSize: 16, lineHeight: 1.6, color: "#9ca3af" }}>
        {mensaje || t("Stiamo facendo manutenzione. Torna disponibile a breve.")}
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          minHeight: 48,
          padding: "0 28px",
          border: 0,
          borderRadius: 12,
          background: "#06b6d4",
          color: "#04111a",
          fontWeight: 800,
          fontSize: 14,
          letterSpacing: 1,
          textTransform: "uppercase",
          cursor: "pointer",
        }}
      >
        {t("Riprova")}
      </button>
      <span style={{ paddingTop: 24, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "#9ca3af" }}>
        {t("Gestito da ONE SYSTEC")}
      </span>
    </div>
  );
}
