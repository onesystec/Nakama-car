"use client";

import { FormEvent, useEffect, useState } from "react";
import { LegalLinks } from "../../../components/Legal";
import { NakamaLogo } from "../../../components/NakamaLogo";
import { useLanguage } from "../../../components/LanguageProvider";
import { API_URL } from "../../../lib/api";

export default function RecoveryPage() {
  const { language } = useLanguage();
  const label = (it: string, es: string) => language === "es" ? es : it;
  const [area, setArea] = useState("staff");
  const [token, setToken] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const url = new URL(window.location.href);
    setArea(url.searchParams.get("area") === "portal" ? "portal" : "staff");
    setToken(url.hash.slice(1));
    if (url.hash) window.history.replaceState(window.history.state, "", url.pathname + url.search);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    if (token && fields.get("password") !== fields.get("confirmation")) {
      setError(label("Le password non coincidono.", "Las contraseñas no coinciden."));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const action = token ? "confirm" : "request";
      const body = token ? { token, password: fields.get("password") } : { email: fields.get("email"), account_type: area };
      const response = await fetch(`${API_URL}/auth/recovery/${action}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (response.ok) setDone(true);
      else if (token && response.status === 400) setError(label(
        "Il link è scaduto o è già stato usato. Richiedine un altro.", "El enlace caducó o ya fue utilizado. Solicita otro."
      ));
      else setError(label("Operazione non disponibile. Riprova o contatta l’officina.", "Operación no disponible. Inténtalo de nuevo o contacta con el taller."));
    } catch {
      setError(label("Server non raggiungibile. Riprova.", "No se pudo conectar con el servidor. Inténtalo de nuevo."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="public-estimate">
      <section className="public-card">
        <div className="public-brand nakama-public-brand"><NakamaLogo /></div>
        <h1>{label("Recupera la password", "Recupera tu contraseña")}</h1>
        {done ? <p role="status">{token ? label("Password aggiornata. Ora puoi accedere.", "Contraseña actualizada. Ya puedes iniciar sesión.") :
          label("Se l’indirizzo è associato a un account attivo, riceverai un link valido 20 minuti.", "Si el correo pertenece a una cuenta activa, recibirás un enlace válido durante 20 minutos.")}</p> :
          token !== null && <form className="auth-form" onSubmit={submit}>
            {token ? <>
              <label>{label("Nuova password", "Nueva contraseña")}<input name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={200} /></label>
              <label>{label("Conferma la password", "Confirma la contraseña")}<input name="confirmation" type="password" autoComplete="new-password" required minLength={10} maxLength={200} /></label>
            </> : <label>Email<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>}
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="primary auth-submit" disabled={busy}>{token ? label("Salva password", "Guardar contraseña") : label("Invia il link", "Enviar enlace")}</button>
          </form>}
        {token && !done && <p><a href={`/login/recover?area=${area}`}>{label("Richiedi un nuovo link", "Solicitar otro enlace")}</a></p>}
        <p><a href={area === "portal" ? "/portale/login" : "/login"}>{label("Torna all’accesso", "Volver al inicio de sesión")}</a></p>
        <LegalLinks />
      </section>
    </main>
  );
}
