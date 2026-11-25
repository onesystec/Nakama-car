"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { SectionShell } from "../../components/SectionShell";
import { useLanguage } from "../../components/LanguageProvider";
import { apiError, apiFetch, formatMoney, getAccessToken } from "../../lib/api";

type Area = "MECHANICAL" | "BODY";
type AreaFilter = "" | Area;
type Kind = "IN" | "OUT" | "ADJUST";
type Item = {
  id: string; area: Area; category: string; name: string; code?: string | null; brand?: string | null; unit: string;
  quantity: string; min_quantity: string; unit_cost: string; value: string; location?: string | null; supplier?: string | null;
  notes?: string | null; low: boolean;
};
type Movement = {
  id: string; item_id: string; item_name: string; item_code?: string | null; unit: string; area: Area; kind: Kind; quantity: string;
  unit_cost: string; value: string; date: string; case_number?: string | null; plate?: string | null; supplier?: string | null; note?: string | null;
};
type OpenCase = { id: string; case_number: string; plate: string; vehicle?: string | null; area: Area };
type Inventory = {
  area: Area | null; can_manage: boolean; items: Item[];
  totals: Record<Area, { items: number; low: number; value: string }>;
};

const areaLabel: Record<string, string> = { MECHANICAL: "Meccanica", BODY: "Carrozzeria" };
const categories = ["RICAMBIO", "MATERIALE", "VERNICE", "CONSUMABILE", "LUBRIFICANTE", "ATTREZZO", "ALTRO"];
const categoryLabel: Record<string, string> = {
  RICAMBIO: "Ricambio", MATERIALE: "Materiale", VERNICE: "Vernice", CONSUMABILE: "Consumabile",
  LUBRIFICANTE: "Olio e lubrificanti", ATTREZZO: "Attrezzo", ALTRO: "Altro",
};
const units = ["PZ", "L", "KG", "M", "CF", "KIT"];
const unitLabel: Record<string, string> = { PZ: "pz", L: "l", KG: "kg", M: "m", CF: "conf.", KIT: "kit" };
const kindLabel: Record<Kind, string> = { IN: "Carico", OUT: "Scarico", ADJUST: "Rettifica" };
const tabs = [["items", "Articoli"], ["reorder", "Da riordinare"], ["movements", "Movimenti"]] as const;
type Tab = typeof tabs[number][0];

const n = (value: string | number | null | undefined) => Number(value || 0);
const qty = (value: string | number, unit: string) => `${n(value).toLocaleString("it-IT", { maximumFractionDigits: 2 })} ${unitLabel[unit] || unit.toLowerCase()}`;
const signed = (value: string, unit: string) => `${n(value) > 0 ? "+" : n(value) < 0 ? "−" : ""}${qty(Math.abs(n(value)), unit)}`;
const decimal = (value: string) => value.trim().replace(",", ".") || "0";
function formatDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}
function monthStart() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

export default function MagazzinoPage() {
  const { t } = useLanguage();
  const [signedIn, setSignedIn] = useState(false);
  const [data, setData] = useState<Inventory | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [area, setArea] = useState<AreaFilter>("");
  const [tab, setTab] = useState<Tab>("items");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [moving, setMoving] = useState<{ item: Item; kind: Kind } | null>(null);

  async function load() {
    setBusy(true);
    try {
      const [stock, history] = await Promise.all([apiFetch("/inventory"), apiFetch("/inventory/movements?limit=500")]);
      if (!stock.ok) throw new Error(await apiError(stock, "Impossibile caricare il magazzino."));
      const next: Inventory = await stock.json();
      setData(next);
      if (next.area) setArea(next.area);
      if (history.ok) setMovements(await history.json());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore di connessione.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setMoving(null); setEditing(null); } };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, []);
  useEffect(() => {
    const token = Boolean(getAccessToken());
    setSignedIn(token);
    if (token) void load(); else setBusy(false);
  }, []);

  async function undo(movement: Movement) {
    if (!confirm(`${t("Annullare il movimento")} «${t(kindLabel[movement.kind])} ${signed(movement.quantity, movement.unit)} ${movement.item_name}»?`)) return;
    const response = await apiFetch(`/inventory/movements/${movement.id}`, { method: "DELETE" });
    if (!response.ok) { setError(await apiError(response, "Impossibile annullare il movimento.")); return; }
    await load();
  }

  const fixedArea = data?.area || null;
  const canManage = Boolean(data?.can_manage);
  const shown: Area[] = area ? [area] : ["MECHANICAL", "BODY"];
  const matchText = (values: (string | null | undefined)[]) => {
    const q = query.trim().toLowerCase();
    return !q || values.some((value) => value?.toLowerCase().includes(q));
  };
  const items = useMemo(() => (data?.items || []).filter((row) =>
    (!area || row.area === area) && (!category || row.category === category)
    && matchText([row.name, row.code, row.brand, row.location, row.supplier])), [data, area, category, query]);
  const reorder = useMemo(() => items.filter((row) => row.low), [items]);
  const moves = useMemo(() => movements.filter((row) =>
    (!area || row.area === area) && matchText([row.item_name, row.item_code, row.case_number, row.plate, row.supplier, row.note])), [movements, area, query]);

  const total = (key: "items" | "low" | "value") => shown.reduce((sum, code) => sum + n(data?.totals[code]?.[key]), 0);
  const thisMonth = movements.filter((row) => row.kind === "OUT" && row.date >= monthStart() && (!area || row.area === area));
  const usedValue = thisMonth.reduce((sum, row) => sum + n(row.value), 0);

  const itemRow = (row: Item) => (
    <div className={`data-table stock-items${row.low ? " is-low" : ""}`} key={row.id}>
      <span className="c-main">
        <strong>{row.name}</strong>
        <small>{[row.code, row.brand, t(categoryLabel[row.category] || row.category)].filter(Boolean).join(" · ")}{row.location && <i className="mobile-only"> · {row.location}</i>}</small>
      </span>
      <span className="c-x">{row.location || "—"}</span>
      <span className="c-area"><em className={`area-pill area-${row.area.toLowerCase()}`}>{t(areaLabel[row.area])}</em></span>
      <strong className="c-amount stock-qty">
        {qty(row.quantity, row.unit)}
        <small>{n(row.min_quantity) > 0 ? `${t("min.")} ${qty(row.min_quantity, row.unit)}` : row.low ? t("Esaurito") : ""}</small>
      </strong>
      <span className="c-ref">{formatMoney(row.unit_cost)}<small>{t("Valore")} {formatMoney(row.value)}</small></span>
      <span className="c-sub stock-actions">
        <button type="button" className="stock-in" onClick={() => setMoving({ item: row, kind: "IN" })} title={t("Carico")}>+ {t("Carico")}</button>
        <button type="button" className="stock-out" disabled={n(row.quantity) <= 0} onClick={() => setMoving({ item: row, kind: "OUT" })} title={t("Scarico")}>− {t("Scarico")}</button>
        <button type="button" className="stock-more" onClick={() => setEditing(row)} title={t("Scheda articolo")} aria-label={t("Scheda articolo")}>⋯</button>
      </span>
    </div>
  );

  return (
    <SectionShell title={t("Magazzino")} eyebrow={t("OFFICINA")}
      actions={signedIn && data ? <button type="button" className="primary" onClick={() => setEditing("new")}>+ {t("Nuovo articolo")}</button> : undefined}>
      {!signedIn ? (
        <div className="empty-state">{t("Accedi per vedere il magazzino.")} <a href="/login">{t("Accedi")}</a></div>
      ) : (
        <div className="costs-page stock-page">
          <div className="costs-toolbar">
            {fixedArea ? (
              <p className="stock-scope">{t("Magazzino")} <em className={`area-pill area-${fixedArea.toLowerCase()}`}>{t(areaLabel[fixedArea])}</em></p>
            ) : (
              <div className="costs-area" role="tablist" aria-label={t("Reparto")}>
                {([["", "Tutto"], ["MECHANICAL", "Meccanica"], ["BODY", "Carrozzeria"]] as const).map(([code, label]) => (
                  <button key={code || "all"} type="button" role="tab" aria-selected={area === code} className={`area-${code.toLowerCase() || "all"}${area === code ? " active" : ""}`} onClick={() => setArea(code)}>{t(label)}</button>
                ))}
              </div>
            )}
          </div>

          {error && <div className="record-error" role="alert">{t(error)}</div>}

          <section className="kpi-grid nakama-kpis costs-kpis" aria-busy={busy}>
            <button type="button" className="kpi-card" onClick={() => setTab("items")}><span>{t("Articoli in magazzino")}</span><strong>{total("items")}</strong><small>{shown.map((code) => `${t(areaLabel[code])} ${data?.totals[code]?.items ?? 0}`).join(" · ")}</small></button>
            <button type="button" className="kpi-card" onClick={() => setTab("items")}><span>{t("Valore del magazzino")}</span><strong>{formatMoney(total("value"))}</strong><small>{t("Giacenza × costo medio d'acquisto")}</small></button>
            <button type="button" className="kpi-card" onClick={() => setTab("movements")}><span>{t("Usato questo mese")}</span><strong>{formatMoney(usedValue)}</strong><small>{thisMonth.length} {t("scarichi")}</small></button>
            <button type="button" className={`kpi-card${total("low") > 0 ? " stock-alert" : ""}`} onClick={() => setTab("reorder")}><span>{t("Da riordinare")}</span><strong>{total("low")}</strong><small>{t("Sotto la scorta minima o esauriti")}</small></button>
          </section>

          <div className="audit-tabs costs-tabs" role="tablist">
            {tabs.map(([code, label]) => <button key={code} type="button" role="tab" aria-selected={tab === code} className={tab === code ? "primary" : "secondary"} onClick={() => setTab(code)}>{t(label)}{code === "reorder" && total("low") > 0 ? ` (${total("low")})` : ""}</button>)}
          </div>

          <div className="costs-search stock-filters">
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t(tab === "movements" ? "Cerca articolo, targa o pratica" : "Cerca articolo, codice, marca o scaffale")} aria-label={t("Cerca")} />
            {tab !== "movements" && (
              <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label={t("Categoria")}>
                <option value="">{t("Tutte le categorie")}</option>
                {categories.map((code) => <option key={code} value={code}>{t(categoryLabel[code])}</option>)}
              </select>
            )}
          </div>

          {busy && !data ? <div className="panel"><div className="empty-state">{t("Caricamento…")}</div></div> : data && (
            <>
              {(tab === "items" || tab === "reorder") && (
                <div className="panel list-panel">
                  <div className="panel-head">
                    <div>
                      <h2>{t(tab === "items" ? "Articoli" : "Da riordinare")}</h2>
                      <p>{t(tab === "items" ? "Ricambi, materiali, vernici e attrezzi: quanto c'è e dove si trova." : "Articoli arrivati alla scorta minima: da ordinare al fornitore.")}</p>
                    </div>
                    <strong>{formatMoney((tab === "items" ? items : reorder).reduce((sum, row) => sum + n(row.value), 0))}</strong>
                  </div>
                  <div className="data-table stock-items head"><span>{t("Articolo")}</span><span>{t("Scaffale")}</span><span>{t("Reparto")}</span><span>{t("Giacenza")}</span><span>{t("Costo unit.")}</span><span>{t("Azioni")}</span></div>
                  {(tab === "items" ? items : reorder).length === 0 ? (
                    <div className="empty-state">
                      {tab === "reorder" ? t("Nessun articolo da riordinare.") : data.items.length === 0
                        ? <>{t("Il magazzino è vuoto.")} <button type="button" className="link-button" onClick={() => setEditing("new")}>{t("Aggiungi il primo articolo")}</button></>
                        : t("Nessun articolo trovato.")}
                    </div>
                  ) : (tab === "items" ? items : reorder).map(itemRow)}
                </div>
              )}

              {tab === "movements" && (
                <div className="panel list-panel">
                  <div className="panel-head"><div><h2>{t("Movimenti")}</h2><p>{t("Ogni carico, scarico e rettifica, con la pratica a cui è andato il materiale.")}</p></div></div>
                  <div className="data-table stock-moves head"><span>{t("Data")}</span><span>{t("Articolo")}</span><span>{t("Tipo")}</span><span>{t("Quantità")}</span><span>{t("Pratica / targa")}</span><span>{t("Valore")}</span></div>
                  {moves.length === 0 ? <div className="empty-state">{t("Nessun movimento.")}</div> : moves.map((row) => (
                    <div className="data-table stock-moves" key={row.id}>
                      <span className="c-date">{formatDate(row.date)}</span>
                      <span className="c-main"><strong>{row.item_name}</strong><small>{[row.note && t(row.note), row.supplier].filter(Boolean).join(" · ") || row.item_code}<i className="mobile-only"> · {formatDate(row.date)}</i></small></span>
                      <span className="c-area"><em className={`move-pill move-${row.kind.toLowerCase()}`}>{t(kindLabel[row.kind])}</em></span>
                      <strong className={`c-amount move-qty move-${n(row.quantity) < 0 ? "minus" : "plus"}`}>{signed(row.quantity, row.unit)}</strong>
                      <span className="c-ref">{row.case_number ? <>{row.case_number}<small className="plate-text">{row.plate}</small></> : "—"}</span>
                      <span className="c-sub">{formatMoney(row.value)}{canManage && <button type="button" className="costs-delete" title={t("Annulla movimento")} aria-label={t("Annulla movimento")} onClick={() => void undo(row)}>×</button>}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {editing && (
            <ItemForm item={editing === "new" ? null : editing} fixedArea={fixedArea} defaultArea={area || "MECHANICAL"} canManage={canManage}
              movements={editing === "new" ? [] : movements.filter((row) => row.item_id === editing.id)}
              onMove={(kind) => { if (editing !== "new") { setMoving({ item: editing, kind }); setEditing(null); } }}
              onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />
          )}
          {moving && <MovementForm item={moving.item} kind={moving.kind} onClose={() => setMoving(null)} onSaved={() => { setMoving(null); void load(); }} />}
        </div>
      )}
    </SectionShell>
  );
}

function ItemForm({ item, fixedArea, defaultArea, canManage, movements, onMove, onClose, onSaved }: {
  item: Item | null; fixedArea: Area | null; defaultArea: Area; canManage: boolean; movements: Movement[];
  onMove: (kind: Kind) => void; onClose: () => void; onSaved: () => void;
}) {
  const { t } = useLanguage();
  const [form, setForm] = useState({
    area: item?.area || fixedArea || defaultArea, category: item?.category || "RICAMBIO", name: item?.name || "", code: item?.code || "",
    brand: item?.brand || "", unit: item?.unit || "PZ", quantity: "", min_quantity: item ? String(n(item.min_quantity)).replace(".", ",") : "",
    unit_cost: item ? String(n(item.unit_cost)).replace(".", ",") : "", location: item?.location || "", supplier: item?.supplier || "", notes: item?.notes || "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    const body = { ...form, quantity: decimal(form.quantity), min_quantity: decimal(form.min_quantity), unit_cost: decimal(form.unit_cost) };
    const response = await apiFetch(item ? `/inventory/items/${item.id}` : "/inventory/items", { method: item ? "PUT" : "POST", body: JSON.stringify(body) });
    setSaving(false);
    if (!response.ok) { setError(await apiError(response, "Impossibile salvare l'articolo.")); return; }
    onSaved();
  }
  async function remove() {
    if (!item || !confirm(`${t("Eliminare l'articolo")} «${item.name}» ${t("e tutti i suoi movimenti?")}`)) return;
    const response = await apiFetch(`/inventory/items/${item.id}`, { method: "DELETE" });
    if (!response.ok) { setError(await apiError(response, "Impossibile eliminare l'articolo.")); return; }
    onSaved();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="panel stock-dialog" role="dialog" aria-modal="true" aria-label={t(item ? "Scheda articolo" : "Nuovo articolo")} onClick={(e) => e.stopPropagation()}>
        <header className="stock-dialog-head">
          <div><h2>{item ? item.name : t("Nuovo articolo")}</h2>{item && <p>{t("In magazzino")}: <strong>{qty(item.quantity, item.unit)}</strong> · {t("Valore")} {formatMoney(item.value)}</p>}</div>
          <button type="button" className="secondary" onClick={onClose}>{t("Chiudi")}</button>
        </header>
        {item && (
          <div className="stock-dialog-actions">
            <button type="button" className="stock-in" onClick={() => onMove("IN")}>+ {t("Carico")}</button>
            <button type="button" className="stock-out" disabled={n(item.quantity) <= 0} onClick={() => onMove("OUT")}>− {t("Scarico")}</button>
            <button type="button" className="secondary" onClick={() => onMove("ADJUST")}>{t("Conta / rettifica")}</button>
          </div>
        )}
        <form className="record-form stock-form" onSubmit={save}>
          <label className="wide">{t("Nome articolo")}<input required value={form.name} onChange={set("name")} placeholder={t("Es. Filtro olio, Trasparente 2K, Disco abrasivo P400")} /></label>
          <label>{t("Reparto")}
            <select value={form.area} onChange={set("area")} disabled={Boolean(fixedArea)}>
              <option value="MECHANICAL">{t("Meccanica")}</option><option value="BODY">{t("Carrozzeria")}</option>
            </select>
          </label>
          <label>{t("Categoria")}<select value={form.category} onChange={set("category")}>{categories.map((code) => <option key={code} value={code}>{t(categoryLabel[code])}</option>)}</select></label>
          <label>{t("Codice / OEM")}<input value={form.code} onChange={set("code")} placeholder={t("Facoltativo")} /></label>
          <label>{t("Marca")}<input value={form.brand} onChange={set("brand")} placeholder={t("Facoltativo")} /></label>
          {!item && <label>{t("Quantità presente")}<input inputMode="decimal" value={form.quantity} onChange={set("quantity")} placeholder="0" /></label>}
          <label>{t("Unità")}<select value={form.unit} onChange={set("unit")}>{units.map((code) => <option key={code} value={code}>{unitLabel[code]}</option>)}</select></label>
          <label>{t("Scorta minima")}<input inputMode="decimal" value={form.min_quantity} onChange={set("min_quantity")} placeholder="0" /></label>
          <label>{t("Costo unitario (€)")}<input inputMode="decimal" value={form.unit_cost} onChange={set("unit_cost")} placeholder="0,00" /></label>
          <label>{t("Scaffale / posizione")}<input value={form.location} onChange={set("location")} placeholder={t("Es. Scaffale A2")} /></label>
          <label>{t("Fornitore")}<input value={form.supplier} onChange={set("supplier")} placeholder={t("Facoltativo")} /></label>
          <label className="wide">{t("Note")}<input value={form.notes} onChange={set("notes")} placeholder={t("Facoltativo")} /></label>
          {item && <p className="hint wide">{t("La quantità cambia solo con Carico, Scarico o Conta, così lo storico spiega sempre la giacenza.")}</p>}
          {error && <p className="record-error wide" role="alert">{t(error)}</p>}
          <div className="record-form-actions">
            <button className="primary" disabled={saving}>{t(item ? "Salva modifiche" : "Aggiungi al magazzino")}</button>
            <button type="button" className="secondary" onClick={onClose}>{t("Annulla")}</button>
            {item && canManage && <button type="button" className="secondary record-delete" onClick={() => void remove()}>{t("Elimina articolo")}</button>}
          </div>
        </form>
        {item && (
          <div className="stock-history">
            <h3>{t("Storico movimenti")}</h3>
            {movements.length === 0 ? <p className="hint">{t("Nessun movimento.")}</p> : movements.slice(0, 30).map((row) => (
              <div key={row.id} className="stock-history-row">
                <span>{formatDate(row.date)}</span>
                <em className={`move-pill move-${row.kind.toLowerCase()}`}>{t(kindLabel[row.kind])}</em>
                <strong className={`move-qty move-${n(row.quantity) < 0 ? "minus" : "plus"}`}>{signed(row.quantity, row.unit)}</strong>
                <span>{row.case_number ? <>{row.case_number} <b className="plate-text">{row.plate}</b></> : [row.note && t(row.note), row.supplier].filter(Boolean).join(" · ")}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MovementForm({ item, kind: initialKind, onClose, onSaved }: { item: Item; kind: Kind; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage();
  const [kind, setKind] = useState<Kind>(initialKind);
  const [form, setForm] = useState({ quantity: "", unit_cost: String(n(item.unit_cost) || "").replace(".", ","), supplier: item.supplier || "", repair_case_id: "", note: "", date: new Date().toISOString().slice(0, 10) });
  const [cases, setCases] = useState<OpenCase[]>([]);
  const [caseQuery, setCaseQuery] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  useEffect(() => {
    apiFetch("/inventory/cases").then(async (response) => { if (response.ok) setCases(await response.json()); }).catch(() => undefined);
  }, []);
  const matching = useMemo(() => {
    const q = caseQuery.trim().toLowerCase().replace(/\s/g, "");
    const own = cases.filter((row) => row.area === item.area);
    const list = own.length ? own : cases;
    return q ? cases.filter((row) => `${row.plate}${row.case_number}${row.vehicle || ""}`.toLowerCase().replace(/\s/g, "").includes(q)) : list;
  }, [cases, caseQuery, item.area]);

  const amount = n(decimal(form.quantity));
  const after = kind === "IN" ? n(item.quantity) + amount : kind === "OUT" ? n(item.quantity) - amount : amount;

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    const body = {
      kind, quantity: decimal(form.quantity), date: form.date, note: form.note || null,
      unit_cost: kind === "IN" && form.unit_cost.trim() ? decimal(form.unit_cost) : null,
      supplier: kind === "IN" ? form.supplier || null : null,
      repair_case_id: kind === "OUT" && form.repair_case_id ? form.repair_case_id : null,
    };
    const response = await apiFetch(`/inventory/items/${item.id}/movements`, { method: "POST", body: JSON.stringify(body) });
    setSaving(false);
    if (!response.ok) { setError(await apiError(response, "Impossibile registrare il movimento.")); return; }
    onSaved();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="panel stock-dialog small" role="dialog" aria-modal="true" aria-label={t(kindLabel[kind])} onClick={(e) => e.stopPropagation()}>
        <header className="stock-dialog-head">
          <div><h2>{item.name}</h2><p>{t("In magazzino")}: <strong>{qty(item.quantity, item.unit)}</strong>{item.location ? ` · ${item.location}` : ""}</p></div>
          <button type="button" className="secondary" onClick={onClose}>{t("Chiudi")}</button>
        </header>
        <div className="costs-area stock-kind" role="tablist">
          {(["IN", "OUT", "ADJUST"] as Kind[]).map((code) => (
            <button key={code} type="button" role="tab" aria-selected={kind === code} className={`kind-${code.toLowerCase()}${kind === code ? " active" : ""}`} onClick={() => setKind(code)}>{t(kindLabel[code])}</button>
          ))}
        </div>
        <form className="record-form stock-form" onSubmit={save}>
          <label>{t(kind === "ADJUST" ? "Quantità contata" : kind === "IN" ? "Quantità arrivata" : "Quantità usata")} ({unitLabel[item.unit]})
            <input autoFocus required inputMode="decimal" value={form.quantity} onChange={set("quantity")} placeholder="0" />
          </label>
          <label>{t("Data")}<input type="date" required value={form.date} onChange={set("date")} /></label>
          {kind === "IN" && <>
            <label>{t("Costo unitario (€)")}<input inputMode="decimal" value={form.unit_cost} onChange={set("unit_cost")} placeholder="0,00" /></label>
            <label>{t("Fornitore")}<input value={form.supplier} onChange={set("supplier")} placeholder={t("Facoltativo")} /></label>
          </>}
          {kind === "OUT" && (
            <div className="wide stock-case">
              <label>{t("Per quale pratica?")}<input type="search" value={caseQuery} onChange={(e) => setCaseQuery(e.target.value)} placeholder={t("Cerca targa o numero pratica")} /></label>
              <div className="stock-case-list" role="listbox">
                <button type="button" role="option" aria-selected={!form.repair_case_id} className={!form.repair_case_id ? "active" : ""} onClick={() => setForm({ ...form, repair_case_id: "" })}>{t("Uso interno / nessuna pratica")}</button>
                {matching.slice(0, 12).map((row) => (
                  <button key={row.id} type="button" role="option" aria-selected={form.repair_case_id === row.id} className={form.repair_case_id === row.id ? "active" : ""} onClick={() => setForm({ ...form, repair_case_id: row.id })}>
                    <b className="plate-text">{row.plate}</b> <span>{row.case_number}{row.vehicle ? ` · ${row.vehicle}` : ""}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <label className="wide">{t("Nota")}<input value={form.note} onChange={set("note")} placeholder={t(kind === "ADJUST" ? "Es. Inventario di fine mese" : kind === "IN" ? "Es. DDT n. 1234" : "Facoltativo")} /></label>
          {form.quantity && <p className={`hint wide stock-after${after < 0 ? " negative" : ""}`}>{t("Dopo questo movimento")}: <strong>{qty(after, item.unit)}</strong></p>}
          {error && <p className="record-error wide" role="alert">{t(error)}</p>}
          <div className="record-form-actions">
            <button className="primary" disabled={saving}>{t("Registra")} {t(kindLabel[kind]).toLowerCase()}</button>
            <button type="button" className="secondary" onClick={onClose}>{t("Annulla")}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
