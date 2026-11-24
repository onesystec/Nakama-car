"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

// Vehicle data the libretto can fill when the plate lookup did not: [field, label].
const identityRows: [string, string][] = [
  ["make", "Marca"], ["model", "Modello"], ["engine_size", "Cilindrata"], ["power_kw", "Potenza (kW)"], ["fuel_type", "Alimentazione"],
];
const libretto_fields = ["vin", "engine_code", ...identityRows.map(([field]) => field)];

/** Phone photos are large: send a JPEG of at most 1600 px (the API shrinks it again anyway). */
async function photoToJpeg(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("image"));
      element.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.88);
  } finally { URL.revokeObjectURL(url); }
}

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
  const [librettoReady, setLibrettoReady] = useState<boolean | null>(null);
  const [reading, setReading] = useState(false);
  const [fromLibretto, setFromLibretto] = useState<string[]>([]);
  const photoInput = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (!canWrite) return;
    apiFetch("/technical-sheets/libretto/status")
      .then((response) => (response.ok ? response.json() : null))
      .then((status) => setLibrettoReady(status ? Boolean(status.configured) : false))
      .catch(() => setLibrettoReady(false));
  }, [canWrite]);

  function startDraft() {
    if (!sheet) return null;
    const values: Record<string, string> = { vin: sheet.vehicle.vin || "", engine_code: sheet.vehicle.engine_code || "" };
    for (const [field] of identityRows) values[field] = String(sheet.vehicle[field as keyof SheetVehicle] ?? "");
    for (const field of sheet.fields) values[field] = sheet.data[field] || "";
    return values;
  }

  function edit() {
    setDraft(startDraft()); setFromLibretto([]); setNotice(""); setError("");
  }

  async function readLibretto(file: File | undefined) {
    if (!file || !sheet) return;
    setReading(true); setError(""); setNotice("");
    try {
      const image = await photoToJpeg(file);
      const response = await apiFetch("/technical-sheets/libretto", { method: "POST", body: JSON.stringify({ image }) });
      if (!response.ok) { setError(await apiError(response, "Impossibile leggere il libretto.")); return; }
      const { values } = await response.json() as { values: Record<string, string | null> };
      const next = draft ? { ...draft } : startDraft()!;
      const filled: string[] = [];
      for (const field of libretto_fields) {
        const read = values[field];
        if (!read) continue;
        // Make, model and engine from the plate lookup stay: the libretto only fills what is missing.
        const locked = identityRows.some(([name]) => name === field) && sheet.vehicle[field as keyof SheetVehicle];
        if (locked || next[field] === read) continue;
        next[field] = read; filled.push(field);
      }
      if (values.license_plate && values.license_plate.replace(/\s/g, "") !== sheet.vehicle.license_plate.replace(/\s/g, "")) {
        setError(`${t("Attenzione: sul libretto la targa è")} ${values.license_plate}. ${t("Controlla di aver fotografato il libretto giusto.")}`);
      }
      setDraft(next); setFromLibretto(filled);
      setNotice(filled.length ? "Valori letti dal libretto: controllali (evidenziati) e premi Salva." : "Il libretto non aggiunge dati nuovi a questa scheda.");
    } catch { setError("Impossibile leggere la foto."); } finally {
      setReading(false);
      if (photoInput.current) photoInput.current.value = "";
    }
  }

  async function save() {
    if (!sheet || !draft) return;
    setBusy(true); setError("");
    try {
      const data = Object.fromEntries(sheet.fields.map((field) => [field, draft[field] || null]));
      const response = await apiFetch(`/technical-sheets/vehicle/${encodeURIComponent(plate)}`, {
        method: "PUT", body: JSON.stringify({
          vin: draft.vin || null, engine_code: draft.engine_code || null, data,
          ...Object.fromEntries(identityRows.filter(([field]) => !sheet.vehicle[field as keyof SheetVehicle] && draft[field]?.trim())
            .map(([field]) => [field, field === "power_kw" ? Number.parseInt(draft[field], 10) || null : draft[field].trim()])),
        }),
      });
      if (!response.ok) { setError(await apiError(response, "Impossibile salvare la scheda tecnica.")); return; }
      setSheet(await response.json()); setDraft(null); setFromLibretto([]); setNotice("Scheda tecnica salvata.");
    } catch { setError("Errore di connessione."); } finally { setBusy(false); }
  }

  const modelReady = Boolean(sheet?.model_known || (draft?.make?.trim() && draft?.model?.trim()));
  const value = (field: string) => (field === "vin" || field === "engine_code" ? sheet?.vehicle[field] : sheet?.data[field]) || "";
  const input = (field: string, label: string, example: string) => (
    <label key={field} className={fromLibretto.includes(field) ? "from-libretto" : undefined}>{t(label)}
      <input value={draft?.[field] || ""} inputMode={field === "power_kw" ? "numeric" : undefined} placeholder={example ? t(example) : ""} maxLength={field === "notes" ? 1000 : 120}
        onChange={(event) => setDraft({ ...draft!, [field]: field === "vin" ? event.target.value.toUpperCase() : event.target.value })} />
      {fromLibretto.includes(field) && <small>{t("letto dal libretto")}</small>}
    </label>
  );
  const row = (field: string, label: string) => (
    <div key={field}><dt>{t(label)}</dt>{value(field) ? <dd>{value(field)}</dd> : <dd className="not-available">{t("non disponibile")}</dd>}</div>
  );

  const photoButton = canWrite && (
    <>
      <input ref={photoInput} type="file" accept="image/*" capture="environment" hidden
        onChange={(event) => void readLibretto(event.target.files?.[0])} />
      <button type="button" className="secondary" disabled={reading || busy || !librettoReady}
        title={librettoReady === false ? t("Lettura libretto non configurata: manca la chiave API.") : undefined}
        onClick={() => photoInput.current?.click()}>
        {reading ? t("Lettura del libretto…") : `📷 ${t("Leggi dal libretto")}`}
      </button>
      {librettoReady === false && <small className="hint">{t("Lettura libretto non configurata: manca la chiave API.")}</small>}
    </>
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
          {canWrite && (
            <div className="technical-sheet-actions">
              <button type="button" className="secondary" onClick={edit}>{t(sheet.updated_at ? "Modifica scheda" : "Compila scheda")}</button>
              {photoButton}
            </div>
          )}
        </>
      )}

      {sheet && draft && (
        <div className="technical-sheet-form">
          <div className="technical-sheet-actions">{photoButton}</div>
          {!modelReady && <p className="hint">{t("Indica marca e modello (o leggili dal libretto) per compilare il resto della scheda.")}</p>}
          <fieldset><legend>{t("Identificazione")}</legend>
            {input("vin", "Telaio (VIN)", "riquadro E del libretto")}
            {input("engine_code", "Codice motore", "riquadro P.5 del libretto")}
            {identityRows.filter(([field]) => !sheet.vehicle[field as keyof SheetVehicle]).map(([field, label]) =>
              input(field, label, ({ make: "riquadro D.1", model: "riquadro D.3", engine_size: "riquadro P.1", power_kw: "riquadro P.2", fuel_type: "riquadro P.3" } as Record<string, string>)[field]))}
          </fieldset>
          {groups.map((group) => (
            <fieldset key={group.title} disabled={!modelReady}><legend>{t(group.title)}</legend>
              {group.rows.map(([field, label, example]) => input(field, label, example))}
            </fieldset>
          ))}
          <fieldset disabled={!modelReady}><legend>{t("Note")}</legend>{input("notes", "Note", "")}</fieldset>
          <p className="hint">{t("Scrivi solo valori verificati (manuale del costruttore o ricambio montato). Lascia vuoto se non lo sai.")}</p>
          <div className="record-form-actions">
            <button type="button" className="primary" disabled={busy} onClick={() => void save()}>{busy ? t("Salvataggio…") : t("Salva")}</button>
            <button type="button" className="secondary" disabled={busy} onClick={() => { setDraft(null); setFromLibretto([]); setNotice(""); }}>{t("Annulla")}</button>
          </div>
        </div>
      )}
    </section>
  );
}
