"use client";

import { useEffect, useState } from "react";
import { SectionShell } from "../../components/SectionShell";
import { useLanguage } from "../../components/LanguageProvider";
import { StaffProfileData, StaffProfileEditor } from "../../components/StaffProfileEditor";
import { apiFetch, clearSession, getAccessToken } from "../../lib/api";

type Me = { first_name: string; last_name: string; email: string; roles: string[]; work_area: string | null; profile: StaffProfileData };

const roleNames: Record<string, string> = {
  ADMIN: "Amministrazione", RECEPTION: "Accettazione", BODYSHOP: "Carrozzeria", PAINTER: "Verniciatura", MECHANIC: "Meccanica", ACCOUNTING: "Contabilità",
};
const areaNames: Record<string, string> = { MECHANICAL: "Meccanica", BODY: "Carrozzeria" };

/** Each user keeps their own personal details and documents up to date. */
export default function ProfiloPage() {
  const { t } = useLanguage();
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<"loading" | "login" | "ready">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!getAccessToken()) { setState("login"); return; }
    apiFetch("/me").then(async (response) => {
      if (response.status === 401) { setState("login"); return; }
      setMe(await response.json());
      setState("ready");
    }).catch(() => setMessage("Errore di connessione."));
  }, []);

  return (
    <SectionShell title="Il mio profilo" eyebrow="PERSONALE">
      {state === "login" && <div className="empty-state">{t("Accedi")} <a href="/login">{t("Accedi")}</a></div>}
      {state === "ready" && me && (
        <div className="profile-layout">
          <section className="panel profile-card">
            <div className="profile-avatar" aria-hidden="true">{(me.first_name[0] || "") + (me.last_name[0] || "")}</div>
            <h2>{me.first_name} {me.last_name}</h2>
            <p>{me.email}</p>
            <div className="profile-chips">
              {me.roles.map((role) => <span key={role} className="status-chip">{t(roleNames[role] || role)}</span>)}
              {me.work_area && <span className={`status-chip area-${me.work_area.toLowerCase()}`}>{t("Area")}: {t(areaNames[me.work_area])}</span>}
            </div>
            <p className="hint">{t("Compila i tuoi dati e carica i documenti che ti chiede l’ufficio. Li vedete solo tu e l’amministrazione.")}</p>
            <button type="button" className="ghost" onClick={() => { clearSession(); window.location.assign("/login"); }}>{t("Esci")}</button>
          </section>
          <div className="panel"><StaffProfileEditor base="/me" admin={false} initial={me.profile} /></div>
        </div>
      )}
      {state === "loading" && <div className="empty-state">{message ? t(message) : t("Caricamento…")}</div>}
    </SectionShell>
  );
}
