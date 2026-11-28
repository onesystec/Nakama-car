"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "./LanguageProvider";
import { apiFetch, hasPermission } from "../lib/api";

type Invoice = { id: string; invoice_number: string; status: string };

/** On an open case: when the vehicle was handed back and by whom, and its invoices (kept after delivery). */
export function CaseDelivery({ caseId, deliveredAt, deliveredBy }: { caseId: string; deliveredAt: string | null; deliveredBy: string | null }) {
  const { t, language } = useLanguage();
  const words = (it: string, es: string) => language === "es" ? es : it;
  const [invoices, setInvoices] = useState<Invoice[]>([]);

  useEffect(() => {
    setInvoices([]);
    if (!hasPermission("invoice.read")) return;
    let alive = true;
    apiFetch(`/invoices?repair_case_id=${caseId}`).then(async (response) => {
      if (alive && response.ok) setInvoices((await response.json() as Invoice[]).filter((invoice) => invoice.status !== "CANCELLED"));
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [caseId]);

  if (!deliveredAt && invoices.length === 0) return null;
  const when = deliveredAt ? new Date(deliveredAt).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  return <div className="case-delivery">
    {deliveredAt && <span className="status-chip ok">✔ {words("Consegnato", "Entregado")} {when}{deliveredBy ? ` · ${deliveredBy}` : ""}</span>}
    {invoices.map((invoice) => <a key={invoice.id} href={`/fatture?id=${invoice.id}`} className={`status-chip status-${invoice.status.toLowerCase()}`}>◫ {invoice.invoice_number} · {t(invoice.status)}</a>)}
  </div>;
}
