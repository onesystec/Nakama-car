"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useLanguage } from "./LanguageProvider";
import { NakamaLogo } from "./NakamaLogo";
import { PasswordInput } from "./PasswordInput";
import { LegalLinks } from "./Legal";
import { API_URL } from "../lib/api";

type CustomerType = "COMPANY" | "PRIVATE";
type Invite = { email: string | null; customer_name: string | null; customer_type: CustomerType };
type Problem = "invalid" | "network" | "password" | "form" | "duplicate";
type Step = "type" | "company" | "person" | "address" | "password";

const EMPTY = {
  first_name: "", last_name: "", email: "", phone: "", tax_code: "",
  company_name: "", vat_number: "", pec: "", sdi: "",
  address: "", postal_code: "", city: "", province: "", country: "IT",
};
type Profile = typeof EMPTY;

/** Steps a client goes through, depending on whether they register a company or themselves. */
export function registrationSteps(type: CustomerType): Step[] {
  return type === "COMPANY" ? ["type", "company", "person", "address", "password"] : ["type", "person", "address", "password"];
}

/** Profile sent to the API: only the fields that belong to the chosen type, without blanks. */
export function registrationProfile(type: CustomerType, values: Profile) {
  const company = ["company_name", "vat_number", "pec", "sdi"];
  const fields = Object.entries(values).filter(([key, value]) => value.trim() && (type === "COMPANY" || !company.includes(key)));
  return { customer_type: type, ...Object.fromEntries(fields.filter(([key]) => key !== "email")) };
}

export function PortalRegistration({ token }: { token: string }) {
  const { language } = useLanguage();
  const label = (it: string, es: string) => language === "es" ? es : it;
  const [invite, setInvite] = useState<Invite | null>(null);
  const [error, setError] = useState<Problem | null>(null);
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

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/portal/invitations/register`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, ...body }),
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

  const messages: Record<Problem, string> = {
    invalid: label("Invito scaduto o non più valido. Chiedi un nuovo link all’officina.", "Invitación caducada o inválida. Pide un nuevo enlace al taller."),
    network: label("Servizio non disponibile. Riprova.", "Servicio no disponible. Inténtalo de nuevo."),
    password: label("Le password non coincidono.", "Las contraseñas no coinciden."),
    form: label("Controlla i dati obbligatori, la partita IVA e il codice SDI.", "Comprueba los datos obligatorios, el IVA y el código SDI."),
    duplicate: label("Esiste già un accesso con questo indirizzo. Usa un’altra email o contatta l’officina.", "Ya existe un acceso con ese correo. Usa otro o contacta con el taller."),
  };

  return (
    <main className="auth-screen">
      <div className="auth-card registration-card">
        <div className="public-brand nakama-auth-brand registration-brand"><NakamaLogo /></div>
        <div className="auth-copy registration-copy"><h1>{label("Crea il tuo accesso", "Crea tu acceso")}</h1></div>
        {registered ? <p role="status" className="registration-done">{label("Accesso creato. Ora puoi accedere con la tua password.", "Acceso creado. Ya puedes entrar con tu contraseña.")}</p> :
          invite?.email ? <NamedInvitation invite={invite} busy={busy} error={error && messages[error]} onMismatch={() => setError("password")} onSend={send} /> :
          invite ? <Wizard initialType={invite.customer_type} busy={busy} error={error && messages[error]} onMismatch={() => setError("password")} onSend={send} /> :
          error ? <p className="auth-error" role="alert">{messages[error]}</p> :
          <p role="status">{label("Verifica dell’invito…", "Verificando invitación…")}</p>}
        <div className="registration-links">
          <a href="/portale/login">{label("Vai all’accesso", "Ir al inicio de sesión")}</a>
          <LegalLinks />
        </div>
      </div>
    </main>
  );
}

type FormProps = { busy: boolean; error: string | null; onMismatch: () => void; onSend: (body: Record<string, unknown>) => void };

/** Older invitations already tied to an email: only name and password. */
function NamedInvitation({ invite, busy, error, onMismatch, onSend }: FormProps & { invite: Invite }) {
  const { language } = useLanguage();
  const label = (it: string, es: string) => language === "es" ? es : it;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    if (fields.get("password") !== fields.get("confirmation")) { onMismatch(); return; }
    onSend({ full_name: fields.get("full_name"), password: fields.get("password") });
  }
  return (
    <form className="auth-form" onSubmit={submit}>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <strong>{invite.customer_name}</strong>
      <label>{label("Nome e cognome", "Nombre y apellidos")}<input name="full_name" autoComplete="name" minLength={2} maxLength={160} required /></label>
      <label>Email<input type="email" value={invite.email ?? ""} readOnly autoComplete="username" /></label>
      <label>Password<PasswordInput name="password" autoComplete="new-password" minLength={10} maxLength={200} required /></label>
      <label>{label("Conferma password", "Confirma la contraseña")}<PasswordInput name="confirmation" autoComplete="new-password" minLength={10} maxLength={200} required /></label>
      <button className="primary auth-submit" disabled={busy}>{label("Crea account", "Crear cuenta")}</button>
    </form>
  );
}

/** Invitation without an email: the client picks company or private person and fills one short step at a time. */
function Wizard({ initialType, busy, error, onMismatch, onSend }: FormProps & { initialType: CustomerType }) {
  const { language } = useLanguage();
  const label = (it: string, es: string) => language === "es" ? es : it;
  const [type, setType] = useState<CustomerType>(initialType);
  const [index, setIndex] = useState(0);
  const [values, setValues] = useState<Profile>(EMPTY);
  const [password, setPassword] = useState({ password: "", confirmation: "" });
  const body = useRef<HTMLDivElement>(null);
  const steps = registrationSteps(type);
  const step = steps[index];
  const last = index === steps.length - 1;
  const company = type === "COMPANY";

  useEffect(() => { body.current?.scrollTo({ top: 0 }); body.current?.querySelector<HTMLElement>("input")?.focus({ preventScroll: true }); }, [index]);

  const titles: Record<Step, string> = {
    type: label("Chi si registra?", "¿Quién se registra?"),
    company: label("Dati dell’azienda", "Datos de la empresa"),
    person: company ? label("Persona di riferimento", "Persona de contacto") : label("I tuoi dati", "Tus datos"),
    address: company ? label("Sede legale", "Sede fiscal") : label("Indirizzo di residenza", "Dirección"),
    password: label("Scegli la password", "Elige la contraseña"),
  };

  function field(name: keyof Profile, text: string, props: Record<string, unknown> = {}) {
    return <label>{text}<input name={name} value={values[name]} onChange={(e) => setValues((current) => ({ ...current, [name]: e.target.value }))} {...props} /></label>;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!last) { setIndex(index + 1); return; }
    if (password.password !== password.confirmation) { onMismatch(); return; }
    onSend({
      full_name: `${values.first_name.trim()} ${values.last_name.trim()}`, email: values.email.trim(),
      password: password.password, profile: registrationProfile(type, values),
    });
  }

  return (
    <form className="registration-wizard" onSubmit={submit}>
      <div className="registration-progress" aria-hidden="true">
        {steps.map((name, position) => <span key={name} className={position <= index ? "done" : ""} />)}
      </div>
      <div className="registration-step-head">
        <small>{label("Passo", "Paso")} {index + 1} / {steps.length}</small>
        <h2>{titles[step]}</h2>
      </div>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <div className="registration-body auth-form" ref={body}>
        {step === "type" && <div className="registration-types" role="radiogroup">
          {([["COMPANY", label("Azienda", "Empresa"), label("Ditta, società o flotta: ragione sociale, partita IVA, PEC e SDI.", "Empresa o flota: razón social, IVA, PEC y SDI.")],
            ["PRIVATE", label("Privato", "Particular"), label("Persona fisica: nome, cognome e codice fiscale.", "Persona física: nombre, apellidos y código fiscal.")]] as const).map(([value, title, hint]) =>
            <button type="button" role="radio" aria-checked={type === value} key={value}
              className={`registration-type ${type === value ? "selected" : ""}`} onClick={() => setType(value)}>
              <span className="registration-type-icon">{value === "COMPANY" ? "🏢" : "👤"}</span>
              <strong>{title}</strong><span>{hint}</span>
            </button>)}
        </div>}
        {step === "company" && <>
          {field("company_name", label("Ragione sociale", "Razón social"), { autoComplete: "organization", maxLength: 180, required: true })}
          <div className="registration-row">
            {field("vat_number", label("Partita IVA", "Número de IVA"), { maxLength: 32, required: true })}
            {field("tax_code", label("Codice fiscale", "Código fiscal"), { maxLength: 32, required: true })}
          </div>
          {field("pec", label("PEC (facoltativa)", "PEC (opcional)"), { type: "email", maxLength: 255 })}
          {field("sdi", label("Codice SDI (facoltativo)", "Código SDI (opcional)"), { pattern: "[A-Za-z0-9]{7}", maxLength: 7, title: label("Il codice SDI ha 7 caratteri (lettere e numeri).", "El código SDI tiene 7 caracteres (letras y números).") })}
        </>}
        {step === "person" && <>
          <div className="registration-row">
            {field("first_name", label("Nome", "Nombre"), { autoComplete: "given-name", maxLength: 120, required: true })}
            {field("last_name", label("Cognome", "Apellidos"), { autoComplete: "family-name", maxLength: 120, required: true })}
          </div>
          {!company && field("tax_code", label("Codice fiscale", "Código fiscal"), { maxLength: 32, required: true })}
          {field("email", "Email", { type: "email", autoComplete: "username", maxLength: 255, required: true })}
          {field("phone", label("Telefono", "Teléfono"), { type: "tel", autoComplete: "tel", maxLength: 32, required: true })}
        </>}
        {step === "address" && <>
          {field("address", label("Indirizzo e numero civico", "Dirección y número"), { autoComplete: "street-address", maxLength: 255, required: true })}
          {field("city", label("Comune", "Municipio"), { autoComplete: "address-level2", maxLength: 120, required: true })}
          <div className="registration-row three">
            {field("postal_code", label("CAP", "C.P."), { autoComplete: "postal-code", maxLength: 16, required: true })}
            {field("province", label("Prov.", "Prov."), { autoComplete: "address-level1", maxLength: 8, required: true })}
            {field("country", label("Paese", "País"), { autoComplete: "country", pattern: "[A-Za-z]{2}", maxLength: 2, required: true, title: label("Due lettere, per esempio IT.", "Dos letras, por ejemplo IT.") })}
          </div>
        </>}
        {step === "password" && <>
          <p className="registration-summary">{company ? values.company_name : `${values.first_name} ${values.last_name}`} · {values.email}</p>
          <label>Password<PasswordInput name="password" autoComplete="new-password" minLength={10} maxLength={200} required value={password.password} onChange={(e) => setPassword({ ...password, password: e.target.value })} /></label>
          <label>{label("Conferma password", "Confirma la contraseña")}<PasswordInput name="confirmation" autoComplete="new-password" minLength={10} maxLength={200} required value={password.confirmation} onChange={(e) => setPassword({ ...password, confirmation: e.target.value })} /></label>
          <small className="registration-hint">{label("Almeno 10 caratteri.", "Al menos 10 caracteres.")}</small>
        </>}
      </div>
      <div className="registration-actions">
        {index > 0 && <button type="button" className="secondary" onClick={() => setIndex(index - 1)}>{label("Indietro", "Atrás")}</button>}
        <button className="primary" disabled={busy}>{last ? label("Crea account", "Crear cuenta") : label("Avanti", "Siguiente")}</button>
      </div>
    </form>
  );
}
