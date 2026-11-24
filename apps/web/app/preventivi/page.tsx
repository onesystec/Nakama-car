"use client";

import { FormEvent, useEffect, useState } from "react";
import { SectionShell } from "../../components/SectionShell";
import { useLanguage } from "../../components/LanguageProvider";
import { apiError, apiFetch, estimateTone, formatMoney, getAccessToken, hasPermission, hidesEstimates, homeFor, openProtectedFile, sessionUser } from "../../lib/api";
import { whatsappNumber } from "../../components/CaseTracking";
import { EstimateChip } from "../../components/EstimateChip";
import { missingPriceFields, money, priceLine } from "../../lib/estimatePricing";

type Estimate = {
  id: string;
  repair_case_id: string;
  estimate_number: string;
  status: string;
  version: number;
  subtotal: string;
  vat_total: string;
  total: string;
  notes?: string | null;
  contract_id?: string | null;
  labor_included?: boolean;
  labor_discount_percent?: string;
  parts_markup_percent?: string;
  case_number?: string;
  plate?: string;
  customer_name?: string;
  contract_name?: string | null;
  created_at?: string | null;
  diagnosis_number?: string | null;
  diagnosis_at?: string | null;
};

type Line = {
  id: string;
  category: string;
  description: string;
  quantity: string;
  unit_price: string;
  discount_percent: string;
  labor_hours: string;
  labor_rate: string;
  paint_hours: string;
  paint_rate: string;
  materials: string;
  vat_rate: string;
  parts_amount?: string;
  labor_amount?: string;
  line_total?: string;
};

const statuses = ["", "DRAFT", "SENT", "APPROVED", "REJECTED"];
const categories = ["PART", "MECHANICAL_LABOR", "DIAGNOSTIC", "ELECTRICAL", "BODY_LABOR", "PAINT", "MATERIAL", "EXTERNAL_SERVICE", "DISPOSAL", "OTHER"];
const rateKeyByCategory: Record<string, string> = {
  MECHANICAL_LABOR: "MECHANICAL", DIAGNOSTIC: "DIAGNOSTIC", ELECTRICAL: "ELECTRICAL", BODY_LABOR: "BODY", PAINT: "PAINT",
};
const numericFields: (keyof Line)[] = ["quantity", "unit_price", "discount_percent", "labor_hours", "labor_rate", "paint_hours", "paint_rate", "materials", "vat_rate"];

function blankLine(rates: Record<string, string>): Line {
  return {
    id: "", category: "PART", description: "", quantity: "1", unit_price: "0", discount_percent: "0",
    labor_hours: "0", labor_rate: rates.MECHANICAL || "50", paint_hours: "0", paint_rate: rates.PAINT || "48",
    materials: "0", vat_rate: "22",
  };
}

/** What a line looked like when last saved, to tell which rows have unsaved edits. */
function lineSignature(line: Line) {
  return JSON.stringify([line.category, line.description.trim(), ...numericFields.map((field) => Number(line[field] || 0))]);
}

function linePayload(line: Line) {
  const payload: Record<string, string | number> = { category: line.category, description: line.description.trim() };
  for (const field of numericFields) payload[field] = Number(line[field] || 0);
  return payload;
}


// Column names, shown above each number on phones (the table header is hidden there).
const fieldLabels: Partial<Record<string, string>> = {
  quantity: "Q.tà", unit_price: "Prezzo ricambio", discount_percent: "Sconto %", labor_hours: "Ore",
  labor_rate: "€/h", paint_hours: "Ore vernice", materials: "Materiali", vat_rate: "IVA %",
};
type Shared = {
  url: string; estimate_number: string | null; total: string | null; customer_name: string | null;
  customer_phone: string | null; customer_email: string | null; license_plate: string | null; answered: boolean;
};

export default function PreventiviPage() {
  const { t } = useLanguage();
  const [signedIn, setSignedIn] = useState(false);
  const [items, setItems] = useState<Estimate[]>([]);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [canCreate, setCanCreate] = useState(false);
  const [shared, setShared] = useState<Shared | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => setCanCreate(hasPermission("estimate.create")), []);

  async function load() {
    setBusy(true);
    try {
      const response = await apiFetch(`/estimates?q=${encodeURIComponent(search)}${status ? `&status=${status}` : ""}`);
      if (!response.ok) throw new Error(await apiError(response, "Impossibile caricare i preventivi."));
      setItems(await response.json());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore di connessione.");
    } finally {
      setBusy(false);
    }
  }

  // A mechanic who opens the address by hand goes back to their own home page.
  useEffect(() => {
    const user = sessionUser();
    if (hidesEstimates(user)) window.location.replace(homeFor(user));
  }, []);

  useEffect(() => {
    const token = Boolean(getAccessToken());
    setSignedIn(token);
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) setOpenId(id);
    if (!token) setBusy(false);
  }, []);

  useEffect(() => {
    if (getAccessToken() && !hidesEstimates(sessionUser())) load();
  }, [search, status]);

  async function act(path: string, init: RequestInit, fallback: string) {
    setError("");
    setNotice("");
    const response = await apiFetch(path, init);
    if (!response.ok) {
      setError(t(await apiError(response, fallback)));
      return null;
    }
    return response.json();
  }

  async function pdf(estimate: Estimate) {
    const failure = await openProtectedFile(`/estimates/${estimate.id}/pdf`, `${estimate.estimate_number}.pdf`);
    if (failure) setError(t(failure));
  }

  async function share(id: string) {
    const data = await act(`/estimates/${id}/share`, { method: "POST" }, "Impossibile creare il link");
    if (!data) return;
    setCopied(false);
    setShared({ ...data, url: `${window.location.origin}${data.public_path}` });
    load();
  }

  async function setEstimateStatus(id: string, next: string) {
    if (next === "APPROVED" && !confirm(t("Segnare il preventivo come accettato? Il lavoro passa in officina e il preventivo non sarà più modificabile."))) return;
    if (await act(`/estimates/${id}/status`, { method: "PATCH", body: JSON.stringify({ status: next }) }, "Impossibile aggiornare lo stato")) load();
  }

  async function createWorkOrder(id: string) {
    const order = await act(`/work-orders/from-estimate/${id}`, { method: "POST" }, "Impossibile creare ordine di lavoro");
    if (order) setNotice(t("Ordine {number} creato.").replace("{number}", order.work_order_number));
  }

  async function createInvoice(id: string) {
    const invoice = await act("/invoices", { method: "POST", body: JSON.stringify({ estimate_id: id }) }, "Impossibile creare fattura");
    if (invoice) setNotice(t("Fattura {number} creata.").replace("{number}", invoice.invoice_number));
  }

  return (
    <SectionShell title={t("Preventivi")} eyebrow={t("ESTIMATING ENGINE")} actions={canCreate && <a className="primary link-button" href="/?new=estimate">{t("+ Nuovo preventivo")}</a>}>
      {!signedIn ? (
        <div className="empty-state">{t("Accedi per visualizzare i preventivi.")} <a href="/login">{t("Accedi")}</a></div>
      ) : (
        <>
          <form className="record-search filters" onSubmit={(e: FormEvent) => { e.preventDefault(); setSearch(query.trim()); }}>
            <label>{t("Cerca")}<input type="search" value={query} placeholder={t("Numero, targa, n. flotta o cliente")} onChange={(e) => setQuery(e.target.value)} /></label>
            <label className="narrow">{t("Stato")}
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                {statuses.map((code) => <option key={code || "all"} value={code}>{code ? t(code) : t("Tutti")}</option>)}
              </select>
            </label>
            <button className="secondary">{t("Cerca")}</button>
          </form>
          {error && <div className="record-error" role="alert">{t(error)}</div>}
          {notice && <p className="staff-success" role="status">{notice}</p>}
          {shared && <SharePanel shared={shared} copied={copied} onCopy={() => navigator.clipboard.writeText(shared.url).then(() => setCopied(true), () => undefined)} onClose={() => setShared(null)} />}
          {openId && <EstimateEditor key={openId} id={openId} onClose={() => { setOpenId(null); window.history.replaceState(null, "", "/preventivi"); load(); }} onChanged={load} />}
          <div className="panel list-panel" aria-busy={busy}>
            <div className="data-table estimates head">
              <span>{t("Preventivo")}</span><span>{t("Cliente / targa")}</span><span>{t("Stato")}</span><span>{t("Imponibile")}</span><span>{t("Totale")}</span><span>{t("Azioni")}</span>
            </div>
            {busy ? <div className="empty-state">{t("Caricamento…")}</div> : items.length === 0 ? <div className="empty-state">{t("Nessun preventivo.")}</div> : items.map((x) => (
              <div className={`data-table estimates${estimateTone(x.status) ? ` tone-${estimateTone(x.status)}` : ""}`} key={x.id}>
                <span><strong>{x.estimate_number}</strong><small>{x.case_number} · v{x.version}{x.created_at ? ` · ${new Date(x.created_at).toLocaleDateString("it-IT")}` : ""}</small>{x.diagnosis_at && <small>📅 {t("Diagnosi del")} {new Date(x.diagnosis_at).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</small>}</span>
                <span>{x.customer_name}<small>{x.plate}{x.contract_name ? ` · ${t("Contratto")}: ${x.contract_name}` : ""}</small></span>
                <EstimateChip status={x.status} />
                <span>{formatMoney(x.subtotal)}</span>
                <strong>{formatMoney(x.total)}</strong>
                <span className="table-actions wrap">
                  <button onClick={() => { setOpenId(x.id); window.scrollTo({ top: 0, behavior: "smooth" }); }}>{x.status === "APPROVED" ? t("Apri") : t("Modifica")}</button>
                  <button onClick={() => pdf(x)}>PDF</button>
                  {x.status !== "APPROVED" && <button onClick={() => share(x.id)}>{t("Invia")}</button>}
                  {x.status !== "APPROVED" && <button className="tone-button accepted" onClick={() => setEstimateStatus(x.id, "APPROVED")}>{t("Accettato")}</button>}
                  {x.status !== "APPROVED" && x.status !== "REJECTED" && <button className="tone-button rejected" onClick={() => setEstimateStatus(x.id, "REJECTED")}>{t("Rifiutato")}</button>}
                  {x.status === "REJECTED" && <button className="tone-button pending" onClick={() => setEstimateStatus(x.id, "SENT")}>{t("Da valutare")}</button>}
                  {x.status === "APPROVED" && <button onClick={() => createWorkOrder(x.id)}>ODL</button>}
                  {x.status === "APPROVED" && <button onClick={() => createInvoice(x.id)}>{t("Fattura")}</button>}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </SectionShell>
  );
}

function EstimateEditor({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { t } = useLanguage();
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [rates, setRates] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [canEditPrices, setCanEditPrices] = useState(false);
  const [savedSignatures, setSavedSignatures] = useState<Record<string, string>>({});

  async function reload() {
    const [estimateResponse, linesResponse] = await Promise.all([apiFetch(`/estimates/${id}`), apiFetch(`/estimates/${id}/lines`)]);
    if (!estimateResponse.ok || !linesResponse.ok) {
      setError(t("Preventivo non trovato."));
      return;
    }
    setEstimate(await estimateResponse.json());
    const data: Line[] = await linesResponse.json();
    const loaded = data.map((line) => Object.fromEntries(Object.entries(line).map(([key, value]) => [key, value === null ? "" : String(value)])) as unknown as Line);
    setLines(loaded);
    setSavedSignatures(Object.fromEntries(loaded.map((line) => [line.id, lineSignature(line)])));
  }

  useEffect(() => {
    setCanEditPrices(hasPermission("estimate.change_price"));
    reload();
    apiFetch("/settings/labor-rates").then(async (response) => {
      if (!response.ok) return;
      const data: { labor_type: string; hourly_rate: string }[] = await response.json();
      setRates(Object.fromEntries(data.map((rate) => [rate.labor_type, String(rate.hourly_rate)])));
    });
  }, [id]);

  const locked = !estimate || estimate.status === "APPROVED";

  // Totals follow every keystroke: each line is priced here with the same rules as the server.
  const priced = lines.map((line) => ({
    amounts: priceLine(line, estimate),
    missing: new Set(missingPriceFields(line, estimate)),
    dirty: !line.id || savedSignatures[line.id] !== lineSignature(line),
  }));
  const liveSubtotal = money(priced.reduce((sum, row) => sum + row.amounts.subtotal, 0));
  const liveVat = money(priced.reduce((sum, row) => sum + row.amounts.vat, 0));
  const liveTotal = money(liveSubtotal + liveVat);
  const unpricedCount = priced.filter((row) => row.missing.size > 0).length;
  const dirtyCount = locked ? 0 : priced.filter((row) => row.dirty).length;

  function update(index: number, patch: Partial<Line>) {
    setLines((previous) => previous.map((line, position) => {
      if (position !== index) return line;
      const next = { ...line, ...patch };
      if (patch.category && rateKeyByCategory[patch.category] && rates[rateKeyByCategory[patch.category]]) {
        next.labor_rate = rates[rateKeyByCategory[patch.category]];
      }
      return next;
    }));
  }

  /** Save the order of the lines already in the database (unsaved new lines are skipped). */
  async function saveOrder(ids: string[]) {
    const response = await apiFetch(`/estimates/${id}/line-order`, { method: "PUT", body: JSON.stringify({ line_ids: ids.filter(Boolean) }) });
    if (!response.ok) setError(t(await apiError(response, "Impossibile salvare l’ordine delle righe.")));
    return response.ok;
  }

  async function moveLine(index: number, step: -1 | 1) {
    const target = index + step;
    if (target < 0 || target >= lines.length) return;
    const next = [...lines];
    [next[index], next[target]] = [next[target], next[index]];
    setLines(next);
    if (next[index].id && next[target].id) {
      setError("");
      if (!(await saveOrder(next.map((line) => line.id)))) await reload();
    }
  }

  async function saveLine(index: number, refresh = true): Promise<string | null> {
    const line = lines[index];
    if (!line.description.trim()) {
      setError(t("Inserisci la descrizione della riga."));
      return null;
    }
    setSavingId(line.id || `new-${index}`);
    setError("");
    const response = line.id
      ? await apiFetch(`/estimates/${id}/lines/${line.id}`, { method: "PUT", body: JSON.stringify(linePayload(line)) })
      : await apiFetch(`/estimates/${id}/lines`, { method: "POST", body: JSON.stringify(linePayload(line)) });
    setSavingId(null);
    if (!response.ok) {
      setError(t(response.status === 403 ? "Il tuo profilo non consente questa operazione." : await apiError(response, "Impossibile salvare la riga.")));
      return null;
    }
    const savedId: string = line.id || (await response.json()).id;
    if (refresh) {
      // A new line is added at the end on the server: keep it where it was placed here.
      if (!line.id && index < lines.length - 1) await saveOrder(lines.map((other, position) => (position === index ? savedId : other.id)));
      await reload();
      onChanged();
    }
    return savedId;
  }

  async function saveAll() {
    let ok = true;
    const ids = lines.map((line) => line.id);
    for (let index = 0; index < lines.length; index += 1) {
      if (!priced[index].dirty) continue;
      const savedId = await saveLine(index, false);
      if (!savedId) {
        ok = false;
        break;
      }
      ids[index] = savedId;
    }
    if (ok && lines.some((line) => !line.id)) await saveOrder(ids);
    await reload();
    onChanged();
    if (ok) setError("");
  }

  async function removeLine(index: number) {
    const line = lines[index];
    if (!line.id) {
      setLines((previous) => previous.filter((_, position) => position !== index));
      return;
    }
    if (!confirm(t("Eliminare questa riga dal preventivo?"))) return;
    const response = await apiFetch(`/estimates/${id}/lines/${line.id}`, { method: "DELETE" });
    if (!response.ok) {
      setError(t(await apiError(response, "Impossibile eliminare la riga.")));
      return;
    }
    await reload();
    onChanged();
  }

  async function toggleContract(apply: boolean) {
    setError("");
    const response = await apiFetch(`/estimates/${id}/pricing`, { method: "PATCH", body: JSON.stringify({ apply_contract: apply }) });
    if (!response.ok) {
      setError(t(response.status === 409 ? "Il cliente non ha un contratto flotta attivo." : await apiError(response, "Impossibile aggiornare i prezzi.")));
      return;
    }
    await reload();
    onChanged();
  }

  return (
    <section className="panel record-editor estimate-editor" aria-label={t("Preventivo")}>
      <div className="panel-head">
        <div>
          <h2>{estimate?.estimate_number || t("Caricamento…")}</h2>
          {estimate && <p><EstimateChip status={estimate.status} /> {t("Totale")} <strong>{formatMoney(liveTotal)}</strong> ({t("imponibile")} {formatMoney(liveSubtotal)} + {t("IVA")} {formatMoney(liveVat)})</p>}
          {estimate && (unpricedCount > 0 || dirtyCount > 0) && (
            <p className="estimate-flags">
              {unpricedCount > 0 && <span className="flag-missing">{unpricedCount === 1 ? t("1 riga senza prezzo") : t("{n} righe senza prezzo").replace("{n}", String(unpricedCount))}</span>}
              {dirtyCount > 0 && <span className="flag-dirty">{dirtyCount === 1 ? t("1 riga con modifiche non salvate") : t("{n} righe con modifiche non salvate").replace("{n}", String(dirtyCount))}</span>}
            </p>
          )}
        </div>
        <div className="panel-actions">
          {dirtyCount > 0 && <button className="primary" onClick={saveAll} disabled={savingId !== null}>{savingId !== null ? "…" : t("Salva tutto")}</button>}
          <button className="secondary" onClick={onClose}>{t("Chiudi")}</button>
        </div>
      </div>
      {error && <div className="record-error" role="alert">{error}</div>}
      {estimate && (
        <div className={`pricing-banner${estimate.contract_id ? " contract" : ""}`}>
          {estimate.contract_id ? (
            <span>
              <strong>{t("Prezzi da contratto flotta")}</strong>{" · "}
              {estimate.labor_included ? t("manodopera inclusa") : `${t("sconto manodopera")} ${Number(estimate.labor_discount_percent)}%`}
              {" · "}{t("ricambi")} +{Number(estimate.parts_markup_percent)}%
            </span>
          ) : <span><strong>{t("Listino al pubblico")}</strong></span>}
          {!locked && canEditPrices && (
            <button className="ghost" onClick={() => toggleContract(!estimate.contract_id)}>
              {estimate.contract_id ? t("Usa listino al pubblico") : t("Applica contratto del cliente")}
            </button>
          )}
        </div>
      )}
      {locked && estimate && <p className="hint">{t("Il preventivo approvato non è modificabile.")}</p>}
      <div className="line-editor" role="table" aria-label={t("Righe del preventivo")}>
        <div className="line-row head" role="row">
          <span>{t("Tipo")}</span><span>{t("Descrizione")}</span><span>{t("Q.tà")}</span><span>{t("Prezzo ricambio")}</span><span>{t("Sconto %")}</span>
          <span>{t("Ore")}</span><span>{t("€/h")}</span><span>{t("Ore vernice")}</span><span>{t("Materiali")}</span><span>{t("IVA %")}</span><span>{t("Totale")}</span><span />
        </div>
        {lines.length === 0 && <div className="empty-state">{t("Nessuna riga. Aggiungi ricambi e manodopera.")}</div>}
        {lines.map((line, index) => (
          <div className={`line-row${priced[index].missing.size ? " unpriced" : ""}${priced[index].dirty && !locked ? " dirty" : ""}`} role="row" key={line.id || `new-${index}`}>
            <select aria-label={t("Tipo")} disabled={locked} value={line.category} onChange={(e) => update(index, { category: e.target.value })}>
              {categories.map((code) => <option key={code} value={code}>{t(code)}</option>)}
            </select>
            <input aria-label={t("Descrizione")} disabled={locked} value={line.description} maxLength={255} onChange={(e) => update(index, { description: e.target.value })} />
            {(["quantity", "unit_price", "discount_percent", "labor_hours", "labor_rate", "paint_hours", "materials", "vat_rate"] as (keyof Line)[]).map((field) => (
              <label key={field} className={`line-field${priced[index].missing.has(field as never) ? " missing" : ""}`}>
                <small>{t(fieldLabels[field] || String(field))}</small>
                <input aria-label={t(fieldLabels[field] || String(field))} type="number" inputMode="decimal" min="0" step="0.01" disabled={locked} value={line[field] || ""} onChange={(e) => update(index, { [field]: e.target.value } as Partial<Line>)} />
              </label>
            ))}
            <span className="line-total">
              {formatMoney(priced[index].amounts.total)}
              {priced[index].missing.size > 0 && <small className="missing-note">{t("senza prezzo")}</small>}
              {estimate?.labor_included && Number(line.labor_hours) > 0 && <small>{t("manodopera inclusa")}</small>}
            </span>
            <span className="table-actions">
              {!locked && <button className="move-line" onClick={() => moveLine(index, -1)} disabled={index === 0} aria-label={t("Sposta su")} title={t("Sposta su")}>↑</button>}
              {!locked && <button className="move-line" onClick={() => moveLine(index, 1)} disabled={index === lines.length - 1} aria-label={t("Sposta giù")} title={t("Sposta giù")}>↓</button>}
              {!locked && <button className={priced[index].dirty ? "needs-save" : ""} onClick={() => saveLine(index)} disabled={savingId !== null}>{savingId === (line.id || `new-${index}`) ? "…" : t("Salva")}</button>}
              {!locked && <button onClick={() => removeLine(index)} aria-label={t("Elimina riga")}>✕</button>}
            </span>
          </div>
        ))}
      </div>
      {!locked && <button className="secondary add-line" onClick={() => setLines((previous) => [...previous, blankLine(rates)])}>{t("+ Riga")}</button>}
    </section>
  );
}

/** Send the estimate link to the customer: WhatsApp, e-mail or copy. The customer approves or refuses from the link. */
function SharePanel({ shared, copied, onCopy, onClose }: { shared: Shared; copied: boolean; onCopy: () => void; onClose: () => void }) {
  const { t } = useLanguage();
  const phone = whatsappNumber(shared.customer_phone);
  const total = shared.total ? formatMoney(shared.total) : "";
  const text = t("Gentile {name}, ecco il preventivo {number} per il veicolo {plate}{total}. Può consultarlo e approvarlo o rifiutarlo da questo link: {url}")
    .replace("{name}", shared.customer_name || t("cliente"))
    .replace("{number}", shared.estimate_number || "")
    .replace("{plate}", shared.license_plate || "")
    .replace("{total}", total ? ` (${t("totale")} ${total})` : "")
    .replace("{url}", shared.url);
  const subject = `${t("Preventivo")} ${shared.estimate_number || ""} · NAKAMA CAR`;
  return (
    <section className="panel share-panel" role="dialog" aria-label={t("Invia il preventivo al cliente")}>
      <header>
        <div>
          <h2>{t("Invia il preventivo al cliente")}</h2>
          <p>{shared.estimate_number} · {shared.customer_name}{shared.license_plate ? ` · ${shared.license_plate}` : ""}</p>
        </div>
        <button type="button" className="ghost" onClick={onClose} aria-label={t("Chiudi")}>✕</button>
      </header>
      {shared.answered && <p className="hint">{t("Il cliente ha già risposto a questo preventivo.")}</p>}
      <p className="share-text">{text}</p>
      <div className="share-actions">
        {phone
          ? <a className="button-link whatsapp" href={`https://wa.me/${phone}?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
          : <a className="button-link whatsapp" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">WhatsApp ({t("scegli contatto")})</a>}
        {shared.customer_email
          ? <a className="button-link secondary" href={`mailto:${shared.customer_email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`}>Email</a>
          : <a className="button-link secondary" href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`}>Email</a>}
        <button type="button" className="secondary" onClick={onCopy}>{copied ? t("Link copiato") : t("Copia link")}</button>
        <a className="button-link secondary" href={shared.url} target="_blank" rel="noopener noreferrer">{t("Anteprima")}</a>
      </div>
      {!phone && !shared.customer_email && <p className="hint">{t("Il cliente non ha telefono né email: aggiungili in Clienti per inviare direttamente.")}</p>}
      <p className="hint">{t("Quando il cliente approva, il lavoro compare subito al meccanico in «Il mio lavoro».")}</p>
    </section>
  );
}
