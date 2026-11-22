"use client";

import { FormEvent, useEffect, useState } from "react";
import { useLanguage } from "../../../components/LanguageProvider";
import { NakamaLogo } from "../../../components/NakamaLogo";
import { PasswordInput } from "../../../components/PasswordInput";
import { API_URL, saveSession } from "../../../lib/api";
import { acceptLegal, changeStaffPassword, needsLegal, needsPasswordChange, signIn, SignInResult } from "../../../lib/signin";
import { LegalLinks, LegalStep } from "../../../components/Legal";
import { PasswordStep } from "../../../components/PasswordStep";
import { savePortalToken } from "../../../lib/portal";

export default function PortalLoginPage() {
  const { t, language } = useLanguage();
  const [invitation, setInvitation] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [expired, setExpired] = useState(false);
  // Signed in, waiting for the two boxes (terms, privacy) before the session is saved.
  const [pending, setPending] = useState<SignInResult | null>(null);
  // Signed in with a temporary password: the worker chooses their own before the session is saved.
  const [temporary, setTemporary] = useState<{ result: SignInResult; password: string } | null>(null);

  useEffect(() => {
    setInvitation(new URLSearchParams(window.location.hash.slice(1)).get("invito") || "");
    setExpired(new URLSearchParams(window.location.search).get("expired") === "1");
  }, []);

  function enter(result: SignInResult) {
    if (result.kind === "staff") {
      // Workshop staff (admin, mechanics…) who typed their access here go to the workshop app.
      saveSession(result.session);
      window.location.assign("/");
    } else if (result.kind === "portal") {
      savePortalToken(result.token);
      window.location.assign("/portale");
    }
  }

  /** After the terms: a worker on a temporary password chooses a new one, everyone else goes in. */
  function proceed(result: SignInResult) {
    if (needsPasswordChange(result)) setTemporary({ result, password });
    else enter(result);
  }

  async function savePassword(current: string, next: string): Promise<string | null> {
    if (temporary?.result.kind !== "staff") return null;
    const changed = await changeStaffPassword(API_URL, temporary.result.session, current, next);
    if (!changed.ok) return changed.message;
    enter({ kind: "staff", session: changed.session });
    return null;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await signIn(API_URL, email, password, "portal");
      if (result.kind === "error") throw new Error(result.message);
      if (needsLegal(result)) setPending(result);
      else proceed(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Accesso non riuscito");
    } finally {
      setLoading(false);
    }
  }

  if (invitation) return <InvitationRegistration token={invitation} />;

  return (
    <main className="auth-screen">
      <div className="auth-card">
        <div className="public-brand nakama-auth-brand"><NakamaLogo /></div>
        <div className="auth-copy">
          <p className="eyebrow">{t("AREA CLIENTI FLOTTE")}</p>
          <h1>{t("I tuoi veicoli in officina")}</h1>
          <p>{t("Stato delle riparazioni, prossime manutenzioni e storico interventi.")}</p>
        </div>
        {temporary ? <PasswordStep temporary={temporary.password} onSave={savePassword} onCancel={() => { setTemporary(null); setPassword(""); }} /> :
        pending ? <LegalStep onAccept={async () => { const ok = await acceptLegal(API_URL, pending); if (ok) { setPending(null); proceed(pending); } return ok; }} onCancel={() => { setPending(null); setPassword(""); }} /> :
        <form onSubmit={submit} className="auth-form">
          <label>{t("Email")}<input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>{t("Password")}<PasswordInput required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          {expired && !error && <div className="auth-error" role="status">{t("Sessione scaduta. Accedi di nuovo per continuare.")}</div>}
          {error && <div className="auth-error">{t(error)}</div>}
          <button className="primary auth-submit" disabled={loading}>{loading ? t("Accesso…") : t("Accedi")}</button>
        </form>}
        <p className="auth-foot">{t("Non hai le credenziali? Chiedile all'officina.")}</p>
        <a href="/login/recover?area=portal">{language === "es" ? "¿Olvidaste la contraseña?" : "Password dimenticata?"}</a>
        <LegalLinks />
      </div>
    </main>
  );
}

function InvitationRegistration({ token }: { token: string }) {
  const { language } = useLanguage();
  const label = (it: string, es: string) => language === "es" ? es : it;
  const [invite, setInvite] = useState<{ email: string | null; customer_name: string | null; customer_type: "COMPANY" | "PRIVATE" } | null>(null);
  const [error, setError] = useState<"invalid" | "network" | "password" | "form" | "duplicate" | null>(null);
  const [registered, setRegistered] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    async function loadInvitation() {
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) { setError("invalid"); return; }
      try {
        const response = await fetch(`${API_URL}/portal/invitations/preview`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }), signal: controller.signal,
        });
        if (response.ok) setInvite(await response.json());
        else setError(response.status === 404 ? "invalid" : "network");
      } catch {
        if (!controller.signal.aborted) setError("network");
      }
    }
    void loadInvitation();
    return () => controller.abort();
  }, [token]);

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    if (fields.get("password") !== fields.get("confirmation")) { setError("password"); return; }
    const profile = invite?.email === null ? Object.fromEntries(
      [...fields.entries()].filter(([key, value]) => !["email", "password", "confirmation"].includes(key) && String(value).trim()),
    ) : undefined;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/portal/invitations/register`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, full_name: profile ? [profile.first_name, profile.last_name].join(" ") : fields.get("full_name"), password: fields.get("password"), email: profile ? fields.get("email") : undefined, profile }),
      });
      if (response.ok) {
        setRegistered(true);
        window.history.replaceState(window.history.state, "", "/portale/login");
      } else if (response.status === 404) {
        setInvite(null);
        setError("invalid");
      } else setError(response.status === 409 ? "duplicate" : response.status === 422 ? "form" : "network");
    } catch {
      setError("network");
    } finally {
      setBusy(false);
    }
  }

  const messages = {
    invalid: label("Invito scaduto o non più valido. Chiedi un nuovo link all’officina.", "Invitación caducada o inválida. Pide un nuevo enlace al taller."),
    network: label("Servizio non disponibile. Riprova.", "Servicio no disponible. Inténtalo de nuevo."),
    password: label("Le password non coincidono.", "Las contraseñas no coinciden."),
    form: label("Controlla i dati obbligatori, la partita IVA e il codice SDI.", "Comprueba los datos obligatorios, el IVA y el código SDI."),
    duplicate: label("Esiste già un accesso con questo indirizzo. Usa un’altra email o contatta l’officina.", "Ya existe un acceso con ese correo. Usa otro o contacta con el taller."),
  };
  return (
    <main className="auth-screen">
      <div className="auth-card">
        <div className="public-brand nakama-auth-brand"><NakamaLogo /></div>
        <div className="auth-copy"><h1>{label("Crea il tuo accesso", "Crea tu acceso")}</h1></div>
        {error && <p className="auth-error" role="alert">{messages[error]}</p>}
        {registered ? <p role="status">{label("Accesso creato. Ora puoi accedere con la tua password.", "Acceso creado. Ya puedes entrar con tu contraseña.")}</p> :
          invite ? <form className="auth-form" onSubmit={register}>
            {invite.email ? <>
              <strong>{invite.customer_name}</strong>
              <label>{label("Nome e cognome", "Nombre y apellidos")}<input name="full_name" autoComplete="name" minLength={2} maxLength={160} required /></label>
              <label>Email<input type="email" value={invite.email} readOnly autoComplete="username" /></label>
            </> : <>
              <h2>{invite.customer_type === "COMPANY" ? label("Dati aziendali e di fatturazione", "Datos de empresa y facturación") : label("Dati del cliente", "Datos del cliente")}</h2>
              <label>{label("Nome", "Nombre")}<input name="first_name" autoComplete="given-name" maxLength={120} required /></label>
              <label>{label("Cognome", "Apellidos")}<input name="last_name" autoComplete="family-name" maxLength={120} required /></label>
              <label>Email<input name="email" type="email" autoComplete="username" maxLength={255} required /></label>
              <label>{label("Telefono", "Teléfono")}<input name="phone" type="tel" autoComplete="tel" maxLength={32} required /></label>
              {invite.customer_type === "COMPANY" && <>
                <label>{label("Ragione sociale", "Razón social")}<input name="company_name" autoComplete="organization" maxLength={180} required /></label>
                <label>{label("Partita IVA", "Número de IVA")}<input name="vat_number" maxLength={32} required /></label>
                <label>{label("PEC (facoltativa)", "PEC (opcional)")}<input name="pec" type="email" maxLength={255} /></label>
                <label>{label("Codice SDI (facoltativo)", "Código SDI (opcional)")}<input name="sdi" pattern="[A-Za-z0-9]{7}" maxLength={7} /></label>
              </>}
              <label>{label("Codice fiscale", "Código fiscal")}<input name="tax_code" maxLength={32} required /></label>
              <label>{label("Indirizzo e numero civico", "Dirección y número")}<input name="address" autoComplete="street-address" maxLength={255} required /></label>
              <label>{label("CAP", "Código postal")}<input name="postal_code" autoComplete="postal-code" maxLength={16} required /></label>
              <label>{label("Comune", "Municipio")}<input name="city" autoComplete="address-level2" maxLength={120} required /></label>
              <label>{label("Provincia", "Provincia")}<input name="province" autoComplete="address-level1" maxLength={8} required /></label>
              <label>{label("Paese (codice ISO di due lettere)", "País (código ISO de dos letras)")}<input name="country" autoComplete="country" defaultValue="IT" pattern="[A-Za-z]{2}" maxLength={2} required /></label>
            </>}
            <label>Password<PasswordInput name="password" autoComplete="new-password" minLength={10} maxLength={200} required /></label>
            <label>{label("Conferma password", "Confirma la contraseña")}<PasswordInput name="confirmation" autoComplete="new-password" minLength={10} maxLength={200} required /></label>
            <button className="primary auth-submit" disabled={busy}>{label("Crea account", "Crear cuenta")}</button>
          </form> : !error && <p role="status">{label("Verifica dell’invito…", "Verificando invitación…")}</p>}
        <a href="/portale/login">{label("Vai all’accesso", "Ir al inicio de sesión")}</a>
        <LegalLinks />
      </div>
    </main>
  );
}
