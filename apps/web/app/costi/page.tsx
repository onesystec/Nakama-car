"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { SectionShell } from "../../components/SectionShell";
import { useLanguage } from "../../components/LanguageProvider";
import { apiError, apiFetch, formatMoney, getAccessToken, hasPermission } from "../../lib/api";

type Area = "MECHANICAL" | "BODY";
type AreaFilter = "" | Area;
type AreaTotals = {
  parts: string; labor_hours: string; paint_hours: string; labor_value: string;
  materials: string; external: string; other: string; expenses: string; total: string;
};
type PartRow = { id: string; date: string; case_number: string; plate: string; area: Area; description: string; oem_code?: string | null; quantity: string; unit_cost: string; total_cost: string; status: string };
type HoursRow = { case_id: string; date: string; case_number: string; plate: string; area: Area; labor_hours: string; paint_hours: string; labor_value: string; status: string };
type OtherRow = { id: string; date: string; case_number: string; plate: string; area: Area; category: string; description: string; amount: string };
type Expense = { id: string; date: string; description: string; category: string; area: Area | "GENERAL"; supplier?: string | null; amount: string; notes?: string | null };
type CostReport = {
  from: string; to: string;
  areas: Record<Area, AreaTotals>;
  general_expenses: string;
  parts: PartRow[]; hours: HoursRow[]; other_costs: OtherRow[]; expenses: Expense[];
};

const areaLabel: Record<string, string> = { MECHANICAL: "Meccanica", BODY: "Carrozzeria", GENERAL: "Generale" };
const otherLabel: Record<string, string> = { MATERIAL: "Materiali", EXTERNAL_SERVICE: "Servizio esterno", DISPOSAL: "Smaltimento", OTHER: "Altro" };
const expenseCategories = ["AFFITTO", "UTENZE", "ATTREZZATURA", "PERSONALE", "ASSICURAZIONI", "CARBURANTE", "CONSUMABILI", "FORNITORI", "ALTRO"];
const expenseLabel: Record<string, string> = {
  AFFITTO: "Affitto", UTENZE: "Utenze (luce, gas, acqua)", ATTREZZATURA: "Attrezzatura", PERSONALE: "Personale",
  ASSICURAZIONI: "Assicurazioni", CARBURANTE: "Carburante", CONSUMABILI: "Consumabili officina", FORNITORI: "Fornitori", ALTRO: "Altro",
};
const statusLabel: Record<string, string> = { APPROVED: "Approvato", SENT: "In attesa", READY: "Pronto", DRAFT: "Bozza", DELIVERED: "Consegnato", IN_REPAIR: "In lavorazione", INVOICED: "Fatturato" };
const tabs = [["summary", "Riepilogo"], ["parts", "Ricambi ordinati"], ["hours", "Ore lavorate"], ["other", "Altri costi"], ["expenses", "Spese Nakama Car"]] as const;
type Tab = typeof tabs[number][0];

const n = (value: string | number | null | undefined) => Number(value || 0);
const hours = (value: string | number) => `${n(value).toLocaleString("it-IT", { maximumFractionDigits: 1 })} h`;
function formatDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}
function monthRange(offset = 0) {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: iso(first), to: iso(last) };
}

export default function CostiPage() {
  const { t } = useLanguage();
  const [signedIn, setSignedIn] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [range, setRange] = useState(monthRange());
  const [area, setArea] = useState<AreaFilter>("");
  const [tab, setTab] = useState<Tab>("summary");
  const [query, setQuery] = useState("");
  const [report, setReport] = useState<CostReport | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const response = await apiFetch(`/costs?from=${range.from}&to=${range.to}`);
      if (!response.ok) throw new Error(await apiError(response, "Impossibile caricare i costi."));
      setReport(await response.json());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore di connessione.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const token = Boolean(getAccessToken());
    setSignedIn(token);
    setCanEdit(hasPermission("invoice.create"));
    if (!token) setBusy(false);
  }, []);
  useEffect(() => { if (getAccessToken()) void load(); }, [range.from, range.to]);

  async function removeExpense(expense: Expense) {
    if (!confirm(`${t("Eliminare la spesa")} «${expense.description}» (${formatMoney(expense.amount)})?`)) return;
    const response = await apiFetch(`/expenses/${expense.id}`, { method: "DELETE" });
    if (!response.ok) { setError(await apiError(response, "Impossibile eliminare la spesa.")); return; }
    await load();
  }

  const match = (row: { area: string; description?: string; case_number?: string; plate?: string; oem_code?: string | null; supplier?: string | null }) => {
    if (area && row.area !== area) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [row.description, row.case_number, row.plate, row.oem_code, row.supplier].some((value) => value?.toLowerCase().includes(q));
  };
  const parts = useMemo(() => (report?.parts || []).filter(match), [report, area, query]);
  const hourRows = useMemo(() => (report?.hours || []).filter(match), [report, area, query]);
  const others = useMemo(() => (report?.other_costs || []).filter(match), [report, area, query]);
  const expenses = useMemo(() => (report?.expenses || []).filter((row) => (!area || row.area === area || row.area === "GENERAL") && match({ ...row, area: area || row.area })), [report, area, query]);

  const shown: Area[] = area ? [area] : ["MECHANICAL", "BODY"];
  const sum = (key: keyof AreaTotals) => shown.reduce((total, code) => total + n(report?.areas[code]?.[key]), 0);
  const general = n(report?.general_expenses);
  const grandTotal = sum("total") + (area ? 0 : general);

  return (
    <SectionShell title={t("Costi officina")} eyebrow={t("AMMINISTRAZIONE")}>
      {!signedIn ? (
        <div className="empty-state">{t("Accedi per vedere i costi.")} <a href="/login">{t("Accedi")}</a></div>
      ) : (
        <div className="costs-page">
          <div className="costs-toolbar">
            <div className="costs-period">
              <button type="button" className={range.from === monthRange().from && range.to === monthRange().to ? "primary" : "secondary"} onClick={() => setRange(monthRange())}>{t("Questo mese")}</button>
              <button type="button" className={range.from === monthRange(-1).from && range.to === monthRange(-1).to ? "primary" : "secondary"} onClick={() => setRange(monthRange(-1))}>{t("Mese scorso")}</button>
              <label>{t("Dal")}<input type="date" value={range.from} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} /></label>
              <label>{t("Al")}<input type="date" value={range.to} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} /></label>
            </div>
            <div className="costs-area" role="tablist" aria-label={t("Reparto")}>
              {([["", "Tutto"], ["MECHANICAL", "Meccanica"], ["BODY", "Carrozzeria"]] as const).map(([code, label]) => (
                <button key={code || "all"} type="button" role="tab" aria-selected={area === code} className={`area-${code.toLowerCase() || "all"}${area === code ? " active" : ""}`} onClick={() => setArea(code)}>{t(label)}</button>
              ))}
            </div>
          </div>

          {error && <div className="record-error" role="alert">{t(error)}</div>}

          <section className="kpi-grid nakama-kpis costs-kpis" aria-busy={busy}>
            <button type="button" className="kpi-card" onClick={() => setTab("parts")}><span>{t("Ricambi ordinati")}</span><strong>{formatMoney(sum("parts"))}</strong><small>{parts.length} {t("righe ricambio")}</small></button>
            <button type="button" className="kpi-card" onClick={() => setTab("hours")}><span>{t("Ore lavorate")}</span><strong>{hours(sum("labor_hours") + sum("paint_hours"))}</strong><small>{t("Manodopera")} {hours(sum("labor_hours"))} · {t("Vernice")} {hours(sum("paint_hours"))}</small></button>
            <button type="button" className="kpi-card" onClick={() => setTab("other")}><span>{t("Altri costi")}</span><strong>{formatMoney(sum("materials") + sum("external") + sum("other"))}</strong><small>{t("Materiali, servizi esterni, smaltimento")}</small></button>
            <button type="button" className="kpi-card" onClick={() => setTab("expenses")}><span>{t("Spese Nakama Car")}</span><strong>{formatMoney(sum("expenses") + (area ? 0 : general))}</strong><small>{expenses.length} {t("spese registrate")}</small></button>
          </section>

          <div className="audit-tabs costs-tabs" role="tablist">
            {tabs.map(([code, label]) => <button key={code} type="button" role="tab" aria-selected={tab === code} className={tab === code ? "primary" : "secondary"} onClick={() => setTab(code)}>{t(label)}</button>)}
          </div>

          {tab !== "summary" && (
            <div className="costs-search"><input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Cerca targa, pratica, ricambio o codice")} aria-label={t("Cerca")} /></div>
          )}

          {busy && !report ? <div className="panel"><div className="empty-state">{t("Caricamento…")}</div></div> : report && (
            <>
              {tab === "summary" && (
                <div className="costs-summary">
                  <div className={`costs-compare${area ? " single" : ""}`}>
                    {shown.map((code) => {
                      const totals = report.areas[code];
                      return (
                        <article key={code} className={`panel costs-area-card area-${code.toLowerCase()}`}>
                          <div className="panel-head"><div><h2>{t("Costo")} {t(areaLabel[code])}</h2><p>{formatDate(report.from)} – {formatDate(report.to)}</p></div><strong className="costs-area-total">{formatMoney(totals.total)}</strong></div>
                          <dl className="costs-breakdown">
                            <div><dt>{t("Ricambi")}</dt><dd>{formatMoney(totals.parts)}</dd></div>
                            <div><dt>{t("Manodopera")}<small>{hours(totals.labor_hours)}{n(totals.paint_hours) > 0 ? ` + ${hours(totals.paint_hours)} ${t("vernice")}` : ""}</small></dt><dd>{formatMoney(totals.labor_value)}</dd></div>
                            <div><dt>{t("Materiali")}</dt><dd>{formatMoney(totals.materials)}</dd></div>
                            <div><dt>{t("Servizi esterni")}</dt><dd>{formatMoney(totals.external)}</dd></div>
                            <div><dt>{t("Altro / smaltimento")}</dt><dd>{formatMoney(totals.other)}</dd></div>
                            <div><dt>{t("Spese del reparto")}</dt><dd>{formatMoney(totals.expenses)}</dd></div>
                          </dl>
                          <div className="costs-bar" aria-hidden="true">
                            {(["parts", "labor_value", "materials", "external", "other", "expenses"] as const).map((key) => (
                              <i key={key} className={`seg-${key}`} style={{ width: `${n(totals.total) ? (n(totals[key]) / n(totals.total)) * 100 : 0}%` }} />
                            ))}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                  <div className="costs-legend" aria-hidden="true">
                    <span><i className="seg-parts" />{t("Ricambi")}</span><span><i className="seg-labor_value" />{t("Manodopera")}</span><span><i className="seg-materials" />{t("Materiali")}</span><span><i className="seg-external" />{t("Servizi esterni")}</span><span><i className="seg-other" />{t("Altro")}</span><span><i className="seg-expenses" />{t("Spese reparto")}</span>
                  </div>
                  <div className="panel costs-grand">
                    <div><span>{t("Spese generali Nakama Car")}</span><small>{t("Non legate a un reparto (affitto, utenze, assicurazioni…)")}</small></div>
                    <strong>{area ? "—" : formatMoney(general)}</strong>
                    <div><span>{area ? `${t("Totale")} ${t(areaLabel[area])}` : t("Totale costi del periodo")}</span></div>
                    <strong className="costs-grand-total">{formatMoney(grandTotal)}</strong>
                  </div>
                </div>
              )}

              {tab === "parts" && (
                <div className="panel list-panel">
                  <div className="panel-head"><div><h2>{t("Ricambi ordinati")}</h2><p>{t("Tutti i ricambi dei preventivi approvati nel periodo, con il costo d'acquisto.")}</p></div><strong>{formatMoney(parts.reduce((s, r) => s + n(r.total_cost), 0))}</strong></div>
                  <div className="data-table costs-parts head"><span>{t("Data")}</span><span>{t("Ricambio")}</span><span>{t("Pratica / targa")}</span><span>{t("Reparto")}</span><span>{t("Q.tà")}</span><span>{t("Costo unit.")}</span><span>{t("Costo")}</span></div>
                  {parts.length === 0 ? <div className="empty-state">{t("Nessun ricambio nel periodo.")}</div> : parts.map((row) => (
                    <div className="data-table costs-parts" key={row.id}>
                      <span className="c-date">{formatDate(row.date)}</span>
                      <span className="c-main"><strong>{row.description}</strong><small>{row.oem_code ? `OEM ${row.oem_code}` : t("Senza codice")}<i className="mobile-only"> · {formatDate(row.date)}</i></small></span>
                      <span className="c-ref">{row.case_number}<small className="plate-text">{row.plate}</small></span>
                      <span className="c-area"><em className={`area-pill area-${row.area.toLowerCase()}`}>{t(areaLabel[row.area])}</em></span>
                      <span className="c-x">{n(row.quantity).toLocaleString("it-IT")}</span>
                      <span className="c-sub"><i className="mobile-only">{n(row.quantity).toLocaleString("it-IT")} × </i>{formatMoney(row.unit_cost)}</span>
                      <strong className="c-amount">{formatMoney(row.total_cost)}</strong>
                    </div>
                  ))}
                </div>
              )}

              {tab === "hours" && (
                <div className="panel list-panel">
                  <div className="panel-head"><div><h2>{t("Ore lavorate")}</h2><p>{t("Ore di manodopera e verniciatura per pratica (dai preventivi approvati).")}</p></div><strong>{hours(hourRows.reduce((s, r) => s + n(r.labor_hours) + n(r.paint_hours), 0))}</strong></div>
                  <div className="data-table costs-hours head"><span>{t("Pratica / targa")}</span><span>{t("Reparto")}</span><span>{t("Stato")}</span><span>{t("Manodopera")}</span><span>{t("Vernice")}</span><span>{t("Totale ore")}</span><span>{t("Valore")}</span></div>
                  {hourRows.length === 0 ? <div className="empty-state">{t("Nessuna ora nel periodo.")}</div> : hourRows.map((row) => (
                    <div className="data-table costs-hours" key={row.case_id}>
                      <span className="c-main"><strong>{row.case_number}</strong><small className="plate-text">{row.plate}</small></span>
                      <span className="c-area"><em className={`area-pill area-${row.area.toLowerCase()}`}>{t(areaLabel[row.area])}</em></span>
                      <span className="c-date">{t(statusLabel[row.status] || row.status)}<small>{formatDate(row.date)}</small></span>
                      <span className="c-ref">{hours(row.labor_hours)}</span>
                      <span className="c-x">{n(row.paint_hours) ? hours(row.paint_hours) : "—"}</span>
                      <strong className="c-amount">{hours(n(row.labor_hours) + n(row.paint_hours))}</strong>
                      <span className="c-sub">{formatMoney(row.labor_value)}</span>
                    </div>
                  ))}
                </div>
              )}

              {tab === "other" && (
                <div className="panel list-panel">
                  <div className="panel-head"><div><h2>{t("Altri costi")}</h2><p>{t("Materiali, servizi esterni, smaltimento e altre voci delle pratiche.")}</p></div><strong>{formatMoney(others.reduce((s, r) => s + n(r.amount), 0))}</strong></div>
                  <div className="data-table costs-other head"><span>{t("Data")}</span><span>{t("Voce")}</span><span>{t("Tipo")}</span><span>{t("Pratica / targa")}</span><span>{t("Reparto")}</span><span>{t("Importo")}</span></div>
                  {others.length === 0 ? <div className="empty-state">{t("Nessun altro costo nel periodo.")}</div> : others.map((row) => (
                    <div className="data-table costs-other" key={row.id}>
                      <span className="c-date">{formatDate(row.date)}</span>
                      <span className="c-main"><strong>{row.description}</strong><small className="mobile-only">{formatDate(row.date)}</small></span>
                      <span className="c-sub">{t(otherLabel[row.category] || row.category)}</span>
                      <span className="c-ref">{row.case_number}<small className="plate-text">{row.plate}</small></span>
                      <span className="c-area"><em className={`area-pill area-${row.area.toLowerCase()}`}>{t(areaLabel[row.area])}</em></span>
                      <strong className="c-amount">{formatMoney(row.amount)}</strong>
                    </div>
                  ))}
                </div>
              )}

              {tab === "expenses" && (
                <>
                  {adding && <ExpenseForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void load(); }} />}
                  <div className="panel list-panel">
                    <div className="panel-head"><div><h2>{t("Spese Nakama Car")}</h2><p>{t("Le spese dell'officina: per reparto o generali.")}</p></div>{canEdit && !adding && <button type="button" className="primary" onClick={() => setAdding(true)}>+ {t("Nuova spesa")}</button>}</div>
                    <div className="data-table costs-expenses head"><span>{t("Data")}</span><span>{t("Descrizione")}</span><span>{t("Categoria")}</span><span>{t("Reparto")}</span><span>{t("Importo")}</span></div>
                    {expenses.length === 0 ? <div className="empty-state">{t("Nessuna spesa nel periodo.")}</div> : expenses.map((row) => (
                      <div className="data-table costs-expenses" key={row.id}>
                        <span className="c-date">{formatDate(row.date)}</span>
                        <span className="c-main"><strong>{row.description}</strong><small>{row.supplier}<i className="mobile-only">{row.supplier ? " · " : ""}{formatDate(row.date)}</i></small></span>
                        <span className="c-ref">{t(expenseLabel[row.category] || row.category)}</span>
                        <span className="c-area"><em className={`area-pill area-${row.area.toLowerCase()}`}>{t(areaLabel[row.area])}</em></span>
                        <strong className="c-amount">{formatMoney(row.amount)}{canEdit && <button type="button" className="costs-delete" title={t("Elimina spesa")} aria-label={t("Elimina spesa")} onClick={() => void removeExpense(row)}>×</button>}</strong>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </SectionShell>
  );
}

function ExpenseForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ date: today, description: "", category: "CONSUMABILI", area: "GENERAL", supplier: "", amount: "", notes: "" });
  const [error, setError] = useState("");
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });
  async function save(event: FormEvent) {
    event.preventDefault();
    const response = await apiFetch("/expenses", { method: "POST", body: JSON.stringify({ ...form, amount: form.amount.replace(",", ".") }) });
    if (!response.ok) { setError(await apiError(response, "Impossibile salvare la spesa.")); return; }
    onSaved();
  }
  return (
    <form className="panel costs-expense-form record-form" onSubmit={save}>
      <h2>{t("Nuova spesa")}</h2>
      <label>{t("Data")}<input type="date" required value={form.date} onChange={set("date")} /></label>
      <label>{t("Importo (€)")}<input inputMode="decimal" required placeholder="0,00" value={form.amount} onChange={set("amount")} /></label>
      <label className="wide">{t("Descrizione")}<input required value={form.description} onChange={set("description")} placeholder={t("Es. bolletta luce novembre")} /></label>
      <label>{t("Categoria")}<select value={form.category} onChange={set("category")}>{expenseCategories.map((code) => <option key={code} value={code}>{t(expenseLabel[code])}</option>)}</select></label>
      <label>{t("Reparto")}<select value={form.area} onChange={set("area")}><option value="GENERAL">{t("Generale (tutta l'officina)")}</option><option value="MECHANICAL">{t("Meccanica")}</option><option value="BODY">{t("Carrozzeria")}</option></select></label>
      <label className="wide">{t("Fornitore")}<input value={form.supplier} onChange={set("supplier")} placeholder={t("Facoltativo")} /></label>
      {error && <p className="record-error wide" role="alert">{t(error)}</p>}
      <div className="record-form-actions"><button className="primary">{t("Salva spesa")}</button><button type="button" className="secondary" onClick={onClose}>{t("Annulla")}</button></div>
    </form>
  );
}
