/*
 * Einstellung der Leistungsnachweis-App
 * -------------------------------------
 * serverUrl: die Web-App-URL aus Google Apps Script.
 *            Sie beginnt mit https://script.google.com/macros/s/ und endet auf /exec
 *            Leer lassen ('') = Demo-Modus: alles funktioniert, aber nichts wird gesendet.
 * texts:     (optional) Textkorrekturen, z. B. nach dem Gegenlesen durch Muttersprachler.
 *            Die Datei TEXTE-ZUM-GEGENLESEN.html erzeugt diese Datei fertig. Von Hand geht es so:
 *              texts: { ar: { loginBtn: '…' }, ku: { loginBtn: '…' } }
 *            Es zählen nur bekannte Schlüssel, Texte bis 500 Zeichen und dieselben {Platzhalter} wie im deutschen Text.
 *            Was nicht gilt, wird ignoriert. Im Gerätetest ("Verbindung testen") steht die Zeile
 *            "Textkorrekturen (config.js)" mit der Zahl der angewendeten Korrekturen.
 */
window.LN_CONFIG = {
  serverUrl: ''
};
