"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { CustomerServiceRequests } from "./ServiceRequests";
import { useLanguage } from "./LanguageProvider";
import { apiError, apiFetch, hasPermission } from "../lib/api";

type Account = { id: string; email: string | null; full_name: string; active: boolean; must_change_password: boolean; last_login_at?: string | null; temporary_password?: string; invitation_expires_at?: string | null; suspension_reason?: string | null };

/** Customer portal logins: the workshop creates them and hands the temporary password to the customer. */
export function PortalAccess({ customerId, customerName }: { customerId: string; customerName: string }) {
  const { t, language } = useLanguage();
  const label = (it: string, es: string) => language === "es" ? es : it;
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [draft, setDraft] = useState({ email: "", full_name: "" });
  const [issued, setIssued] = useState<Account | null>(null);
  const [invitation, setInvitation] = useState<{ url: string; expires_at: string } | null>(null);
  const [suspension, setSuspension] = useState<Account | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [canWrite, setCanWrite] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const load = useCallback(async () => {
    const response = await apiFetch(`/customers/${customerId}/portal-accounts`);
    if (response.ok) setAccounts(await response.json());
  }, [customerId]);

  useEffect(() => {
    setCanWrite(hasPermission("customer.write"));
    setIsAdmin(hasPermission("users.manage"));
    setIssued(null);
    setInvitation(null);
    setSuspension(null);
    setMessage("");
    load();
  }, [load]);

  const portalUrl = typeof window !== "undefined" ? `${window.location.origin}/portale/login` : "/portale/login";

  async function createAccount(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    const response = await apiFetch(`/customers/${customerId}/portal-accounts`, { method: "POST", body: JSON.stringify(draft) });
    if (!response.ok) { setMessage(await apiError(response, "Impossibile creare l'accesso.")); return; }
    setIssued(await response.json());
    setDraft({ email: "", full_name: "" });
    load();
  }

  async function reset(account: Account) {
    if (!window.confirm(t("Generare una nuova password temporanea? Quella attuale smetterà di funzionare."))) return;
    const response = await apiFetch(`/portal-accounts/${account.id}/reset-password`, { method: "POST" });
    if (response.ok) { setIssued(await response.json()); load(); }
  }

  async function toggle(account: Account) {
    setBusy(true);
    setMessage("");
    try {
      const response = await apiFetch(`/portal-accounts/${account.id}`, {
        method: "PATCH",
        body: JSON.stringify(account.active ? { active: false, suspension_reason: reason } : { active: true }),
      });
      if (!response.ok) {
        setMessage(await apiError(response, label("Impossibile aggiornare l’accesso.", "No se pudo actualizar el acceso.")));
        return;
      }
      setSuspension(null);
      setReason("");
      await load();
    } catch {
      setMessage(label("Server non raggiungibile.", "No se pudo conectar con el servidor."));
    } finally {
      setBusy(false);
    }
  }

  async function invite(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setInvitation(null);
    setMessage("");
    try {
      const response = await apiFetch(`/customers/${customerId}/portal-invitations`, {
        method: "POST", body: JSON.stringify({}),
      });
      if (!response.ok) {
        setMessage(await apiError(response, label("Impossibile generare il link.", "No se pudo generar el enlace.")));
        return;
      }
      const { token, expires_at } = await response.json();
      const url = new URL("/portale/login", window.location.origin);
      url.hash = new URLSearchParams({ invito: token }).toString();
      setInvitation({ url: url.href, expires_at });
      await load();
    } catch {
      setMessage(label("Server non raggiungibile.", "No se pudo conectar con el servidor."));
    } finally {
      setBusy(false);
    }
  }

  async function remove(account: Account) {
    if (!window.confirm(`${t("Eliminare l'accesso di")} ${account.email}? ${t("Il cliente non potrà più entrare nel portale con questa email. I suoi dati restano. L'operazione non si può annullare.")}`)) return;
    setMessage("");
    const response = await apiFetch(`/portal-accounts/${account.id}`, { method: "DELETE" });
    if (!response.ok && response.status !== 404) { setMessage(await apiError(response, "Impossibile eliminare l'accesso.")); return; }
    if (issued?.id === account.id) setIssued(null);
    setMessage("Accesso eliminato.");
    load();
  }

  const handoff = issued?.temporary_password
    ? `${t("Accesso area clienti")} ${customerName}\n${portalUrl}\n${t("Email")}: ${issued.email}\n${t("Password temporanea")}: ${issued.temporary_password}`
    : "";

  return (
    <div className="portal-access">
      <h3>{t("Accessi al portale")}</h3>
      <p className="hint"><a href="/portale/login" target="_blank" rel="noopener noreferrer">{portalUrl}</a></p>
      {message && <p className="hint" role="status">{t(message)}</p>}
      {issued?.temporary_password && (
        <div className="issued-password" role="status">
          <p><strong>{t("Password temporanea per")} {issued.email}:</strong> <code>{issued.temporary_password}</code></p>
          <p className="hint">{t("Viene mostrata solo ora. Consegnala al cliente: al primo accesso sceglierà la sua password.")}</p>
          <button type="button" className="secondary" onClick={() => navigator.clipboard?.writeText(handoff).then(() => setMessage("Credenziali copiate.")).catch(() => undefined)}>{t("Copia credenziali")}</button>
        </div>
      )}
      <ul className="portal-accounts">
        {accounts.length === 0 && <li className="hint">{t("Nessun accesso creato.")}</li>}
        {accounts.map((account) => (
          <li key={account.id}>
            <span><strong>{account.full_name}</strong><small>{account.email}</small></span>
            <span className={`status-chip${account.active ? " ok" : ""}`}>{account.invitation_expires_at
              ? new Date(account.invitation_expires_at).getTime() <= Date.now()
                ? label("Invito scaduto", "Invitación caducada") : label("Invito in attesa", "Invitación pendiente")
              : account.active ? t("Attivo") : label("Sospeso", "Suspendido")}</span>
            <small>{account.last_login_at ? `${t("Ultimo accesso")} ${new Date(account.last_login_at).toLocaleString("it-IT")}` : t("Mai entrato")}</small>
            {isAdmin && account.suspension_reason && <small>{account.suspension_reason}</small>}
            {canWrite && (
              <span className="table-actions">
                {!account.invitation_expires_at && <button type="button" onClick={() => reset(account)}>{t("Nuova password")}</button>}
                {isAdmin && !account.invitation_expires_at && <button type="button" disabled={busy} onClick={() => {
                  if (account.active) { setReason(""); setSuspension(account); }
                  else void toggle(account);
                }}>{account.active ? label("Sospendi accesso", "Suspender acceso") : label("Riattiva accesso", "Reactivar acceso")}</button>}
                {isAdmin && <button type="button" className="record-delete" onClick={() => remove(account)}>{t("Elimina")}</button>}
              </span>
            )}
          </li>
        ))}
      </ul>
      {canWrite && <form className="record-form portal-account-form" onSubmit={invite}>
        <h4>{label("Invita al portale", "Invitar al portal")}</h4>
        <div className="record-form-actions"><button className="primary" disabled={busy}>{label("Genera link", "Generar enlace")}</button></div>
        {invitation && <div className="issued-password">
          <label>{label("Link di registrazione", "Enlace de registro")}
            <input readOnly value={invitation.url} onFocus={(event) => event.currentTarget.select()} />
          </label>
          <p className="hint">{label("Valido una sola volta fino al", "Válido una sola vez hasta el")} {new Date(invitation.expires_at).toLocaleString(language === "es" ? "es-ES" : "it-IT")}</p>
          <button type="button" className="secondary" onClick={async () => {
            try { await navigator.clipboard.writeText(invitation.url); setMessage(label("Link copiato.", "Enlace copiado.")); }
            catch { setMessage(label("Seleziona e copia il link dal campo.", "Selecciona y copia el enlace del campo.")); }
          }}>{label("Copia link", "Copiar enlace")}</button>
        </div>}
      </form>}
      {canWrite && (
        <details>
        <summary>{label("Creazione manuale dell’accesso", "Crear acceso manualmente")}</summary>
        <form className="record-form portal-account-form" onSubmit={createAccount}>
          <label>{t("Nome referente")}<input required minLength={2} maxLength={160} value={draft.full_name} onChange={(e) => setDraft({ ...draft, full_name: e.target.value })} placeholder={t("Es. Ufficio flotta")} /></label>
          <label>{t("Email")}<input required type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></label>
          <div className="record-form-actions"><button className="primary">{t("Crea accesso")}</button></div>
        </form>
        </details>
      )}
      {suspension && (
        <form className="record-form portal-account-form" onSubmit={(event) => { event.preventDefault(); void toggle(suspension); }}>
          <h4>{label("Sospendi accesso", "Suspender acceso")} · {suspension.email}</h4>
          <label>{label("Motivo interno", "Motivo interno")}
            <select value={reason} onChange={(event) => setReason(event.target.value)} required>
              <option value="">{label("Seleziona un motivo", "Selecciona un motivo")}</option>
              <option value="Pagamento in sospeso">{label("Pagamento in sospeso", "Pago pendiente")}</option>
              <option value="Motivo amministrativo">{label("Motivo amministrativo", "Motivo administrativo")}</option>
              <option value="Altro">{label("Altro", "Otro")}</option>
            </select>
          </label>
          <button className="primary" disabled={busy}>{label("Conferma sospensione", "Confirmar suspensión")}</button>
          <button type="button" className="secondary" disabled={busy} onClick={() => setSuspension(null)}>{t("Annulla")}</button>
        </form>
      )}
      <CustomerServiceRequests key={customerId} customerId={customerId} canWrite={canWrite} />
    </div>
  );
}
