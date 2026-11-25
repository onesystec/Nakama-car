"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "../../../components/LanguageProvider";
import { whatsappNumber } from "../../../components/CaseTracking";
import { API_URL, apiError, apiFetch, formatMoney, getAccessToken, openProtectedFile } from "../../../lib/api";

type PreviewLine = {
  description: string; quantity: string; parts: string; hours: string; labor: string;
  labor_included: boolean; vat_rate: string; total: string;
};
type Preview = {
  company: { name: string; lines: string[] };
  estimate_number: string; version: number; status: string; created_at: string | null; validity_days: number;
  customer: { name: string; phone: string | null; email: string | null };
  vehicle: { plate: string; description: string | null; vin: string | null; mileage: number | null; fleet_number: string | null };
  contract_name: string | null; labor_included: boolean; labor_discount_percent: string; parts_markup_percent: string;
  lines: PreviewLine[]; subtotal: string; vat_total: string; total: string;
};

const quantity = (value: string) => String(Number(value)).replace(".", ",");
const date = (value: string | null) => (value ? new Date(value).toLocaleDateString("it-IT") : "—");

/** Print / WhatsApp preview of an estimate, laid out like the PDF the customer receives. */
export default function EstimatePreviewPage() {
  const { t } = useLanguage();
  const [id, setId] = useState("");
  const [data, setData] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const estimateId = new URLSearchParams(window.location.search).get("id") || "";
    setId(estimateId);
    if (!estimateId) {
      setError(t("Preventivo non trovato."));
      return;
    }
    apiFetch(`/estimates/${estimateId}/preview`).then(async (response) => {
      if (!response.ok) {
        setError(t(await apiError(response, "Preventivo non trovato.")));
        return;
      }
      setData(await response.json());
    }).catch(() => setError(t("Errore di connessione.")));
  }, []);

  async function downloadPdf() {
    const failure = await openProtectedFile(`/estimates/${id}/pdf`, `${data?.estimate_number || "preventivo"}.pdf`, true);
    if (failure) setError(t(failure));
  }

  /** WhatsApp: on a phone the PDF itself is shared; otherwise WhatsApp opens with the approval link. */
  async function sendWhatsapp() {
    if (!data) return;
    setSending(true);
    setError("");
    try {
      const shareResponse = await apiFetch(`/estimates/${id}/share`, { method: "POST" });
      if (!shareResponse.ok) throw new Error(await apiError(shareResponse, "Impossibile creare il link"));
      const shared: { public_path: string; customer_phone: string | null } = await shareResponse.json();
      const url = `${window.location.origin}${shared.public_path}`;
      const text = t("Gentile {name}, ecco il preventivo {number} per il veicolo {plate}{total}. Può consultarlo e approvarlo o rifiutarlo da questo link: {url}")
        .replace("{name}", data.customer.name || t("cliente"))
        .replace("{number}", data.estimate_number)
        .replace("{plate}", data.vehicle.plate)
        .replace("{total}", ` (${t("totale")} ${formatMoney(data.total)})`)
        .replace("{url}", url);

      const token = getAccessToken();
      const pdfResponse = await fetch(`${API_URL}/estimates/${id}/pdf`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (pdfResponse.ok && typeof navigator !== "undefined" && "canShare" in navigator) {
        const file = new File([await pdfResponse.blob()], `${data.estimate_number}.pdf`, { type: "application/pdf" });
        if (navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file], text, title: `${t("Preventivo")} ${data.estimate_number}` });
            return;
          } catch (shareError) {
            if (shareError instanceof DOMException && shareError.name === "AbortError") return;
          }
        }
      }
      const phone = whatsappNumber(shared.customer_phone || data.customer.phone);
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(t(e instanceof Error ? e.message : "Errore di connessione."));
    } finally {
      setSending(false);
    }
  }

  const conditions: string[] = [];
  if (data?.contract_name) {
    conditions.push(`${t("Contratto di manutenzione flotta")}: ${data.contract_name}.`);
    if (data.labor_included) conditions.push(t("Manodopera inclusa nel canone mensile."));
    else if (Number(data.labor_discount_percent)) conditions.push(`${t("Sconto manodopera")} ${Number(data.labor_discount_percent)}%.`);
    if (Number(data.parts_markup_percent)) conditions.push(`${t("Ricambi e materiali a costo +")} ${Number(data.parts_markup_percent)}%.`);
  }

  return (
    <main className="estimate-preview-page">
      <div className="preview-toolbar no-print">
        <a className="ghost-link" href={`/preventivi?id=${id}`}>← {t("Torna al preventivo")}</a>
        <div className="preview-actions">
          <button className="secondary" onClick={() => window.print()} disabled={!data}>{t("Stampa")}</button>
          <button className="secondary" onClick={downloadPdf} disabled={!data}>{t("Scarica PDF")}</button>
          <button className="primary whatsapp" onClick={sendWhatsapp} disabled={!data || sending}>{sending ? "…" : t("Invia su WhatsApp")}</button>
        </div>
      </div>
      {error && <div className="record-error no-print" role="alert">{error}</div>}
      {!data && !error && <p className="preview-loading">{t("Caricamento…")}</p>}
      {data && (
        <article className="estimate-sheet" aria-label={`${t("Preventivo")} ${data.estimate_number}`}>
          <header className="sheet-company">
            <img src="/brand/nakama-logo.webp" alt="" width={96} height={96} />
            <div>
              <h1>{data.company.name}</h1>
              {data.company.lines.map((line) => <p key={line}>{line}</p>)}
            </div>
          </header>

          <h2>{t("Preventivo di riparazione")}</h2>
          <dl className="sheet-info">
            <div><dt>{t("Preventivo")}</dt><dd>{data.estimate_number}</dd></div>
            <div><dt>{t("Data")}</dt><dd>{date(data.created_at)}</dd></div>
            <div><dt>{t("Cliente")}</dt><dd>{data.customer.name}</dd></div>
            <div><dt>{t("Targa")}</dt><dd className="plate">{data.vehicle.plate}</dd></div>
            <div><dt>{t("Veicolo")}</dt><dd>{data.vehicle.description || "—"}</dd></div>
            <div><dt>{t("VIN / Telaio")}</dt><dd>{data.vehicle.vin || "—"}</dd></div>
            <div><dt>{t("Km")}</dt><dd>{data.vehicle.mileage ?? "—"}</dd></div>
            <div><dt>{t("N. flotta")}</dt><dd>{data.vehicle.fleet_number || "—"}</dd></div>
          </dl>

          {conditions.length > 0 && <p className="sheet-note">{conditions.join(" ")}</p>}

          <table className="sheet-lines">
            <thead>
              <tr>
                <th>{t("Descrizione")}</th><th>{t("Q.tà")}</th><th>{t("Ricambi / materiali")}</th>
                {!data.labor_included && <><th>{t("Ore")}</th><th>{t("Manodopera")}</th></>}
                <th>{t("IVA")}</th><th>{t("Imponibile")}</th><th>{t("Totale")}</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((line, index) => (
                <tr key={index}>
                  <td>{line.description}</td>
                  <td>{quantity(line.quantity)}</td>
                  <td>{formatMoney(line.parts)}</td>
                  {/* Labor in the monthly fee: only parts and materials are shown. */}
                  {!data.labor_included && <><td>{quantity(line.hours)}</td><td>{formatMoney(line.labor)}</td></>}
                  <td>{Number(line.vat_rate)}%</td>
                  <td>{formatMoney(Number(line.parts) + Number(line.labor))}</td>
                  <td>{formatMoney(line.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <table className="sheet-totals">
            <tbody>
              <tr><th>{t("Imponibile")}</th><td>{formatMoney(data.subtotal)}</td></tr>
              <tr><th>{t("IVA")}</th><td>{formatMoney(data.vat_total)}</td></tr>
              <tr className="grand"><th>{t("TOTALE")}</th><td>{formatMoney(data.total)}</td></tr>
            </tbody>
          </table>

          <section className="sheet-conditions">
            <h3>{t("Condizioni")}</h3>
            <p>
              {t("Preventivo soggetto a verifica definitiva dopo lo smontaggio o la diagnosi.")}{" "}
              {t("Validità {days} giorni dalla data di emissione.").replace("{days}", String(data.validity_days))}
            </p>
          </section>
          <div className="sheet-signatures">
            <p>{t("Firma cliente")} ______________________________</p>
            <p>{t("Firma officina")} ______________________________</p>
          </div>
        </article>
      )}
    </main>
  );
}
