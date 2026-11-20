"use client";

import { useCallback, useEffect, useState } from "react";
import { API_URL, APP_SUSPENDIDA_EVENT } from "../lib/api";
import { useLanguage } from "./LanguageProvider";

// Pantalla completa cuando ONESYSTEC GENERALE ha apagado la app (el backend responde 503 APP_SUSPENDIDA).
// - Mantenimiento (motivo "mantenimiento" o "apagada"): símbolo de carga y el aviso. Cada 30 s comprueba sola si la app ha
//   vuelto y, en cuanto vuelve, recarga la página.
// - Servicio suspendido (motivo "pago" o "acceso"): aviso serio, con la indicación de contactar al proveedor del servicio.
const COMPROBAR_MS = 30_000;

type Estado = { mensaje: string; motivo: string };

/** true si la API ya responde algo que no es "app suspendida" (cualquier ruta sirve: el interruptor va antes del enrutado). */
async function appVolvio(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/v1/auth/me`, { cache: "no-store" });
    if (res.status !== 503) return true;
    const body = await res.json().catch(() => null);
    return body?.code !== "APP_SUSPENDIDA";
  } catch {
    return false; // sin conexión: se sigue esperando
  }
}

export function AppSuspendida() {
  const { t } = useLanguage();
  const [estado, setEstado] = useState<Estado | null>(null);
  const [comprobando, setComprobando] = useState(false);

  useEffect(() => {
    const alSuspender = (e: Event) => {
      const d = (e as CustomEvent<Partial<Estado> | string>).detail;
      setEstado(typeof d === "string" ? { mensaje: d, motivo: "" } : { mensaje: d?.mensaje || "", motivo: d?.motivo || "" });
    };
    window.addEventListener(APP_SUSPENDIDA_EVENT, alSuspender);
    return () => window.removeEventListener(APP_SUSPENDIDA_EVENT, alSuspender);
  }, []);

  const comprobar = useCallback(async () => {
    setComprobando(true);
    if (await appVolvio()) window.location.reload();
    else setComprobando(false);
  }, []);

  const suspendido = estado?.motivo === "pago" || estado?.motivo === "acceso";

  useEffect(() => {
    if (!estado || suspendido) return undefined;
    const id = window.setInterval(comprobar, COMPROBAR_MS);
    return () => window.clearInterval(id);
  }, [estado, suspendido, comprobar]);

  if (estado === null) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="app-suspendida-titulo"
      aria-describedby="app-suspendida-texto"
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
      <style>{"@keyframes app-suspendida-giro{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.app-suspendida-carga{animation:none!important}}"}</style>
      {suspendido ? (
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            border: "1px solid rgba(248,113,113,.5)",
            background: "rgba(127,29,29,.5)",
          }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fca5a5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </div>
      ) : (
        <div
          className="app-suspendida-carga"
          role="img"
          aria-label={t("Caricamento")}
          style={{
            width: 64,
            height: 64,
            borderRadius: "50%",
            border: "4px solid rgba(6,182,212,.2)",
            borderTopColor: "#22d3ee",
            animation: "app-suspendida-giro 1s linear infinite",
          }}
        />
      )}
      <h1 id="app-suspendida-titulo" style={{ maxWidth: 440, margin: 0, fontSize: 24, fontWeight: 800 }}>
        {suspendido ? t("Servizio sospeso") : t("Nakama Car è in manutenzione")}
      </h1>
      <p id="app-suspendida-texto" style={{ maxWidth: 440, margin: 0, fontSize: 16, lineHeight: 1.6, color: "#d1d5db" }}>
        {suspendido ? t("Il servizio è sospeso. Per riattivarlo, contatta il tuo fornitore del servizio.") : t("Stiamo facendo manutenzione. Torna disponibile a breve.")}
      </p>
      {estado.mensaje && (
        <p style={{ maxWidth: 440, margin: 0, padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,.15)", background: "rgba(255,255,255,.06)", fontSize: 15, lineHeight: 1.5, color: "#f3f4f6" }}>
          {estado.mensaje}
        </p>
      )}
      {suspendido ? (
        <p
          style={{
            maxWidth: 440,
            margin: 0,
            padding: "12px 16px",
            borderRadius: 12,
            border: "1px solid rgba(248,113,113,.4)",
            background: "rgba(127,29,29,.35)",
            color: "#fecaca",
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          {t("Per qualsiasi informazione, contatta il tuo fornitore del servizio.")}
        </p>
      ) : (
        <p style={{ maxWidth: 440, margin: 0, fontSize: 14, color: "#9ca3af" }}>{t("Controlliamo da soli ogni 30 secondi: l'app si riapre appena torna attiva.")}</p>
      )}
      <button
        type="button"
        onClick={() => void comprobar()}
        disabled={comprobando}
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
          cursor: comprobando ? "wait" : "pointer",
          opacity: comprobando ? 0.6 : 1,
        }}
      >
        {comprobando ? "…" : t("Riprova")}
      </button>
      <span style={{ paddingTop: 24, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "#9ca3af" }}>
        {t("Gestito da ONESYSTEC GENERALE")}
      </span>
    </div>
  );
}
