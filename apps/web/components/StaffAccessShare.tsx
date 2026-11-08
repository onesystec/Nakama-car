"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "./LanguageProvider";
import { whatsappNumber } from "./CaseTracking";

export type IssuedAccess = { email: string; first_name: string; last_name: string; temporary_password: string; phone?: string | null };

/** The text sent to the worker: where to enter, the email and the temporary password. */
export function accessMessage(access: IssuedAccess, origin: string, t: (text: string) => string) {
  return [
    `${t("Ciao")} ${access.first_name}, ${t("ecco il tuo accesso a Nakama Car.")}`,
    `${t("Entra da")}: ${origin}/login`,
    `${t("Email")}: ${access.email}`,
    `${t("Password temporanea")}: ${access.temporary_password}`,
    t("Al primo accesso ti chiederà di scegliere la tua password."),
    `${t("App Android")}: ${origin}/downloads/android.html`,
  ].join("\n");
}

/** Shown once, right after the account is created or the access is sent again: share it with the worker. */
export function StaffAccessShare({ access, onClose }: { access: IssuedAccess; onClose: () => void }) {
  const { t } = useLanguage();
  const [origin, setOrigin] = useState("");
  const [canShare, setCanShare] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  const text = accessMessage(access, origin, t);
  const subject = t("Il tuo accesso a Nakama Car");
  const phone = whatsappNumber(access.phone);

  async function share() {
    try { await navigator.share({ title: subject, text }); setNotice(t("Accesso condiviso.")); }
    catch { /* closed without sending */ }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(text); setNotice(t("Messaggio copiato: incollalo dove vuoi.")); }
    catch { setNotice(t("Impossibile copiare: seleziona il testo e copialo a mano.")); }
  }

  return (
    <div className="issued-password staff-access-share" role="status">
      <p><strong>{t("Accesso per")} {access.first_name} {access.last_name}</strong></p>
      <p className="hint">{t("La password temporanea si vede solo ora. Inviala al lavoratore: al primo accesso sceglierà la sua password.")}</p>
      <pre className="staff-access-text">{text}</pre>
      <div className="share-actions">
        {canShare && <button type="button" className="primary" onClick={share}>{t("Condividi")}</button>}
        <a className="button-link whatsapp" href={`https://wa.me/${phone}?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">{phone ? "WhatsApp" : `WhatsApp (${t("scegli contatto")})`}</a>
        <a className="button-link secondary" href={`mailto:${access.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`}>{t("Email")}</a>
        <button type="button" className="secondary" onClick={copy}>{t("Copia messaggio")}</button>
        <button type="button" className="ghost" onClick={onClose}>{t("Fatto")}</button>
      </div>
      {notice && <p className="hint">{notice}</p>}
    </div>
  );
}
