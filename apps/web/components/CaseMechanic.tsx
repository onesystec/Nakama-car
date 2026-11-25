"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "./LanguageProvider";
import { apiError, apiFetch } from "../lib/api";

type Technician = { id: string; name: string; area: string | null };
type Props = {
  caseId: string;
  workType?: string;
  status?: string;
  mechanicId?: string | null;
  mechanicName?: string | null;
  since?: string | null;
  // Office (case.create) can put someone on the case or correct it; admins also on closed cases.
  canAssign: boolean;
  isAdmin: boolean;
  onChange: (mechanic: { mechanic_id: string | null; mechanic_name: string | null; mechanic_assigned_at: string | null }) => void;
};

const CLOSED = new Set(["DELIVERED", "INVOICED"]);

/** Who opened the job in the workshop: stays on the case to the end, so it is clear who did the work. */
export function CaseMechanic({ caseId, workType, status, mechanicId, mechanicName, since, canAssign, isAdmin, onChange }: Props) {
  const { language } = useLanguage();
  const words = (it: string, es: string) => (language === "es" ? es : it);
  const [editing, setEditing] = useState(false);
  const [technicians, setTechnicians] = useState<Technician[] | null>(null);
  const [choice, setChoice] = useState(mechanicId || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setEditing(false); setError(""); setChoice(mechanicId || ""); }, [caseId, mechanicId]);
  useEffect(() => {
    if (!editing || technicians) return;
    apiFetch("/cases/technicians").then(r => (r.ok ? r.json() : [])).then(setTechnicians).catch(() => setTechnicians([]));
  }, [editing, technicians]);

  const role = workType === "BODY" ? words("Carrozziere", "Chapista") : words("Meccanico", "Mecánico");
  const locked = CLOSED.has(String(status)) && !isAdmin;
  const date = since ? new Date(since).toLocaleDateString(language === "es" ? "es-ES" : "it-IT") : "";
  // Workers of the case's area first, the others after.
  const sorted = (technicians || []).slice().sort((a, b) => Number(b.area === workType) - Number(a.area === workType));

  async function save() {
    setBusy(true); setError("");
    try {
      const response = await apiFetch(`/cases/${caseId}/mechanic`, { method: "PUT", body: JSON.stringify({ mechanic_id: choice || null }) });
      if (!response.ok) throw new Error(await apiError(response, words("Operazione non riuscita. Riprova.", "La operación falló. Inténtalo de nuevo.")));
      const saved = await response.json();
      onChange({ mechanic_id: saved.mechanic_id, mechanic_name: saved.mechanic_name, mechanic_assigned_at: saved.mechanic_assigned_at });
      setEditing(false);
    } catch (e) { setError(e instanceof Error ? e.message : words("Errore di connessione.", "Error de conexión.")); }
    finally { setBusy(false); }
  }

  return <div className="case-mechanic">
    <span className="case-mechanic-icon" aria-hidden>🔧</span>
    <div className="case-mechanic-body">
      <small>{role}</small>
      {mechanicName
        ? <strong>{mechanicName}</strong>
        : <em>{words("Nessuno ancora: resta registrato chi fa la diagnosi o il primo lavoro.", "Nadie todavía: queda registrado quien haga el diagnóstico o el primer trabajo.")}</em>}
      {mechanicName && date && <small>{words(`Ha aperto la pratica il ${date}`, `Abrió el expediente el ${date}`)}</small>}
    </div>
    {canAssign && !editing && !locked && <button type="button" className="ghost" onClick={() => setEditing(true)}>{mechanicName ? words("Cambia", "Cambiar") : words("Assegna", "Asignar")}</button>}
    {editing && <div className="case-mechanic-edit">
      <select value={choice} disabled={busy || !technicians} onChange={e => setChoice(e.target.value)} aria-label={role}>
        <option value="">{technicians ? words("— Nessuno —", "— Nadie —") : words("Caricamento…", "Cargando…")}</option>
        {sorted.map(t => <option key={t.id} value={t.id}>{t.name}{t.area && t.area !== workType ? ` (${t.area === "BODY" ? words("carrozzeria", "carrocería") : words("meccanica", "mecánica")})` : ""}</option>)}
      </select>
      <button type="button" className="primary" disabled={busy || choice === (mechanicId || "")} onClick={save}>{busy ? words("Salvataggio…", "Guardando…") : words("Salva", "Guardar")}</button>
      <button type="button" className="secondary" disabled={busy} onClick={() => { setEditing(false); setChoice(mechanicId || ""); }}>{words("Annulla", "Cancelar")}</button>
    </div>}
    {error && <p role="alert" className="case-mechanic-error">{error}</p>}
  </div>;
}
