"use client";

import { FormEvent, useState } from "react";
import { useLanguage } from "./LanguageProvider";
import { PasswordInput } from "./PasswordInput";

/** Login step for a worker who entered with the temporary password shared by the administrator. */
export function PasswordStep({ temporary, onSave, onCancel }: {
  /** The password just typed at login, so the worker does not have to type it again. */
  temporary: string;
  onSave: (currentPassword: string, newPassword: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (next !== repeat) { setError(t("Le due password non coincidono.")); return; }
    if (next === temporary) { setError(t("La nuova password deve essere diversa.")); return; }
    setSaving(true);
    const problem = await onSave(temporary, next);
    if (problem) setError(t(problem));
    setSaving(false);
  }

  return (
    <form className="auth-form password-step" onSubmit={submit}>
      <p>{t("Stai usando la password temporanea ricevuta dall’amministratore. Scegli la tua password per entrare: almeno 10 caratteri.")}</p>
      <label>{t("Nuova password")}<PasswordInput required minLength={10} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></label>
      <label>{t("Ripeti la nuova password")}<PasswordInput required minLength={10} autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} /></label>
      {error && <div className="auth-error" role="alert">{error}</div>}
      <button className="primary auth-submit" disabled={saving}>{saving ? t("Salvataggio…") : t("Salva password ed entra")}</button>
      <button type="button" className="secondary" onClick={onCancel}>{t("Annulla")}</button>
    </form>
  );
}
