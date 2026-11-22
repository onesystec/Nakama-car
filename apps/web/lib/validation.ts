// Browsers word form-validation bubbles in their own language ("Completa este campo" on a
// Spanish Mac). The app speaks Italian by default, so the bubbles follow the app language.

type Language = "it" | "es";
type Field = {
  type?: string;
  minLength?: number;
  maxLength?: number;
  min?: string;
  max?: string;
  value?: string;
  validity: Partial<Record<keyof ValidityState, boolean>>;
};

export function validationMessage(field: Field, language: Language): string {
  const l = (it: string, es: string) => language === "es" ? es : it;
  const v = field.validity;
  const type = field.type || "";
  if (v.valueMissing) {
    if (type === "checkbox") return l("Seleziona questa casella per continuare.", "Marca esta casilla para continuar.");
    if (type === "radio" || type.startsWith("select")) return l("Seleziona un’opzione.", "Selecciona una opción.");
    if (type === "file") return l("Seleziona un file.", "Selecciona un archivo.");
    return l("Compila questo campo.", "Rellena este campo.");
  }
  if (v.typeMismatch) {
    if (type === "email") return l("Inserisci un indirizzo email valido.", "Introduce un correo electrónico válido.");
    if (type === "url") return l("Inserisci un indirizzo web valido.", "Introduce una dirección web válida.");
    return l("Il valore non è valido.", "El valor no es válido.");
  }
  if (v.badInput) return l("Inserisci un numero valido.", "Introduce un número válido.");
  if (v.tooShort) return l(`Inserisci almeno ${field.minLength} caratteri (ora ${field.value?.length ?? 0}).`, `Introduce al menos ${field.minLength} caracteres (ahora ${field.value?.length ?? 0}).`);
  if (v.tooLong) return l(`Massimo ${field.maxLength} caratteri.`, `Máximo ${field.maxLength} caracteres.`);
  if (v.rangeUnderflow) return l(`Il valore deve essere almeno ${field.min}.`, `El valor debe ser al menos ${field.min}.`);
  if (v.rangeOverflow) return l(`Il valore deve essere al massimo ${field.max}.`, `El valor debe ser como máximo ${field.max}.`);
  if (v.stepMismatch) return l("Il valore non è valido.", "El valor no es válido.");
  if (v.patternMismatch) return l("Il formato non è valido.", "El formato no es válido.");
  return "";
}

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function isControl(target: EventTarget | null): target is Control {
  return typeof HTMLElement !== "undefined" && (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement);
}

/** Words every native validation bubble in the page in the given language. Returns the cleanup. */
export function localizeValidation(root: Document, language: () => Language): () => void {
  const onInvalid = (event: Event) => {
    const field = event.target;
    if (!isControl(field) || field.dataset.ownValidity !== undefined) return;
    field.setCustomValidity("");
    if (field.validity.valid) return;
    const input = field as HTMLInputElement;
    const message = validationMessage({
      type: field.type, minLength: input.minLength, maxLength: input.maxLength, min: input.min, max: input.max,
      value: field.value, validity: field.validity as unknown as Field["validity"],
    }, language());
    // A field's own title explains its pattern better than a generic sentence.
    field.setCustomValidity(field.validity.patternMismatch && field.title ? field.title : message);
  };
  const reset = (event: Event) => { if (isControl(event.target) && event.target.dataset.ownValidity === undefined) event.target.setCustomValidity(""); };
  root.addEventListener("invalid", onInvalid, true);
  root.addEventListener("input", reset, true);
  root.addEventListener("change", reset, true);
  return () => {
    root.removeEventListener("invalid", onInvalid, true);
    root.removeEventListener("input", reset, true);
    root.removeEventListener("change", reset, true);
  };
}
