"use client";

import { useLanguage } from "../../components/LanguageProvider";

import { PasswordInput } from "../../components/PasswordInput";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { API_URL, saveSession } from "../../lib/api";
import { NakamaLogo } from "../../components/NakamaLogo";
import { savePortalToken } from "../../lib/portal";
import { acceptLegal, changeStaffPassword, needsLegal, needsPasswordChange, signIn, SignInResult } from "../../lib/signin";
import { LegalLinks, LegalStep } from "../../components/Legal";
import { PasswordStep } from "../../components/PasswordStep";

export default function LoginPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [expired, setExpired] = useState(false);
  const [next, setNext] = useState("/");
  // Signed in, waiting for the two boxes (terms, privacy) before the session is saved.
  const [pending, setPending] = useState<SignInResult | null>(null);
  // Signed in with a temporary password: the worker chooses their own before the session is saved.
  const [temporary, setTemporary] = useState<{ result: SignInResult; password: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setExpired(params.get("expired") === "1");
    const target = params.get("next") || "/";
    // Only same-site paths, never an external address.
    setNext(target.startsWith("/") && !target.startsWith("//") ? target : "/");
  }, []);

  function enter(result: SignInResult) {
    if (result.kind === "portal") {
      // Customers often type their portal access here: log them into the portal instead.
      savePortalToken(result.token);
      window.location.assign("/portale");
    } else if (result.kind === "staff") {
      saveSession(result.session);
      router.push(next);
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

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await signIn(API_URL, email, password, "staff");
      if (result.kind === "error") throw new Error(result.message);
      if (needsLegal(result)) setPending(result);
      else proceed(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Accesso non riuscito");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-screen">
      <div className="auth-card">
        <div className="public-brand nakama-auth-brand"><NakamaLogo /></div>
        <div className="auth-copy"><p className="eyebrow">{t("ACCESSO OPERATORE")}</p><h1>{t("Accedi alla carrozzeria")}</h1><p>{t("Gestisci pratiche, preventivi, lavorazioni e fatturazione.")}</p></div>
        {temporary ? <PasswordStep temporary={temporary.password} onSave={savePassword} onCancel={() => { setTemporary(null); setPassword(""); }} /> :
        pending ? <LegalStep onAccept={async () => { const ok = await acceptLegal(API_URL, pending); if (ok) { setPending(null); proceed(pending); } return ok; }} onCancel={() => { setPending(null); setPassword(""); }} /> :
        <form onSubmit={submit} className="auth-form">
          <label>{t("Email")}<input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@azienda.it" /></label>
          <label>{t("Password")}<PasswordInput required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          {expired && !error && <div className="auth-error" role="status">{t("Sessione scaduta. Accedi di nuovo per continuare.")}</div>}
          {error && <div className="auth-error">{t(error)}</div>}
          <button className="primary auth-submit" disabled={loading}>{loading ? t("Accesso…") : t("Accedi")}</button>
        </form>}
        <p className="auth-foot"><a href="/portale/login">{t("Sei un cliente? Accedi al portale")}</a></p>
        <p className="auth-foot">{t("Primo avvio? Utilizza la pagina di inizializzazione riservata all'amministratore.")}</p>
        <LegalLinks />
      </div>
    </main>
  );
}
