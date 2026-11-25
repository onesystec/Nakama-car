"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useLanguage } from "./LanguageProvider";
import { apiError, apiFetch } from "../lib/api";

export type StaffProfileData = {
  phone: string | null; birth_date: string | null; birth_place: string | null; tax_code: string | null;
  address: string | null; city: string | null; postal_code: string | null; iban: string | null;
  emergency_contact: string | null; emergency_phone: string | null; skills: string | null; notes: string | null;
};
type StaffDocument = {
  id: string; kind: string; filename: string; content_type: string; size_bytes: number;
  expires_on: string | null; uploaded_by_me: boolean; created_at: string | null;
};

const emptyProfile: StaffProfileData = {
  phone: "", birth_date: "", birth_place: "", tax_code: "", address: "", city: "", postal_code: "", iban: "",
  emergency_contact: "", emergency_phone: "", skills: "", notes: "",
};
export const documentKinds: [string, string][] = [
  ["IDENTITY", "Documento d’identità"], ["DRIVING_LICENSE", "Patente"], ["CONTRACT", "Contratto"],
  ["CERTIFICATE", "Attestato o certificato"], ["OTHER", "Altro"],
];
const MAX_BYTES = 15 * 1024 * 1024;
const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function fileType(file: File) {
  if (file.type) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith(".heic")) return "image/heic";
  if (name.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (name.endsWith(".doc")) return "application/msword";
  return "application/octet-stream";
}
function size(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
function italianDate(value: string | null) {
  if (!value) return "";
  const [y, m, d] = value.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Personal sheet of a worker: details and personal documents.
 * `base` is "/me" (the worker on their own profile) or "/users/<id>" (the administration).
 */
export function StaffProfileEditor({ base, admin, initial, onSaved }: {
  base: string; admin: boolean; initial?: Partial<StaffProfileData> | null; onSaved?: (profile: StaffProfileData) => void;
}) {
  const { t } = useLanguage();
  const [form, setForm] = useState<StaffProfileData>(emptyProfile);
  const [loaded, setLoaded] = useState(Boolean(initial));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const fill = useCallback((profile: Partial<StaffProfileData> | null | undefined) => {
    setForm(Object.fromEntries(Object.keys(emptyProfile).map(key => [key, (profile as Record<string, string | null> | undefined)?.[key] ?? ""])) as StaffProfileData);
  }, []);

  useEffect(() => {
    if (initial) { fill(initial); setLoaded(true); return; }
    apiFetch(base === "/me" ? "/me" : `${base}/profile`).then(async response => {
      if (response.ok) fill((await response.json()).profile);
      setLoaded(true);
    }).catch(() => setMessage({ text: "Errore di connessione.", error: true }));
  }, [base, initial, fill]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setMessage(null);
    try {
      const response = await apiFetch(`${base}/profile`, { method: "PUT", body: JSON.stringify(form) });
      if (response.status === 422) {
        // Pydantic: [{msg: "Value error, IBAN non valido", ...}] → the first readable reason.
        const detail = (await response.json().catch(() => ({})))?.detail;
        const reason = Array.isArray(detail) ? String(detail[0]?.msg || "").replace(/^Value error, /, "") : "";
        setMessage({ text: reason && !/^(Input|String|Value)/.test(reason) ? reason : "Controlla i dati inseriti.", error: true });
        return;
      }
      if (!response.ok) { setMessage({ text: await apiError(response, "Impossibile salvare il profilo."), error: true }); return; }
      const data = await response.json();
      fill(data.profile);
      onSaved?.(data.profile);
      setMessage({ text: "Profilo salvato." });
    } finally { setSaving(false); }
  }

  const field = (key: keyof StaffProfileData, label: string, props: Record<string, unknown> = {}) => (
    <label>{t(label)}<input value={form[key] ?? ""} onChange={e => setForm({ ...form, [key]: e.target.value })} {...props} /></label>
  );

  if (!loaded) return <p className="hint">{t("Caricamento…")}</p>;
  return (
    <div className="staff-editor">
      <form className="record-form profile-form" onSubmit={save}>
        <h2 className="span-2">{t("Dati anagrafici")}</h2>
        {field("birth_date", "Data di nascita", { type: "date", max: new Date().toISOString().slice(0, 10) })}
        {field("birth_place", "Luogo di nascita")}
        {field("tax_code", "Codice fiscale", { autoCapitalize: "characters", maxLength: 20, style: { textTransform: "uppercase" } })}
        {field("phone", "Telefono", { type: "tel", autoComplete: "tel", inputMode: "tel" })}
        <h2 className="span-2">{t("Residenza")}</h2>
        <label className="span-2">{t("Indirizzo")}<input value={form.address ?? ""} autoComplete="street-address" onChange={e => setForm({ ...form, address: e.target.value })} /></label>
        {field("city", "Città", { autoComplete: "address-level2" })}
        {field("postal_code", "CAP", { inputMode: "numeric", autoComplete: "postal-code", maxLength: 16 })}
        <h2 className="span-2">{t("Pagamento stipendio")}</h2>
        <label className="span-2">{t("IBAN")}<input value={form.iban ?? ""} maxLength={42} autoCapitalize="characters" style={{ textTransform: "uppercase" }} placeholder="IT60 X054 2811 1010 0000 0123 456" onChange={e => setForm({ ...form, iban: e.target.value })} /></label>
        <h2 className="span-2">{t("Contatto di emergenza")}</h2>
        {field("emergency_contact", "Nome")}
        {field("emergency_phone", "Telefono", { type: "tel", inputMode: "tel" })}
        <label className="span-2">{t("Competenze e specializzazioni")}<textarea value={form.skills ?? ""} onChange={e => setForm({ ...form, skills: e.target.value })} placeholder={t("Es. diagnosi elettronica, climatizzazione, verniciatura a forno…")} /></label>
        <label className="span-2">{t("Note")}<textarea value={form.notes ?? ""} onChange={e => setForm({ ...form, notes: e.target.value })} /></label>
        {message && <p className={`span-2 ${message.error ? "auth-error" : "hint"}`} role={message.error ? "alert" : "status"}>{t(message.text)}</p>}
        <div className="record-form-actions span-2"><button className="primary" disabled={saving}>{saving ? t("Salvataggio…") : t("Salva dati")}</button></div>
      </form>
      <StaffDocuments base={base} admin={admin} />
    </div>
  );
}

/** Personal documents: only the worker and the administration can see them. */
export function StaffDocuments({ base, admin }: { base: string; admin: boolean }) {
  const { t } = useLanguage();
  const [items, setItems] = useState<StaffDocument[]>([]);
  const [kind, setKind] = useState("IDENTITY");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const response = await apiFetch(`${base}/documents`);
    if (response.ok) setItems(await response.json());
  }, [base]);
  useEffect(() => { void load(); }, [load]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); setError("");
    const failed: string[] = [];
    for (const file of Array.from(files)) {
      if (file.size > MAX_BYTES) { failed.push(`${file.name}: max 15 MB`); continue; }
      const params = new URLSearchParams({ filename: file.name, kind });
      if (expires) params.set("expires_on", expires);
      const response = await apiFetch(`${base}/documents?${params}`, { method: "POST", body: file, headers: { "Content-Type": fileType(file) } });
      if (!response.ok) failed.push(`${file.name}: ${t(await apiError(response, "Caricamento non riuscito."))}`);
    }
    if (failed.length) setError(failed.join(" · "));
    else setExpires("");
    await load();
    setBusy(false);
  }

  async function download(item: StaffDocument) {
    const response = await apiFetch(`${base}/documents/${item.id}`);
    if (!response.ok) { setError(await apiError(response, "Impossibile scaricare il file.")); return; }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url; link.download = item.filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function remove(item: StaffDocument) {
    if (!window.confirm(`${t("Eliminare il documento")} «${item.filename}»?`)) return;
    const response = await apiFetch(`${base}/documents/${item.id}`, { method: "DELETE" });
    if (!response.ok) { setError(await apiError(response, "Impossibile eliminare il file.")); return; }
    await load();
  }

  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  return (
    <section className="record-form profile-form staff-documents">
      <h2 className="span-2">{t("Documenti personali")}</h2>
      <p className="hint span-2">🔒 {admin ? t("Visibili solo al lavoratore e all’amministrazione.") : t("Visibili solo a te e all’amministrazione.")}</p>
      {items.length === 0 && <p className="hint span-2">{t("Nessun documento. Carica carta d’identità, patente, contratto o attestati (PDF, foto o Word).")}</p>}
      {items.length > 0 && <ul className="staff-document-list span-2">{items.map(item => {
        const expired = item.expires_on && item.expires_on < today;
        const expiring = !expired && item.expires_on && item.expires_on <= soon;
        return <li key={item.id} className="staff-document">
          <button type="button" className="ghost staff-document-name" onClick={() => download(item)}>📄 {item.filename}</button>
          <span className="status-chip">{t(documentKinds.find(([code]) => code === item.kind)?.[1] || item.kind)}</span>
          {item.expires_on && <span className={`status-chip${expired ? " staff-expired" : expiring ? " staff-expiring" : ""}`}>{expired ? t("Scaduto il") : t("Scade il")} {italianDate(item.expires_on)}</span>}
          <small>{size(item.size_bytes)}{item.created_at ? ` · ${italianDate(item.created_at)}` : ""}{!item.uploaded_by_me ? ` · ${admin ? t("caricato dal lavoratore") : t("caricato dall’amministrazione")}` : ""}</small>
          {(admin || item.uploaded_by_me) && <button type="button" className="ghost record-delete" onClick={() => remove(item)}>{t("Elimina")}</button>}
        </li>;
      })}</ul>}
      <label>{t("Tipo di documento")}<select value={kind} onChange={e => setKind(e.target.value)}>{documentKinds.map(([code, label]) => <option key={code} value={code}>{t(label)}</option>)}</select></label>
      <label>{t("Scadenza (facoltativa)")}<input type="date" value={expires} onChange={e => setExpires(e.target.value)} /></label>
      {error && <p className="auth-error span-2" role="alert">{error}</p>}
      <input ref={input} type="file" multiple hidden accept={ACCEPT} onChange={e => { const files = e.target.files; void upload(files).then(() => { if (input.current) input.current.value = ""; }); }} />
      <div className="record-form-actions span-2"><button type="button" className="secondary" disabled={busy} onClick={() => input.current?.click()}>{busy ? t("Caricamento…") : t("+ Carica documento")}</button></div>
    </section>
  );
}
