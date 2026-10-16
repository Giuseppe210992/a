// Preferenze legate a questo computer (tema, barra laterale, filtri): stanno nel browser/finestra
// e non fanno parte dei backup. Se la memoria locale non e' disponibile il programma funziona lo stesso.

export function leggiPref(chiave, predefinito = null) {
  try {
    const v = window.localStorage.getItem(`gi.${chiave}`);
    return v === null ? predefinito : JSON.parse(v);
  } catch {
    return predefinito;
  }
}

export function scriviPref(chiave, valore) {
  try {
    window.localStorage.setItem(`gi.${chiave}`, JSON.stringify(valore));
  } catch { /* memoria locale non disponibile: la preferenza vale solo per questa sessione */ }
}
