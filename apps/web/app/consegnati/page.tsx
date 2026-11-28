"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { SectionShell } from "../../components/SectionShell";
import { useLanguage } from "../../components/LanguageProvider";
import { WorkViews } from "../../components/WorkViews";
import { apiError, apiFetch, getAccessToken, sessionUser } from "../../lib/api";

type Invoice = { id?: string; invoice_number?: string; status: string; issue_date?: string | null; total?: string };
type Delivered = {
  repair_case_id: string; case_number: string; status: string; work_type: string; plate: string; vehicle_id: string;
  vehicle: string | null; fleet_number: string | null; customer_name: string; mileage: number | null;
  delivered_at: string | null; delivered_by: string | null; mechanic_name: string | null; invoices: Invoice[];
};

function day(value: string | null) {
  return value ? new Date(value).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
}

/** Vehicles handed back to the customer: they leave «Lavori in corso» but stay here with date, worker and invoice. */
export default function ConsegnatiPage() {
  const { t, language } = useLanguage();
  const words = (it: string, es: string) => language === "es" ? es : it;
  const [items, setItems] = useState<Delivered[] | null>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [signedIn, setSignedIn] = useState(true);
  const [office, setOffice] = useState(false);

  const load = useCallback(async () => {
    const response = await apiFetch(`/my-work/delivered?q=${encodeURIComponent(search)}`);
    if (response.status === 401) { setSignedIn(false); return; }
    if (!response.ok) { setError(await apiError(response, "Impossibile caricare i veicoli consegnati.")); return; }
    setItems(await response.json());
    setError("");
  }, [search]);

  useEffect(() => {
    if (!getAccessToken()) { setSignedIn(false); return; }
    setOffice(!sessionUser()?.work_area);
    void load();
  }, [load]);

  const title = words("Consegnati", "Entregados");
  if (!signedIn) return <SectionShell title={title} eyebrow="OFFICINA"><div className="empty-state"><a href="/login">{t("Accedi")}</a></div></SectionShell>;

  return (
    <SectionShell title={office ? t("Lavori in corso") : t("Il mio lavoro")} eyebrow="OFFICINA · MECCANICA E CARROZZERIA">
      <WorkViews current="/consegnati" />
      <form className="record-search" onSubmit={(e: FormEvent) => { e.preventDefault(); setSearch(query.trim()); }}>
        <label>{t("Cerca")}<input type="search" value={query} placeholder={words("Targa, pratica o cliente", "Matrícula, expediente o cliente")} onChange={(e) => setQuery(e.target.value)} /></label>
        <button className="secondary">{t("Cerca")}</button>
      </form>
      {error && <p role="alert">{t(error)}</p>}
      <section className="panel">
        <div className="panel-head"><div><h2>✔ {title} · {items?.length ?? 0}</h2></div></div>
        {items === null ? <p>{words("Caricamento…", "Cargando…")}</p> : items.length === 0 ? <div className="empty-state">{words("Nessun veicolo consegnato.", "Ningún vehículo entregado.")}</div> : (
          <div className="delivered-list">
            {items.map((item) => (
              <article key={item.repair_case_id} className="delivered-row">
                <div className="delivered-main">
                  <span className="reg-plate">{item.plate}</span>
                  <span className={`status-chip area-${item.work_type === "BODY" ? "body" : "mechanical"}`}>{t(item.work_type === "BODY" ? "Carrozzeria" : "Meccanica")}</span>
                  <strong>{item.vehicle || t("Veicolo")}</strong>
                  <small>{[item.fleet_number ? `#${item.fleet_number}` : null, item.customer_name].filter(Boolean).join(" · ")}</small>
                </div>
                <div className="delivered-facts">
                  <span className="status-chip ok">✔ {words("Consegnato", "Entregado")}{item.delivered_at ? ` ${day(item.delivered_at)}` : ""}</span>
                  {item.delivered_by && <small>{words("da", "por")} {item.delivered_by}</small>}
                  {item.mechanic_name && <small>🔧 {item.mechanic_name}</small>}
                  {item.mileage ? <small>{item.mileage.toLocaleString("it-IT")} km</small> : null}
                </div>
                <div className="delivered-links">
                  <a href={`/pratiche?q=${encodeURIComponent(item.case_number)}`}>{item.case_number}</a>
                  {item.invoices.length === 0
                    ? <span className="status-chip warn">{words("Da fatturare", "Por facturar")}</span>
                    : item.invoices.map((invoice, index) => invoice.id
                      ? <a key={invoice.id} href={`/fatture?id=${invoice.id}`} className={`status-chip status-${invoice.status.toLowerCase()}`}>◫ {invoice.invoice_number} · {t(invoice.status)}</a>
                      : <span key={index} className={`status-chip status-${invoice.status.toLowerCase()}`}>◫ {t(invoice.status)}</span>)}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </SectionShell>
  );
}
