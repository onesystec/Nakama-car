"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiError, apiFetch } from "../lib/api";
import { portalError, portalFetch } from "../lib/portal";
import { useLanguage } from "./LanguageProvider";

type RequestKind = "MAINTENANCE" | "ONE_TRACK";
type ServiceRequest = {
  id: string;
  license_plate: string;
  kind: RequestKind;
  note: string;
  created_at: string;
  handled_at: string | null;
};

const titles: Record<RequestKind, string> = {
  MAINTENANCE: "Manutenzione",
  ONE_TRACK: "Installazione GPS ONE TRACK",
};

function RequestList({ entries, onHandle, busy }: {
  entries: ServiceRequest[];
  onHandle?: (id: string) => void;
  busy?: boolean;
}) {
  const { t, language } = useLanguage();
  if (!entries.length) return <p className="hint">{t("Nessuna richiesta inviata.")}</p>;
  return (
    <ul className="portal-jobs">
      {entries.map((entry) => (
        <li key={entry.id}>
          <strong>{entry.license_plate} · {t(titles[entry.kind])}</strong>
          <div><small>{new Date(entry.created_at).toLocaleDateString(language === "it" ? "it-IT" : "es-ES")} · {t(entry.handled_at ? "Gestita" : "In attesa")}</small></div>
          {entry.note && <p style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{entry.note}</p>}
          {onHandle && !entry.handled_at && (
            <button type="button" className="secondary" disabled={busy} onClick={() => onHandle(entry.id)}>
              {t("Segna come gestita")}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function VehicleServiceRequests({ vehicleId }: { vehicleId: string }) {
  const { t } = useLanguage();
  const path = `/portal/vehicles/${vehicleId}/service-requests`;
  const [entries, setEntries] = useState<ServiceRequest[] | null>(null);
  const [kind, setKind] = useState<RequestKind>("MAINTENANCE");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await portalFetch(path, { signal });
      if (!response.ok) throw new Error(await portalError(response, "Impossibile caricare le richieste."));
      setEntries(await response.json());
    } catch (error) {
      if (!signal?.aborted) setMessage(error instanceof Error && error.name !== "TypeError" ? error.message : "Impossibile caricare le richieste.");
    }
  }, [path]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function send(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await portalFetch(path, { method: "POST", body: JSON.stringify({ kind, note }) });
      if (!response.ok) {
        setMessage(await portalError(response, "Richiesta non inviata."));
        if (response.status === 409) await load();
        return;
      }
      const entry: ServiceRequest = await response.json();
      setEntries((current) => [entry, ...(current || [])]);
      setNote("");
      setMessage("Richiesta inviata all’officina.");
    } catch {
      setMessage("Richiesta non inviata.");
    } finally {
      setBusy(false);
    }
  }

  const pending = entries?.some((entry) => entry.kind === kind && !entry.handled_at);
  return (
    <section className="panel">
      <h3>{t("Richieste all’officina")}</h3>
      <form className="record-form" onSubmit={send}>
        <label>{t("Tipo di richiesta")}
          <select value={kind} disabled={busy} onChange={(event) => setKind(event.target.value as RequestKind)}>
            <option value="MAINTENANCE">{t(titles.MAINTENANCE)}</option>
            <option value="ONE_TRACK">{t(titles.ONE_TRACK)}</option>
          </select>
        </label>
        <label>{t(kind === "MAINTENANCE" ? "Manutenzione richiesta" : "Note per l’officina")}
          <textarea value={note} required={kind === "MAINTENANCE"} disabled={busy} maxLength={1000}
            onChange={(event) => setNote(event.target.value)} />
        </label>
        <div className="record-form-actions">
          <button className="primary" disabled={!entries || busy || pending || (kind === "MAINTENANCE" && !note.trim())}>{t("Invia richiesta")}</button>
        </div>
      </form>
      {pending && <p className="hint">{t("C’è già una richiesta di questo tipo in attesa.")}</p>}
      {message && <p role="status">{t(message)}</p>}
      {entries && <RequestList entries={entries} />}
    </section>
  );
}

export function CustomerServiceRequests({ customerId, canWrite }: { customerId: string; canWrite: boolean }) {
  const { t } = useLanguage();
  const path = `/customers/${customerId}/service-requests`;
  const [entries, setEntries] = useState<ServiceRequest[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await apiFetch(path, { signal: controller.signal });
        if (!response.ok) {
          setMessage(await apiError(response, "Impossibile caricare le richieste."));
          return;
        }
        setEntries(await response.json());
      } catch {
        if (!controller.signal.aborted) setMessage("Impossibile caricare le richieste.");
      }
    }
    void load();
    return () => controller.abort();
  }, [path]);

  async function handle(id: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await apiFetch(`${path}/${id}`, { method: "PATCH" });
      if (!response.ok) {
        setMessage(await apiError(response, "Richiesta non aggiornata."));
        return;
      }
      const updated: ServiceRequest = await response.json();
      setEntries((current) => current?.map((entry) => entry.id === id ? updated : entry) ?? null);
    } catch {
      setMessage("Richiesta non aggiornata.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h3>{t("Richieste dal portale")}</h3>
      {message && <p role="status">{t(message)}</p>}
      {entries && <RequestList entries={entries} onHandle={canWrite ? handle : undefined} busy={busy} />}
    </section>
  );
}
