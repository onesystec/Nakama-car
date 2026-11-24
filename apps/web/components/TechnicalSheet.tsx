"use client";

import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "./LanguageProvider";
import { apiError, apiFetch, hasPermission } from "../lib/api";

type SheetVehicle = {
  id: string; license_plate: string; make?: string | null; model?: string | null; version?: string | null;
  vin?: string | null; engine_code?: string | null; fuel_type?: string | null; engine_size?: string | null; power_kw?: number | null;
};
type Sheet = {
  vehicle: SheetVehicle; model_known: boolean; model_label: string; fields: string[];
  data: Record<string, string | null>; source: string | null; updated_at: string | null; updated_by: string | null;
};

// Groups of the sheet: [field, label, example shown while typing].
const groups: { title: string; rows: [string, string, string][] }[] = [
  { title: "Olio motore", rows: [
    ["oil_spec", "Tipo / specifica", "es. 5W-30 ACEA C3"],
    ["oil_capacity", "Quantità con filtro", "es. 5,2 L"],
  ] },
  { title: "Filtri (codice ricambio)", rows: [
    ["oil_filter", "Filtro olio", "es. Bosch F 026 407 108"],
    ["air_filter", "Filtro aria", ""],
    ["fuel_filter", "Filtro gasolio / carburante", ""],
    ["cabin_filter", "Filtro abitacolo", ""],
  ] },
  { title: "Manutenzione", rows: [
    ["service_interval", "Intervallo tagliando", "es. 30.000 km / 2 anni"],
    ["timing_belt", "Distribuzione", "es. cinghia ogni 120.000 km / 6 anni"],
  ] },
  { title: "Liquidi", rows: [
    ["coolant", "Liquido refrigerante", "es. Paraflu Up, 9 L"],
    ["brake_fluid", "Liquido freni", "es. DOT 4"],
    ["gearbox_oil", "Olio cambio", "es. 75W-80, 2,0 L"],
  ] },
  { title: "Pneumatici e freni", rows: [
    ["tyre_size", "Misura pneumatici", "es. 225/75 R16C"],
    ["tyre_pressure_front", "Pressione anteriore", "es. 4,0 bar"],
    ["tyre_pressure_rear", "Pressione posteriore", "es. 4,5 bar"],
    ["brake_pads_front", "Pastiglie anteriori", "codice ricambio"],
    ["brake_pads_rear", "Pastiglie posteriori", "codice ricambio"],
  ] },
];

function when(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * "Scheda tecnica" of a registered vehicle: telaio and engine code of this plate, and the maintenance
 * data (oil, filters, intervals, fluids, tyres) of its model + engine, shared with every vehicle of the
 * same model. Nothing is ever guessed: an empty value reads "non disponibile". No <form> inside,
 * because it is also shown within the Diagnosi form.
 */
export function TechnicalSheet({ plate, onClose }: { plate: string; onClose?: () => void }) {
  const { t } = useLanguage();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [canWrite, setCanWrite] = useState(false);

  const load = useCallback(async () => {
    const response = await apiFetch(`/technical-sheets/vehicle/${encodeURIComponent(plate)}`);
    if (!response.ok) { setError(await apiError(response, "Impossibile caricare la scheda tecnica.")); return; }
    setSheet(await response.json());
  }, [plate]);

  useEffect(() => {
    setCanWrite(hasPermission("vehicle.write") || hasPermission("work_order.update_status"));
    setSheet(null); setDraft(null); setError(""); setNotice("");
    load().catch(() => setError("Errore di connessione."));
  }, [load]);

  function edit() {
    if (!sheet) return;
    const values: Record<string, string> = { vin: sheet.vehicle.vin || "", engine_code: sheet.vehicle.engine_code || "" };
    for (const field of sheet.fields) values[field] = sheet.data[field] || "";
    setDraft(values); setNotice(""); setError("");
  }

  async function save() {
    if (!sheet || !draft) return;
    setBusy(true); setError("");
    try {
      const data = Object.fromEntries(sheet.fields.map((field) => [field, draft[field] || null]));
      const response = await apiFetch(`/technical-sheets/vehicle/${encodeURIComponent(plate)}`, {
        method: "PUT", body: JSON.stringify({ vin: draft.vin || null, engine_code: draft.engine_code || null, data }),
      });
      if (!response.ok) { setError(await apiError(response, "Impossibile salvare la scheda tecnica.")); return; }
      setSheet(await response.json()); setDraft(null); setNotice("Scheda tecnica salvata.");
    } catch { setError("Errore di connessione."); } finally { setBusy(false); }
  }

  const value = (field: string) => (field === "vin" || field === "engine_code" ? sheet?.vehicle[field] : sheet?.data[field]) || "";
  const input = (field: string, label: string, example: string) => (
    <label key={field}>{t(label)}
      <input value={draft?.[field] || ""} placeholder={example ? t(example) : ""} maxLength={field === "notes" ? 1000 : 120}
        onChange={(event) => setDraft({ ...draft!, [field]: field === "vin" ? event.target.value.toUpperCase() : event.target.value })} />
    </label>
  );
  const row = (field: string, label: string) => (
    <div key={field}><dt>{t(label)}</dt>{value(field) ? <dd>{value(field)}</dd> : <dd className="not-available">{t("non disponibile")}</dd>}</div>
  );

  return (
    <section className="technical-sheet" aria-label={t("Scheda tecnica")}>
      <header className="technical-sheet-head">
        <div>
          <h3>{t("Scheda tecnica")}</h3>
          {sheet && <small>{sheet.model_known ? sheet.model_label : t("Marca e modello non indicati")}</small>}
        </div>
        {sheet?.source === "officina" && <span className="sheet-source" title={t("Valori inseriti dall'officina")}>{t("Dato officina")}</span>}
        {onClose && <button type="button" className="secondary" onClick={onClose}>{t("Chiudi")}</button>}
      </header>

      {error && <p className="record-error" role="alert">{t(error)}</p>}
      {notice && <p className="hint" role="status">{t(notice)}</p>}
      {!sheet && !error && <p className="hint">{t("Caricamento…")}</p>}

      {sheet && !draft && (
        <>
          <div className="technical-sheet-grid">
            <div>
              <h4>{t("Identificazione")}</h4>
              <dl className="vehicle-specs">{row("vin", "Telaio (VIN)")}{row("engine_code", "Codice motore")}</dl>
            </div>
            {groups.map((group) => (
              <div key={group.title}>
                <h4>{t(group.title)}</h4>
                <dl className="vehicle-specs">{group.rows.map(([field, label]) => row(field, label))}</dl>
              </div>
            ))}
          </div>
          {sheet.data.notes && <p className="technical-sheet-notes"><strong>{t("Note")}:</strong> {sheet.data.notes}</p>}
          <p className="hint">
            {sheet.updated_at
              ? `${t("Aggiornata")} ${when(sheet.updated_at)}${sheet.updated_by ? ` · ${sheet.updated_by}` : ""}. ${t("Vale per tutti i veicoli")} ${sheet.model_label}.`
              : t("Nessun dato ancora: compila la scheda dal libretto di uso e manutenzione o dalla fattura dei ricambi. Varrà per tutti i veicoli dello stesso modello e motore.")}
          </p>
          {canWrite && <button type="button" className="secondary" onClick={edit}>{t(sheet.updated_at ? "Modifica scheda" : "Compila scheda")}</button>}
        </>
      )}

      {sheet && draft && (
        <div className="technical-sheet-form">
          {!sheet.model_known && <p className="hint">{t("Indica prima marca e modello del veicolo: puoi salvare solo telaio e codice motore.")}</p>}
          <fieldset><legend>{t("Identificazione")}</legend>
            {input("vin", "Telaio (VIN)", "riquadro E del libretto")}
            {input("engine_code", "Codice motore", "riquadro P.5 del libretto")}
          </fieldset>
          {groups.map((group) => (
            <fieldset key={group.title} disabled={!sheet.model_known}><legend>{t(group.title)}</legend>
              {group.rows.map(([field, label, example]) => input(field, label, example))}
            </fieldset>
          ))}
          <fieldset disabled={!sheet.model_known}><legend>{t("Note")}</legend>{input("notes", "Note", "")}</fieldset>
          <p className="hint">{t("Scrivi solo valori verificati (manuale del costruttore o ricambio montato). Lascia vuoto se non lo sai.")}</p>
          <div className="record-form-actions">
            <button type="button" className="primary" disabled={busy} onClick={() => void save()}>{busy ? t("Salvataggio…") : t("Salva")}</button>
            <button type="button" className="secondary" disabled={busy} onClick={() => setDraft(null)}>{t("Annulla")}</button>
          </div>
        </div>
      )}
    </section>
  );
}
