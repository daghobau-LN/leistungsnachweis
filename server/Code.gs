/**
 * =====================================================================
 *  LEISTUNGSNACHWEIS-APP · Server (Google Apps Script)
 *  Version 1.2.1
 * ---------------------------------------------------------------------
 *  Gehört in eine Google-Tabelle:  Erweiterungen → Apps Script.
 *   1. Diesen Code komplett einfügen (alten Inhalt ersetzen), speichern.
 *   2. Oben die Funktion "einrichten" auswählen → Ausführen → zulassen.
 *   3. Bereitstellen → Neue Bereitstellung → Typ "Web-App"
 *      Ausführen als: Ich · Zugriff: Jeder → Web-App-URL kopieren.
 *   4. Menü "Leistungsnachweis" in der Tabelle → "Selbsttest" und
 *      "Automatik einschalten".
 *  Ausführliche Anleitung: ANLEITUNG.html
 *
 *  Was der Server macht:
 *   - prüft PIN / Anmeldung (signiertes Token, kein Passwort im Klartext
 *     auf dem Handy),
 *   - speichert jeden Nachweis als Zeile im Blatt "Nachweise",
 *   - übersetzt Arabisch / Kurdisch automatisch ins Deutsche,
 *   - erzeugt je Nachweis ein Google-Dokument im Original und auf Deutsch
 *     und schickt beides als Word + PDF per E-Mail,
 *   - protokolliert jede Änderung (Blatt "Änderungen"),
 *   - legt täglich eine Sicherungskopie (Excel) in Google Drive ab.
 * =====================================================================
 */

const APP_VERSION = '1.2.1';
const TZ = 'Europe/Berlin';

/** Firmendesign Dagho Bau für Dokumente und E-Mail (Logo: LOGO_PNG_B64 am Ende der Datei) */
const BRAND = { deep: '#157977', soft: '#E3F3F2' };
const LOGO_DOC_W = 100;         // Breite des Logos im Dokument (pt); Höhe nach Seitenverhältnis
const LOGO_RATIO = 294 / 480;   // Höhe / Breite des eingebetteten PNG

const TOKEN_MAX_AGE_MS = 180 * 24 * 3600 * 1000; // Anmeldung gilt 180 Tage
const LOGIN_MAX_FAILS = 20;                        // Fehlversuche (gesamt) …
const LOGIN_LOCK_SECONDS = 600;                    // … dann 10 Min. Sperre für neue Anmeldungen
const LOGIN_MAX_FAILS_DAY = 50;                    // höchstens 50 Fehlversuche pro Tag, dann Sperre + Warn-E-Mail
const PHOTO_MAX = 3;                               // höchstens 3 Fotos je Nachweis (Speicher auf dem Handy, Größe der Anfrage)
const PHOTO_MAX_CHARS = 400000;                    // je Foto höchstens ~400.000 Zeichen (≈ 290 KB Bild) – die App verkleinert vorher
const PHOTO_DOC_W = 260;                           // Breite im Word/PDF-Dokument (pt)
const PIN_MIN_STAFF = 6;                           // PIN-Länge: Mitarbeiter mindestens 6 Ziffern …
const PIN_MIN_OFFICE = 8;                          // … Büro mindestens 8 Ziffern (sieht alle Nachweise)
const PIN_MAX = 10;
const MAX_REPORTS_PER_DAY = 30;                    // Schutz vor Massen-Einträgen (E-Mail-Kontingent: 100/Tag)
const LOCK_WAIT_MS = 45000;                        // so lange wartet ein Nachweis auf einen anderen, der gerade Dokumente erzeugt
const SLOW_LOCK_WAIT_MS = 20000;                   // Messung: Wartezeit auf die Sperre, ab der eine Warnung ins Protokoll kommt
const SLOW_SUBMIT_MS = 60000;                      // Messung: Gesamtdauer eines Versands, ab der eine Warnung ins Protokoll kommt
const TIMINGS_KEEP = 30;                           // so viele Zeitmessungen bleiben für den Systemcheck gespeichert
const MAIL_MAX_ATTEMPTS = 3;
const MAIL_STUCK_MINUTES = 15;                     // "wird gesendet …" länger als das = Ausführung abgebrochen → erneut senden
const TRANSLATION_FAILED_MARK = '⚠ Automatische Übersetzung fehlgeschlagen';

/**
 * Ausrichtung arabischer Absätze in den Google-Dokumenten: 'NONE' (Standard), 'RIGHT' oder 'LEFT'.
 * 'NONE' setzt keine Ausrichtung: Google richtet Absätze mit Schreibrichtung rechts-nach-links dann selbst am Zeilenanfang
 * (also rechts) aus. Das ist die sicherste Einstellung, weil "links"/"rechts" bei solchen Absätzen je nach Google-Auslegung
 * vertauscht sein können. Nur ändern, wenn das arabische Dokument im Selbsttest falsch herum ausgerichtet ist (siehe ANLEITUNG, Fehlersuche).
 */
const RTL_ALIGNMENT = 'NONE';

const STATUS = { SUBMITTED: 'eingereicht', CORRECTED: 'korrigiert', APPROVED: 'freigegeben' };
const LANGS = ['ar', 'ku', 'de'];
const LANG_TAG = { ar: 'AR', ku: 'KU', de: 'DE' };
const LANG_NAME_DE = { ar: 'Arabisch', ku: 'Kurdisch (Kurmancî)', de: 'Deutsch' };
const LANG_FROM_DE = { ar: 'dem Arabischen', ku: 'dem Kurdischen (Kurmancî)', de: 'dem Deutschen' };

const SHEET = {
  REPORTS: 'Nachweise',
  STAFF: 'Mitarbeiter',
  PROJECTS: 'Bauvorhaben',
  ACTIVITIES: 'Tätigkeiten',
  CHANGES: 'Änderungen',
  SETTINGS: 'Einstellungen',
  LOG: 'Protokoll'
};

/** Spalten im Blatt "Nachweise": [Schlüssel, Überschrift, Typ (t=Text, n=Zahl, h=Stunden), technisch] */
const REPORT_COLS = [
  ['id', 'Nachweis-Nr.', 't'],
  ['status', 'Status', 't'],
  ['date', 'Datum', 't'],
  ['employeeName', 'Mitarbeiter', 't'],
  ['projectDe', 'Bauvorhaben', 't'],
  ['start', 'Beginn', 't'],
  ['end', 'Ende', 't'],
  ['pauseMin', 'Pause (Min.)', 'n'],
  ['hours', 'Arbeitszeit (Std.)', 'h'],
  ['activitiesDe', 'Tätigkeiten', 't'],
  ['descriptionDe', 'Beschreibung (Deutsch)', 't'],
  ['materialDe', 'Material/Geräte (Deutsch)', 't'],
  ['lang', 'Sprache', 't'],
  ['descriptionOrig', 'Beschreibung (Original)', 't'],
  ['materialOrig', 'Material/Geräte (Original)', 't'],
  ['projectOrig', 'Bauvorhaben (Original)', 't'],
  ['activitiesOrig', 'Tätigkeiten (Original)', 't'],
  ['photoCount', 'Fotos (Anzahl)', 'n'],
  ['sigEmployeeInfo', 'Unterschrift Mitarbeiter', 't'],
  ['sigClientInfo', 'Unterschrift Auftraggeber', 't'],
  ['clientName', 'Name Unterzeichner', 't'],
  ['docDeUrl', 'Dokument Deutsch', 't'],
  ['docOrigUrl', 'Dokument Original', 't'],
  ['mailStatus', 'E-Mail', 't'],
  ['version', 'Version', 'n'],
  ['createdAt', 'Erstellt', 't'],
  ['updatedAt', 'Geändert', 't'],
  ['updatedBy', 'Geändert von', 't'],
  ['employeeId', 'Mitarbeiter-ID', 't', true],
  ['projectId', 'Bauvorhaben-ID', 't', true],
  ['activityIds', 'Tätigkeiten-IDs', 't', true],
  ['clientId', 'Client-ID', 't', true],
  ['lastEditId', 'Letzte Änderungs-ID', 't', true],
  ['sigData', 'Unterschrift-Daten', 't', true],
  ['photoData', 'Foto-Daten', 't', true],
  ['docIds', 'Dokument-IDs', 't', true]
];

/** Felder, deren Änderung protokolliert und in der Korrektur-E-Mail genannt wird */
const DIFF_FIELDS = [
  ['date', 'Datum'], ['projectDe', 'Bauvorhaben'], ['start', 'Beginn'], ['end', 'Ende'],
  ['pauseMin', 'Pause (Min.)'], ['activitiesDe', 'Tätigkeiten'],
  ['descriptionOrig', 'Beschreibung (Original)'], ['descriptionDe', 'Beschreibung (Deutsch)'],
  ['materialOrig', 'Material/Geräte (Original)'], ['materialDe', 'Material/Geräte (Deutsch)'],
  ['clientName', 'Name Unterzeichner']
];

/** Einstellungen (Blatt "Einstellungen"): [Schlüssel, Bezeichnung, Standardwert, Erklärung] */
const SETTINGS_DEF = [
  ['firma', 'Firmenname', 'Meine Firma GmbH', 'Steht oben auf jedem Nachweis.'],
  ['recipients', 'E-Mail-Empfänger', '', 'Hierhin gehen alle Nachweise. Mehrere Adressen mit Komma trennen.'],
  ['attachWord', 'Word-Datei anhängen', 'ja', 'ja / nein'],
  ['attachPdf', 'PDF anhängen', 'ja', 'ja / nein'],
  ['weeklyTo', 'Wochenliste an', '', 'Excel-Liste jeden Montag. Leer = an die E-Mail-Empfänger.'],
  ['backupKeep', 'Sicherungen aufbewahren', '30', 'Anzahl täglicher Sicherungen in Drive. Ältere kommen in den Papierkorb.']
];

/** Beschriftungen der erzeugten Dokumente */
const DOC_TEXT = {
  de: {
    title: 'Leistungsnachweis', subtitle: 'Tagesbericht', no: 'Nr.', version: 'Version',
    employee: 'Mitarbeiter', date: 'Datum', project: 'Bauvorhaben', start: 'Arbeitsbeginn',
    end: 'Arbeitsende', pause: 'Pause', worktime: 'Arbeitszeit (ohne Pause)', min: 'Min.', hours: 'Std.',
    activities: 'Ausgeführte Tätigkeiten', description: 'Beschreibung', material: 'Material / Geräte',
    photos: 'Fotos', photo: 'Foto', photoMissing: 'Foto nicht gefunden',
    signatures: 'Unterschriften', sigEmployee: 'Mitarbeiter', sigClient: 'Auftraggeber / Bauleitung',
    noSig: 'nicht unterschrieben', sigMissing: 'Unterschrift nicht gefunden',
    sigForVersion: 'unterschrieben für Version {v}', created: 'erstellt', changed: 'geändert',
    translatedFrom: 'Texte maschinell übersetzt aus {lang} (Google Übersetzer). Das Original liegt als eigenes Dokument bei.',
    originalNote: ''
  },
  ar: {
    title: 'تقرير العمل اليومي', subtitle: 'Leistungsnachweis', no: 'رقم', version: 'النسخة',
    employee: 'العامل', date: 'التاريخ', project: 'المشروع (موقع العمل)', start: 'بداية العمل',
    end: 'نهاية العمل', pause: 'الاستراحة', worktime: 'ساعات العمل (بدون الاستراحة)', min: 'دقيقة', hours: 'ساعة',
    activities: 'الأعمال المنفذة', description: 'الوصف', material: 'المواد / المعدات',
    photos: 'الصور', photo: 'صورة', photoMissing: 'الصورة غير موجودة',
    signatures: 'التواقيع', sigEmployee: 'العامل', sigClient: 'صاحب العمل / مدير الموقع',
    noSig: 'غير موقّع', sigMissing: 'التوقيع غير موجود',
    sigForVersion: 'التوقيع يخص النسخة {v}', created: 'أُنشئ', changed: 'عُدّل',
    translatedFrom: '',
    originalNote: 'هذه هي النسخة الأصلية. الترجمة الألمانية موجودة في مستند منفصل.'
  },
  ku: {
    title: 'Rapora karê rojane', subtitle: 'Leistungsnachweis', no: 'Hejmar', version: 'Guherto',
    employee: 'Karker', date: 'Dîrok', project: 'Proje (cihê kar)', start: 'Destpêka kar',
    end: 'Dawiya kar', pause: 'Bêhnvedan', worktime: 'Dema kar (bê bêhnvedan)', min: 'deq.', hours: 'saet',
    activities: 'Karên hatine kirin', description: 'Danasîn', material: 'Malzeme / amûr',
    photos: 'Wêne', photo: 'Wêne', photoMissing: 'Wêne nehat dîtin',
    signatures: 'Îmze', sigEmployee: 'Karker', sigClient: 'Xwediyê kar / berpirsê cih',
    noSig: 'ne îmzekirî', sigMissing: 'Îmze nehat dîtin',
    sigForVersion: 'îmze ji bo guhertoya {v}', created: 'hat çêkirin', changed: 'hat guhertin',
    translatedFrom: '',
    originalNote: 'Ev guhertoya orîjînal e. Wergera almanî di belgeyeke cuda de ye.'
  }
};

/** Start-Liste der Tätigkeiten (feste Übersetzungen – bitte von Muttersprachlern prüfen lassen) */
const DEFAULT_ACTIVITIES = [
  ['T01', 'Abbrucharbeiten', 'أعمال هدم', 'Karên hilweşandinê'],
  ['T02', 'Erdarbeiten / Aushub', 'أعمال حفر وتراب', 'Karên axê / kolandin'],
  ['T03', 'Mauerarbeiten', 'أعمال بناء (بلوك / طوب)', 'Dîwarçêkirin'],
  ['T04', 'Betonarbeiten', 'صب الباطون', 'Karên betonê'],
  ['T05', 'Schalung', 'أعمال الطوبار', 'Qalib (kalıp)'],
  ['T06', 'Bewehrung / Eisen', 'أعمال التسليح (الحديد)', 'Hesin / armatur'],
  ['T07', 'Putzarbeiten', 'أعمال الزريقة (اللياسة)', 'Sîvaxkirin'],
  ['T08', 'Trockenbau', 'أعمال الجبس بورد', 'Alçîpan'],
  ['T09', 'Estrich', 'صبة أرضية (ستريش)', 'Şapa erdê'],
  ['T10', 'Fliesenarbeiten', 'أعمال التبليط (سيراميك)', 'Seramîk / kaşî'],
  ['T11', 'Malerarbeiten', 'أعمال الدهان', 'Boyaxkirin'],
  ['T12', 'Dämmung', 'أعمال العزل', 'Îzolasyon'],
  ['T13', 'Gerüstbau', 'تركيب السقالات', 'Îskele'],
  ['T14', 'Material transportieren', 'نقل المواد', 'Veguhastina malzemeyan'],
  ['T15', 'Aufräumen / Reinigung', 'تنظيف وترتيب الموقع', 'Paqijkirin'],
  ['T16', 'Entsorgung / Bauschutt', 'ترحيل الأنقاض', 'Avêtina bermayiyan'],
  ['T17', 'Sonstiges', 'أعمال أخرى', 'Karên din']
];

// =====================================================================
//  Web-Schnittstelle
// =====================================================================

/** Aufruf im Browser: zeigt, ob der Server läuft (keine Daten, keine Geheimnisse). */
function doGet() {
  return json_({ ok: true, service: 'leistungsnachweis', version: APP_VERSION, eingerichtet: isSetUp_(), time: Date.now() });
}

function isSetUp_() {
  const props = PropertiesService.getScriptProperties();
  return !!props.getProperty('SPREADSHEET_ID') && !!props.getProperty('TOKEN_SECRET');
}

const ACTIONS = {
  // Ohne Anmeldung aufrufbar (Gerätetest der App): Version, Einrichtungsstand und Serverzeit – sonst nichts.
  ping: function () { return { ok: true, version: APP_VERSION, eingerichtet: isSetUp_(), time: Date.now(), tz: TZ }; },
  health: actionHealth_,
  login: actionLogin_,
  bootstrap: actionBootstrap_,
  submit: actionSubmit_,
  list: actionList_,
  get: actionGet_,
  approve: actionApprove_,
  resend: actionResend_,
  exportXlsx: actionExport_
};

function doPost(e) {
  let req = null;
  try {
    const raw = e && e.postData && e.postData.contents;
    if (!raw || raw.length > 2000000) return json_({ ok: false, error: 'bad_request' });
    try { req = JSON.parse(raw); } catch (parseErr) { return json_({ ok: false, error: 'bad_request' }); }
    if (!req || typeof req !== 'object' || typeof req.action !== 'string') return json_({ ok: false, error: 'bad_request' });
    if (!Object.prototype.hasOwnProperty.call(ACTIONS, req.action)) return json_({ ok: false, error: 'unknown_action' });
    return json_(ACTIONS[req.action](req));
  } catch (err) {
    if (err && err.isApiError) {
      return json_({ ok: false, error: err.code, message: err.message, details: err.details || null });
    }
    logEvent_('FEHLER', 'Anfrage "' + (req && req.action) + '": ' + errText_(err));
    return json_({ ok: false, error: 'server_error', message: 'Interner Fehler. Wird später erneut versucht.' });
  }
}

// =====================================================================
//  Aktionen
// =====================================================================

/**
 * Anmeldung per PIN. Fehlversuche werden unter der Skript-Sperre gezählt und geprüft (eine Einheit):
 * Gleichzeitige Anfragen können die Grenze dadurch nicht umgehen. Die Tabelle wird vor der Sperre gelesen,
 * damit die Sperre nur Millisekunden gehalten wird und Nachweise nicht aufhält.
 */
function actionLogin_(req) {
  const pin = pinInput_(req.pin);
  if (pin.length < PIN_MIN_STAFF || pin.length > PIN_MAX) throw apiError_('wrong_pin', 'PIN falsch'); // zählt nicht als Versuch
  const ctx = ctx_();
  const cache = CacheService.getScriptCache();
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  loginGate_(ctx, cache, today);   // schnelle Vorprüfung ohne Sperre: wehrt Dauerfeuer billig ab
  const staff = staff_(ctx);
  let user = null;
  let duplicate = false;
  let dayCount = 0;
  const lock = takeLock_(10000);
  try {
    loginGate_(ctx, cache, today); // dieselbe Prüfung noch einmal – jetzt exklusiv
    const matches = staff.filter(function (s) { return s.active && s.pinOk && s.pin === pin; });
    if (matches.length === 1) {
      user = matches[0];
    } else {
      duplicate = matches.length > 1;
      cache.put('login_fails', String(Number(cache.get('login_fails') || 0) + 1), LOGIN_LOCK_SECONDS);
      dayCount = loginDayCount_(ctx, today) + 1;
      ctx.props.setProperty('LOGIN_FAILS_DAY', JSON.stringify({ d: today, n: dayCount }));
    }
  } finally {
    dropLock_(lock);
  }
  if (user) return { ok: true, token: makeToken_(user), user: publicUser_(user) };

  if (dayCount === LOGIN_MAX_FAILS_DAY) alertOffice_(ctx, 'Ungewöhnlich viele falsche PIN-Eingaben',
    'Heute gab es ' + LOGIN_MAX_FAILS_DAY + ' falsche PIN-Eingaben. Neue Anmeldungen sind bis morgen gesperrt; ' +
    'bereits angemeldete Handys funktionieren weiter. Falls das niemand aus dem Team war: PINs im Blatt "Mitarbeiter" ändern. ' +
    'Die Sperre beenden: Menü "Leistungsnachweis" → "Anmelde-Sperre aufheben".');
  if (duplicate) {
    logEvent_('WARNUNG', 'Anmeldung abgelehnt: PIN ist mehreren Mitarbeitern zugeordnet.');
    throw apiError_('pin_duplicate', 'PIN mehrfach vergeben – bitte im Büro melden.');
  }
  Utilities.sleep(300); // bremst automatisiertes Durchprobieren
  throw apiError_('wrong_pin', 'PIN falsch');
}

/** Wirft einen Fehler, wenn die Anmeldung gerade gesperrt ist (10-Minuten-Sperre oder Tageslimit). */
function loginGate_(ctx, cache, today) {
  if (Number(cache.get('login_fails') || 0) >= LOGIN_MAX_FAILS) {
    throw apiError_('too_many', 'Zu viele Fehlversuche. Bitte 10 Minuten warten.');
  }
  if (loginDayCount_(ctx, today) >= LOGIN_MAX_FAILS_DAY) {
    throw apiError_('too_many_day', 'Zu viele Fehlversuche heute. Bitte morgen erneut versuchen oder im Büro melden.');
  }
}

function loginDayCount_(ctx, today) {
  const day = parseJson_(ctx.props.getProperty('LOGIN_FAILS_DAY')) || {};
  return day.d === today ? Number(day.n) || 0 : 0;
}

/** Hebt die Anmelde-Sperre auf (Menü). Bereits angemeldete Handys waren nie betroffen. */
function sperreAufheben() {
  const ctx = ctx_();
  const lock = takeLock_(10000);
  try {
    CacheService.getScriptCache().remove('login_fails');
    ctx.props.deleteProperty('LOGIN_FAILS_DAY');
  } finally {
    dropLock_(lock);
  }
  logEvent_('INFO', 'Anmelde-Sperre aufgehoben (Menü).');
  notify_('Die Anmelde-Sperre ist aufgehoben. Mitarbeiter können sich wieder anmelden.');
}

function actionBootstrap_(req) {
  const ctx = ctx_();
  const user = auth_(req, ctx);
  const res = {
    ok: true,
    version: APP_VERSION,
    user: user,
    firma: settings_(ctx).firma,
    projects: projects_(ctx).filter(function (p) { return p.active; })
      .map(function (p) { return { id: p.id, name: p.name, info: p.info }; }),
    activities: activities_(ctx).filter(function (a) { return a.active; })
      .map(function (a) { return { id: a.id, de: a.de, ar: a.ar, ku: a.ku }; })
  };
  if (user.isOffice) {
    res.staff = staff_(ctx).map(function (s) { return { id: s.id, name: s.name, active: s.active }; });
  }
  return res;
}

function actionSubmit_(req) {
  const tStart = Date.now();
  const ctx = ctx_();
  const user = auth_(req, ctx);
  const input = validateReport_(req.report, user);
  const warnings = [];
  let rec = null;
  let changes = [];
  let docsOk = true;
  let tLocked = tStart; let tData = tStart; let tDocs = tStart; // Zeitmessung (Systemcheck)

  let lock;
  try {
    lock = takeLock_();
  } catch (err) {
    if (err && err.code === 'busy') noteBusy_(ctx);
    throw err;
  }
  try {
    tLocked = Date.now();
    const t = reportsTable_(ctx);
    let prev = null;
    if (input.id) {
      prev = findRecord_(t, function (r) { return r.id === input.id; });
      if (!prev || (!user.isOffice && prev.employeeId !== user.id)) throw apiError_('not_found', 'Nachweis nicht gefunden');
      if (prev.lastEditId && prev.lastEditId === input.clientId) return resultOf_(prev, true, []); // Wiederholung derselben Korrektur
      if (!user.isOffice && prev.status === STATUS.APPROVED) throw apiError_('locked', 'Bereits vom Büro freigegeben');
      if (input.baseVersion !== Number(prev.version)) {
        throw apiError_('conflict', 'Der Nachweis wurde inzwischen geändert.', { version: Number(prev.version) });
      }
    } else {
      const dup = findRecord_(t, function (r) { return r.clientId === input.clientId; });
      if (dup) return resultOf_(dup, true, []); // bereits empfangen (z. B. erneuter Versand nach Funkloch)
      if (!user.isOffice) {
        const today = nowText_().slice(0, 10);
        let count = 0;
        t.rows.forEach(function (row) {
          if (str_(row[t.colOf.employeeId]) === user.id && str_(row[t.colOf.createdAt]).slice(0, 10) === today) count++;
        });
        if (count >= MAX_REPORTS_PER_DAY) throw apiError_('limit', 'Tageslimit erreicht – bitte im Büro melden.');
      }
    }

    rec = composeRecord_(ctx, t, input, user, prev, warnings);
    if (prev) {
      changes = diffRecords_(prev, rec).concat(signatureChanges_(input, prev), photoChanges_(input, prev));
      if (!changes.length) return resultOf_(prev, false, ['no_changes']);
    }
    saveSignatures_(ctx, rec, input, prev, warnings);
    savePhotos_(ctx, rec, input, prev, warnings);

    // 1. Zuerst die Daten sichern – Dokumente und E-Mail folgen danach.
    writeRecord_(t, rec, prev);
    if (changes.length) logChanges_(ctx, rec, changes, user.name + (user.isOffice ? ' (Büro)' : ''));
    tData = Date.now();

    // 2. Dokumente erzeugen / aktualisieren
    try {
      renderDocuments_(ctx, rec);
      writeFields_(t, rec, ['docIds', 'docDeUrl', 'docOrigUrl']);
    } catch (err) {
      docsOk = false;
      warnings.push('documents_failed');
      logEvent_('FEHLER', 'Dokumente ' + rec.id + ': ' + errText_(err));
    }
    tDocs = Date.now();
  } finally {
    dropLock_(lock);
  }

  // 3. E-Mail (außerhalb der Sperre, damit andere nicht warten müssen)
  const mailOk = sendReportMail_(ctx, rec, { changes: changes, docsOk: docsOk, attempt: 1 });
  if (!mailOk) warnings.push('mail_failed');
  const tEnd = Date.now();
  recordTiming_(ctx, rec, { wait: tLocked - tStart, data: tData - tLocked, docs: tDocs - tData, mail: tEnd - tDocs, total: tEnd - tStart }, docsOk && mailOk);
  return { ok: true, id: rec.id, version: rec.version, status: rec.status, mailSent: mailOk, warnings: warnings };
}

/**
 * Zeitmessung: Wie lange dauert ein Versand wirklich (Wartezeit auf die Sperre, Daten, Dokumente, E-Mail)?
 * Die letzten TIMINGS_KEEP Werte stehen im Systemcheck. Eine Messung darf nie einen Versand stören.
 */
function recordTiming_(ctx, rec, t, ok) {
  try {
    const list = parseJson_(ctx.props.getProperty('TIMINGS')) || [];
    list.push({ at: Date.now(), id: rec.id, w: t.wait, d: t.data, o: t.docs, m: t.mail, t: t.total, ok: !!ok });
    ctx.props.setProperty('TIMINGS', JSON.stringify(list.slice(-TIMINGS_KEEP)));
    if (t.total > SLOW_SUBMIT_MS || t.wait > SLOW_LOCK_WAIT_MS) {
      logEvent_('WARNUNG', 'Langsamer Versand ' + rec.id + ': ' + timingText_(t));
    }
  } catch (err) {
    console.error('Zeitmessung nicht möglich: ' + err);
  }
}

/** Merkt sich, dass ein Versand wegen belegter Sperre abgewiesen wurde (Systemcheck zeigt die Anzahl der letzten 24 Stunden). */
function noteBusy_(ctx) {
  try {
    const list = (parseJson_(ctx.props.getProperty('BUSY_LOG')) || []).filter(function (x) { return typeof x === 'number'; });
    list.push(Date.now());
    ctx.props.setProperty('BUSY_LOG', JSON.stringify(list.slice(-20)));
  } catch (err) {
    console.error('Busy-Zähler nicht möglich: ' + err);
  }
}

function timingText_(t) {
  const sec = function (ms) { return (Math.round(ms / 100) / 10).toString().replace('.', ',') + ' s'; };
  return 'Wartezeit ' + sec(t.wait) + ' · Daten ' + sec(t.data) + ' · Dokumente ' + sec(t.docs) + ' · E-Mail ' + sec(t.mail) + ' · gesamt ' + sec(t.total);
}

function actionList_(req) {
  const ctx = ctx_();
  const user = auth_(req, ctx);
  const t = reportsTable_(ctx);
  const all = user.isOffice && req.scope === 'all';
  const from = isIsoDate_(req.from) ? req.from : '';
  const to = isIsoDate_(req.to) ? req.to : '';
  const emp = str_(req.employeeId);
  const status = str_(req.status);
  const items = [];
  t.rows.forEach(function (row, i) {
    const r = rowToRecord_(t, row, i);
    if (!r.id) return;
    if (!all && r.employeeId !== user.id) return;
    if (from && r.date < from) return;
    if (to && r.date > to) return;
    if (all && emp && r.employeeId !== emp) return;
    if (all && status && r.status !== status) return;
    items.push(summaryOf_(r, user));
  });
  items.sort(function (a, b) {
    return (b.date + b.start).localeCompare(a.date + a.start) || b.id.localeCompare(a.id);
  });
  const limit = all ? 500 : 60;
  return { ok: true, items: items.slice(0, limit), total: items.length };
}

function actionGet_(req) {
  const ctx = ctx_();
  const user = auth_(req, ctx);
  const t = reportsTable_(ctx);
  const id = str_(req.id);
  const r = findRecord_(t, function (x) { return x.id === id; });
  // Fremde Nachweise: gleiche Antwort wie "nicht vorhanden" (verrät nichts)
  if (!r || (!user.isOffice && r.employeeId !== user.id)) throw apiError_('not_found', 'Nachweis nicht gefunden');
  const sig = parseJson_(r.sigData) || {};
  const out = {
    id: r.id, version: Number(r.version), status: r.status, lang: r.lang,
    date: r.date, start: r.start, end: r.end, pauseMin: Number(r.pauseMin), hours: Number(r.hours),
    projectId: r.projectId, projectOrig: r.projectOrig, projectDe: r.projectDe,
    activityIds: r.activityIds ? r.activityIds.split(',') : [],
    activitiesDe: r.activitiesDe, activitiesOrig: r.activitiesOrig,
    descriptionOrig: r.descriptionOrig, descriptionDe: r.descriptionDe,
    materialOrig: r.materialOrig, materialDe: r.materialDe,
    clientName: r.clientName,
    sigEmployee: sig.employee ? { version: Number(sig.employee.version) } : null,
    sigClient: sig.client ? { version: Number(sig.client.version) } : null,
    // Fotos nur als Kennung: Die App zeigt sie nicht an, sie kann sie aber behalten oder entfernen.
    photos: (parseJson_(r.photoData) || []).map(function (p) { return { id: p.fileId, at: p.at }; }),
    employeeName: r.employeeName, employeeId: r.employeeId,
    createdAt: r.createdAt, updatedAt: r.updatedAt, updatedBy: r.updatedBy,
    locked: r.status === STATUS.APPROVED
  };
  if (user.isOffice) {
    out.mailStatus = r.mailStatus;
    out.docs = { de: r.docDeUrl, orig: r.docOrigUrl };
  }
  return { ok: true, report: out };
}

function actionApprove_(req) {
  const ctx = ctx_();
  const user = auth_(req, ctx);
  requireOffice_(user);
  const id = str_(req.id);
  const approve = req.approve !== false;
  const lock = takeLock_();
  try {
    const t = reportsTable_(ctx);
    const r = findRecord_(t, function (x) { return x.id === id; });
    if (!r) throw apiError_('not_found', 'Nachweis nicht gefunden');
    const next = approve ? STATUS.APPROVED : (Number(r.version) > 1 ? STATUS.CORRECTED : STATUS.SUBMITTED);
    if (r.status !== next) {
      const old = r.status;
      r.status = next;
      writeFields_(t, r, ['status']);
      logChanges_(ctx, r, [{ label: 'Status', old: old, now: next }], user.name + ' (Büro)');
    }
    return { ok: true, id: r.id, status: next };
  } finally {
    dropLock_(lock);
  }
}

function actionResend_(req) {
  const ctx = ctx_();
  const user = auth_(req, ctx);
  requireOffice_(user);
  const id = str_(req.id);
  const rec = ensureDocuments_(ctx, id);
  const ok = sendReportMail_(ctx, rec, { resend: true, docsOk: !!rec.docIds, attempt: 1 });
  return { ok: true, mailSent: ok };
}

function actionExport_(req) {
  const ctx = ctx_();
  const user = auth_(req, ctx);
  requireOffice_(user);
  const from = isIsoDate_(req.from) ? req.from : null;
  const to = isIsoDate_(req.to) ? req.to : null;
  if (!from || !to || from > to) throw apiError_('invalid', 'Zeitraum ungültig', { fields: ['from', 'to'] });
  const res = sendXlsxList_(ctx, from, to, 'Excel-Liste (angefordert von ' + user.name + ')');
  return { ok: true, count: res.count, sentTo: res.to };
}

// =====================================================================
//  Systemcheck (Büro in der App · Menü in der Tabelle)
// =====================================================================

function actionHealth_(req) {
  const ctx = ctx_();
  const user = auth_(req, ctx);
  requireOffice_(user);
  return { ok: true, version: APP_VERSION, generated: nowText_(), checks: healthChecks_(ctx) };
}

/** Prüft PINs der aktiven Benutzer. Liefert die Liste der Probleme (leer = in Ordnung). Dieselbe Prüfung nutzt der Selbsttest. */
function pinProblems_(list) {
  const problems = [];
  const byPin = {};
  list.forEach(function (s) {
    if (!s.pinOk) problems.push(s.name + ': PIN braucht ' + (s.isOffice ? PIN_MIN_OFFICE : PIN_MIN_STAFF) + '–' + PIN_MAX + ' Ziffern');
    else (byPin[s.pin] = byPin[s.pin] || []).push(s.name);
  });
  Object.keys(byPin).forEach(function (p) { if (byPin[p].length > 1) problems.push(byPin[p].join(' und ') + ': gleiche PIN'); });
  if (!list.some(function (s) { return s.isOffice; })) problems.push('kein aktiver Benutzer mit Rolle "Büro"');
  return problems;
}

function dayDiff_(a, b) {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
}

/**
 * Zustand des Systems auf einen Blick. Jede Prüfung steht für sich: Eine fehlgeschlagene Prüfung
 * (z. B. Drive nicht erreichbar) zeigt sich als Zeile "fail", die übrigen laufen weiter.
 * Stufen: ok · info · warn · fail. Enthält nie PINs, Token oder Geheimnisse.
 */
function healthChecks_(ctx) {
  const out = [];
  const add = function (id, label, fn) {
    try {
      const r = fn();
      out.push({ id: id, label: label, level: r.level, detail: r.detail });
    } catch (err) {
      out.push({ id: id, label: label, level: 'fail', detail: trunc_(errText_(err), 300) });
    }
  };
  const res = function (level, detail) { return { level: level, detail: detail }; };
  const now = new Date();
  const today = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  const weekAgo = Utilities.formatDate(new Date(now.getTime() - 7 * 86400000), TZ, 'yyyy-MM-dd HH:mm');
  const sec = function (ms) { return (Math.round(ms / 100) / 10).toString().replace('.', ',') + ' s'; };

  let recs = [];
  let tableError = '';
  try {
    const t = reportsTable_(ctx);
    t.rows.forEach(function (row, i) { const r = rowToRecord_(t, row, i); if (r.id) recs.push(r); });
  } catch (err) {
    recs = [];
    tableError = errText_(err);
  }
  const recent = recs.filter(function (r) { return String(r.updatedAt) >= weekAgo; });
  const triggers = ScriptApp.getProjectTriggers().filter(function (tr) { return tr.getHandlerFunction() === 'wartung'; });

  add('server', 'Server', function () {
    return res('ok', 'Version ' + APP_VERSION + ' · Serverzeit ' + fmtDateTime_(nowText_()) + ' (' + TZ + ')');
  });
  add('sheets', 'Tabellenblätter', function () {
    const missing = Object.keys(SHEET).map(function (k) { return SHEET[k]; }).filter(function (n) { return !ctx.ss.getSheetByName(n); });
    if (missing.length) return res('fail', 'Es fehlt: ' + missing.join(', ') + ' – Menü "Leistungsnachweis" → "1. Einrichten / Prüfen"');
    if (tableError) return res('fail', tableError);
    return res('ok', 'alle ' + Object.keys(SHEET).length + ' Blätter vorhanden');
  });
  add('settings', 'Einstellungen', function () {
    const s = settings_(ctx);
    if (!s.recipients) return res('fail', 'Kein E-Mail-Empfänger im Blatt "Einstellungen" – es wird nichts gemailt');
    const n = pl_(s.recipients.split(',').length, 'E-Mail-Empfänger', 'E-Mail-Empfänger');
    const d = SETTINGS_DEF.filter(function (x) { return x[0] === 'firma'; })[0][2];
    if (s.firma === d) return res('warn', 'Der Firmenname steht noch auf dem Standardwert "' + d + '" (steht oben auf jedem Nachweis) · ' + n);
    return res('ok', 'Firma "' + s.firma + '" · ' + n);
  });
  add('staff', 'Mitarbeiter und PINs', function () {
    const list = staff_(ctx).filter(function (s) { return s.active; });
    if (!list.length) return res('fail', 'Kein aktiver Eintrag im Blatt "Mitarbeiter"');
    const problems = pinProblems_(list);
    if (problems.length) return res('fail', problems.join('; '));
    return res('ok', pl_(list.length, 'aktiver Benutzer', 'aktive Benutzer') + ' (davon ' + list.filter(function (s) { return s.isOffice; }).length + ' Büro), alle PINs in Ordnung');
  });
  add('projects', 'Baustellen', function () {
    const list = projects_(ctx).filter(function (p) { return p.active; });
    if (!list.length) return res('warn', 'Keine aktive Baustelle im Blatt "Bauvorhaben" – Mitarbeiter müssten jedes Mal "Anderes Bauvorhaben" eintippen');
    if (list.some(function (p) { return /Beispiel-Baustelle/.test(p.name); })) return res('warn', 'Die Beispiel-Baustelle ist noch aktiv – bitte durch echte Baustellen ersetzen (' + list.length + ' aktiv)');
    return res('ok', pl_(list.length, 'aktive Baustelle', 'aktive Baustellen'));
  });
  add('login', 'Anmelde-Sperre', function () {
    const fails = Number(CacheService.getScriptCache().get('login_fails') || 0);
    const day = loginDayCount_(ctx, today);
    const state = fails + ' Fehlversuche in den letzten 10 Min., heute ' + day + ' von ' + LOGIN_MAX_FAILS_DAY;
    if (fails >= LOGIN_MAX_FAILS || day >= LOGIN_MAX_FAILS_DAY) return res('fail', 'Neue Anmeldungen sind GESPERRT (' + state + ') – Menü "Anmelde-Sperre aufheben"');
    return res(day >= 10 ? 'warn' : 'ok', 'frei (' + state + ')');
  });
  add('automatik', 'Automatik', function () {
    if (!triggers.length) return res('fail', 'NICHT eingeschaltet – ohne sie gibt es keine tägliche Sicherung, keine Wochenliste und keinen E-Mail-Nachversand. Menü "3. Automatik einschalten"');
    if (triggers.length > 1) return res('warn', triggers.length + ' gleiche Auslöser – Menü "3. Automatik einschalten" räumt auf');
    return res('ok', 'eingeschaltet (stündlich)');
  });
  add('backup', 'Sicherung (täglich, Excel in Drive)', function () {
    const names = [];
    const it = folder_(ctx, 'BACKUP_FOLDER_ID', 'Sicherungen').getFiles();
    while (it.hasNext()) { const n = it.next().getName(); if (/^Sicherung_.*\.xlsx$/.test(n)) names.push(n); }
    names.sort().reverse();
    if (!names.length) {
      return triggers.length
        ? res('warn', 'Noch keine Sicherung im Ordner "Sicherungen". Die erste kommt in der nächsten Nacht (ab 1 Uhr) – oder Menü "Sicherung jetzt erstellen".')
        : res('fail', 'Keine Sicherung vorhanden und die Automatik ist aus – Menü "Sicherung jetzt erstellen" und "3. Automatik einschalten"');
    }
    const m = /^Sicherung_(\d{4}-\d{2}-\d{2})/.exec(names[0]);
    const age = m ? dayDiff_(m[1], today) : 99;
    const text = pl_(names.length, 'Sicherung', 'Sicherungen') + ', neueste vom ' + (m ? fmtDate_(m[1]) : names[0]);
    if (age > 2) return res('fail', text + ' (vor ' + age + ' Tagen) – bitte Blatt "Protokoll" prüfen und "Sicherung jetzt erstellen"');
    return res('ok', text);
  });
  add('weekly', 'Wochenliste (montags per E-Mail)', function () {
    const last = ctx.props.getProperty('LAST_WEEKLY');
    return res('info', last ? 'zuletzt gesendet am ' + fmtDate_(last) : 'noch nicht gesendet (kommt montags ab 6 Uhr)');
  });
  add('mail', 'E-Mail', function () {
    const quota = MailApp.getRemainingDailyQuota();
    const stuckBefore = Utilities.formatDate(new Date(now.getTime() - MAIL_STUCK_MINUTES * 60000), TZ, 'yyyy-MM-dd HH:mm');
    const failed = recent.filter(function (r) { return /^FEHLER/.test(r.mailStatus || ''); });
    const stuck = recent.filter(function (r) { return /^wird gesendet/.test(r.mailStatus || '') && String(r.updatedAt) < stuckBefore; });
    const parts = ['heute noch ' + pl_(quota, 'E-Mail', 'E-Mails') + ' frei'];
    let level = quota <= 0 ? 'fail' : (quota < 20 ? 'warn' : 'ok');
    if (failed.length) { level = 'fail'; parts.push(failed.length + ' Nachweis(e) mit E-Mail-Fehler (' + failed.slice(0, 5).map(function (r) { return r.id; }).join(', ') + ') – in der App unter Büro → Nachweis → "E-Mail erneut senden"'); }
    if (stuck.length) { if (level === 'ok') level = 'warn'; parts.push(stuck.length + ' stecken beim Senden fest und werden stündlich nachgeholt'); }
    return res(level, parts.join(' · '));
  });
  add('documents', 'Word-/PDF-Dokumente', function () {
    const missing = recent.filter(function (r) { return !(parseJson_(r.docIds) || {}).de; });
    if (missing.length) return res('warn', missing.length + ' Nachweis(e) der letzten 7 Tage ohne Dokumente (' + missing.slice(0, 5).map(function (r) { return r.id; }).join(', ') + ') – "E-Mail erneut senden" erzeugt sie nach');
    if (!recent.length) return res('ok', 'keine Nachweise in den letzten 7 Tagen');
    return res('ok', recent.length === 1 ? 'der Nachweis der letzten 7 Tage hat Dokumente' : 'alle ' + recent.length + ' Nachweise der letzten 7 Tage haben Dokumente');
  });
  add('translation', 'Übersetzung', function () {
    const bad = recent.filter(function (r) {
      return [r.descriptionDe, r.materialDe, r.projectDe].some(function (x) { return String(x || '').indexOf(TRANSLATION_FAILED_MARK) === 0; });
    });
    if (bad.length) return res('warn', bad.length + ' Nachweis(e) mit fehlgeschlagener Übersetzung (' + bad.slice(0, 5).map(function (r) { return r.id; }).join(', ') + ') – bitte den deutschen Text im Büro-Bereich von Hand eintragen');
    const foreign = recent.filter(function (r) { return r.lang !== 'de'; }).length;
    return res('ok', pl_(foreign, 'fremdsprachiger Nachweis', 'fremdsprachige Nachweise') + ' der letzten 7 Tage, keine fehlgeschlagene Übersetzung');
  });
  add('timing', 'Geschwindigkeit des Versands', function () {
    const list = (parseJson_(ctx.props.getProperty('TIMINGS')) || []).filter(function (x) { return x && typeof x.t === 'number'; });
    const busy = (parseJson_(ctx.props.getProperty('BUSY_LOG')) || []).filter(function (x) { return typeof x === 'number' && x > Date.now() - 86400000; }).length;
    if (!list.length) return res('info', 'Noch keine Messwerte – sie entstehen mit dem ersten gesendeten Nachweis.' + (busy ? ' · ' + busy + ' Mal "Server beschäftigt" in 24 Std.' : ''));
    const med = function (key) { const a = list.map(function (x) { return Number(x[key]) || 0; }).sort(function (x, y) { return x - y; }); return a[Math.floor(a.length / 2)]; };
    const max = function (key) { return Math.max.apply(null, list.map(function (x) { return Number(x[key]) || 0; })); };
    const detail = pl_(list.length, 'Messung', 'Messungen') + ' · Dauer typisch ' + sec(med('t')) + ', längste ' + sec(max('t')) +
      ' (Dokumente typisch ' + sec(med('o')) + ') · längste Wartezeit auf andere Nachweise ' + sec(max('w')) +
      (busy ? ' · ' + busy + ' Mal "Server beschäftigt" in 24 Std.' : '');
    return res(max('w') > SLOW_LOCK_WAIT_MS || med('t') > 45000 || busy >= 3 ? 'warn' : 'ok', detail);
  });
  add('data', 'Nachweise', function () {
    const todayCount = recs.filter(function (r) { return String(r.createdAt).slice(0, 10) === today; }).length;
    return res('info', recs.length + ' gespeichert · heute ' + todayCount + ' neu · in den letzten 7 Tagen geändert: ' + recent.length);
  });
  add('storage', 'Speicherplatz in Google Drive', function () {
    const used = DriveApp.getStorageUsed();
    const limit = DriveApp.getStorageLimit();
    const gb = function (b) { return (Math.round(b / 1e8) / 10).toString().replace('.', ',') + ' GB'; };
    if (!limit) return res('info', gb(used) + ' belegt');
    const pct = Math.round(used / limit * 100);
    const text = gb(used) + ' von ' + gb(limit) + ' belegt (' + pct + ' %)';
    if (pct >= 95) return res('fail', text + ' – bei vollem Speicher stoppen Sicherung und Dokumente');
    return res(pct >= 80 ? 'warn' : 'ok', text);
  });
  add('log', 'Protokoll (Fehler und Warnungen)', function () {
    const sh = ctx.ss.getSheetByName(SHEET.LOG);
    const last = sh ? sh.getLastRow() : 0;
    if (last < 2) return res('ok', 'leer');
    const n = Math.min(300, last - 1);
    const rows = sh.getRange(last - n + 1, 1, n, 3).getValues().map(function (r) {
      return { at: cellIn_(r[0], 'at', 't'), level: str_(r[1]), msg: str_(r[2]) };
    }).filter(function (r) { return r.at >= weekAgo; });
    const errors = rows.filter(function (r) { return r.level === 'FEHLER'; });
    const warns = rows.filter(function (r) { return r.level === 'WARNUNG'; });
    const lastProblem = rows.filter(function (r) { return r.level === 'FEHLER' || r.level === 'WARNUNG'; }).pop();
    const text = errors.length + ' Fehler und ' + pl_(warns.length, 'Warnung', 'Warnungen') + ' in den letzten 7 Tagen' +
      (lastProblem ? ' · zuletzt (' + fmtDateTime_(lastProblem.at) + '): ' + trunc_(lastProblem.msg, 160) : '');
    return res(errors.length ? 'warn' : 'ok', text);
  });
  return out;
}

/** Menüpunkt in der Tabelle: dieselben Prüfungen wie der Systemcheck in der App. */
function systemcheck() {
  const ctx = ctx_();
  const icon = { ok: '✔', info: 'ℹ', warn: '⚠', fail: '✘' };
  const lines = healthChecks_(ctx).map(function (c) { return icon[c.level] + ' ' + c.label + ': ' + c.detail; });
  const msg = 'Systemcheck ' + nowText_() + '\n\n' + lines.join('\n\n');
  notify_(msg);
  return msg;
}

// =====================================================================
//  Anmeldung / Token
// =====================================================================

function makeToken_(s) {
  const payload = b64url_(JSON.stringify({ e: s.id, t: Date.now(), p: pinTag_(s.pin) }));
  return payload + '.' + sign_(payload);
}

function auth_(req, ctx) {
  const token = String((req && req.token) || '');
  const parts = token.split('.');
  const fail = function () { return apiError_('auth', 'Bitte neu anmelden'); };
  if (parts.length !== 2 || !parts[0] || !parts[1] || token.length > 1000) throw fail();
  if (!safeEqual_(sign_(parts[0]), parts[1])) throw fail();
  let p;
  try { p = JSON.parse(fromB64url_(parts[0])); } catch (e) { throw fail(); }
  if (!p || typeof p.e !== 'string' || typeof p.t !== 'number') throw fail();
  const now = Date.now();
  if (now - p.t > TOKEN_MAX_AGE_MS || p.t > now + 300000) throw fail();
  const s = staff_(ctx).filter(function (x) { return x.id === p.e; })[0];
  if (!s || !s.active || pinTag_(s.pin) !== p.p) throw fail(); // PIN geändert oder deaktiviert → abgemeldet
  return publicUser_(s);
}

function publicUser_(s) {
  return { id: s.id, name: s.name, role: s.isOffice ? 'office' : 'staff', isOffice: s.isOffice, lang: s.lang };
}

function requireOffice_(user) {
  if (!user.isOffice) throw apiError_('forbidden', 'Nur für das Büro');
}

function secret_() {
  const s = PropertiesService.getScriptProperties().getProperty('TOKEN_SECRET');
  if (!s) throw apiError_('not_setup', 'Server nicht eingerichtet');
  return s;
}

function sign_(data) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(data, secret_())).replace(/=+$/, '');
}

function pinTag_(pin) {
  return sign_('pin:' + pin).slice(0, 16);
}

function b64url_(text) {
  return Utilities.base64EncodeWebSafe(Utilities.newBlob(text).getBytes()).replace(/=+$/, '');
}

function fromB64url_(s) {
  const pad = s.length % 4 ? '===='.slice(s.length % 4) : '';
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(s + pad)).getDataAsString('UTF-8');
}

/** Vergleich in konstanter Zeit (Signaturlänge ist fest und nicht geheim) */
function safeEqual_(a, b) {
  a = String(a);
  b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// =====================================================================
//  Prüfung der Eingaben
// =====================================================================

function validateReport_(r, user) {
  if (!r || typeof r !== 'object') throw apiError_('invalid', 'Bitte Eingaben prüfen', { fields: ['report'] });
  const bad = [];
  const out = {};
  out.clientId = str_(r.clientId);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(out.clientId)) bad.push('clientId');
  out.id = r.id ? str_(r.id) : '';
  if (out.id && !/^\d{4}-\d{4,6}$/.test(out.id)) bad.push('id');
  out.baseVersion = r.baseVersion == null ? null : Number(r.baseVersion);
  out.lang = LANGS.indexOf(r.lang) >= 0 ? r.lang : '';
  if (!out.lang) bad.push('lang');
  out.date = str_(r.date);
  if (!isIsoDate_(out.date) || out.date < '2020-01-01' || out.date > isoDateOffset_(2)) bad.push('date');
  out.start = str_(r.start);
  out.end = str_(r.end);
  if (!isTime_(out.start)) bad.push('start');
  if (!isTime_(out.end)) bad.push('end');
  out.pauseMin = Number(r.pauseMin);
  if (!(Number.isInteger(out.pauseMin) && out.pauseMin >= 0 && out.pauseMin <= 600)) bad.push('pause');
  if (bad.indexOf('start') < 0 && bad.indexOf('end') < 0 && bad.indexOf('pause') < 0) {
    if (toMin_(out.end) <= toMin_(out.start)) bad.push('end');
    else {
      const net = toMin_(out.end) - toMin_(out.start) - out.pauseMin;
      if (net <= 0) bad.push('pause');
    }
  }
  out.projectId = str_(r.projectId);
  out.projectText = cleanText_(r.projectText);
  if (out.projectText.length > 200) bad.push('project');
  if (!out.projectId && !out.projectText) bad.push('project');
  out.activityIds = Array.isArray(r.activityIds)
    ? r.activityIds.slice(0, 40).map(str_).filter(function (x) { return /^[A-Za-z0-9_-]{1,20}$/.test(x); })
    : [];
  out.description = cleanText_(r.description);
  if (out.description.length > 4000) bad.push('description');
  out.material = cleanText_(r.material);
  if (out.material.length > 2000) bad.push('material');
  if (!out.description && !out.activityIds.length) bad.push('description');
  out.clientName = cleanText_(r.clientName).replace(/\n/g, ' ');
  if (out.clientName.length > 100) bad.push('clientName');
  out.sigEmployee = signatureInput_(r.sigEmployee, bad, 'sigEmployee');
  out.sigClient = signatureInput_(r.sigClient, bad, 'sigClient');
  out.photos = photosInput_(r.photos, bad);
  if (!out.id) {
    if (out.sigEmployee === 'keep') out.sigEmployee = null;
    if (out.sigClient === 'keep') out.sigClient = null;
  } else if (out.baseVersion === null || !Number.isInteger(out.baseVersion)) {
    bad.push('baseVersion');
  }
  // Nur das Büro darf die deutsche Übersetzung von Hand korrigieren
  out.descriptionDe = user.isOffice && typeof r.descriptionDe === 'string' ? cleanText_(r.descriptionDe) : null;
  out.materialDe = user.isOffice && typeof r.materialDe === 'string' ? cleanText_(r.materialDe) : null;
  out.projectDe = user.isOffice && typeof r.projectDe === 'string' ? cleanText_(r.projectDe) : null;
  if ((out.descriptionDe || '').length > 6000 || (out.materialDe || '').length > 3000 || (out.projectDe || '').length > 300) {
    bad.push('translation');
  }
  if (bad.length) throw apiError_('invalid', 'Bitte Eingaben prüfen', { fields: bad });
  return out;
}

function signatureInput_(v, bad, field) {
  if (v === null || v === undefined || v === '') return null;
  if (v === 'keep') return 'keep';
  if (typeof v === 'string' && v.length <= 400000 && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(v)) return v;
  bad.push(field);
  return null;
}

/**
 * Fotos aus der App: je Eintrag entweder ein neues Bild (data:image/jpeg;base64,…)
 * oder die Datei-Kennung eines Fotos, das schon gespeichert ist (bleibt erhalten).
 * Alles andere wird abgelehnt; mehr als PHOTO_MAX Fotos ebenfalls.
 */
function photosInput_(v, bad) {
  if (v === undefined) return null;            // Feld fehlt (ältere App-Version) → vorhandene Fotos unverändert lassen
  if (v === null || v === '') return [];
  if (!Array.isArray(v)) { bad.push('photos'); return []; }
  if (v.length > PHOTO_MAX) { bad.push('photos'); return []; }
  const out = [];
  for (let i = 0; i < v.length; i++) {
    const p = v[i];
    if (typeof p !== 'string' || !p) { bad.push('photos'); return []; }
    if (p.slice(0, 11) === 'data:image/') {
      if (p.length > PHOTO_MAX_CHARS || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(p)) { bad.push('photos'); return []; }
      out.push({ data: p });
    } else if (/^[A-Za-z0-9_-]{10,100}$/.test(p)) {
      out.push({ keep: p });
    } else {
      bad.push('photos');
      return [];
    }
  }
  return out;
}

// =====================================================================
//  Datensatz zusammenstellen
// =====================================================================

function composeRecord_(ctx, t, input, user, prev, warnings) {
  const now = nowText_();
  const lang = prev ? (prev.lang || 'de') : input.lang;
  const acts = activities_(ctx);
  const actById = {};
  acts.forEach(function (a) { actById[a.id] = a; });
  const activityIds = input.activityIds.filter(function (id, i, arr) { return actById[id] && arr.indexOf(id) === i; });
  // Unbekannte Tätigkeits-IDs fallen weg – ohne Beschreibung bliebe dann ein leerer Nachweis
  if (!activityIds.length && !input.description) throw apiError_('invalid', 'Bitte Eingaben prüfen', { fields: ['description'] });

  const rec = {
    id: prev ? prev.id : nextId_(ctx, t),
    version: prev ? Number(prev.version) + 1 : 1,
    status: prev ? (user.isOffice ? (prev.status || STATUS.SUBMITTED) : STATUS.CORRECTED) : STATUS.SUBMITTED,
    lang: lang,
    employeeId: prev ? prev.employeeId : user.id,
    employeeName: prev ? prev.employeeName : user.name,
    date: input.date,
    start: input.start,
    end: input.end,
    pauseMin: input.pauseMin,
    hours: Math.round((toMin_(input.end) - toMin_(input.start) - input.pauseMin) / 60 * 100) / 100,
    activityIds: activityIds.join(','),
    activitiesDe: activityIds.map(function (id) { return actById[id].de; }).join('; '),
    activitiesOrig: activityIds.map(function (id) { return activityLabel_(actById[id], lang); }).join('; '),
    clientName: input.clientName,
    clientId: prev ? prev.clientId : input.clientId,
    lastEditId: prev ? input.clientId : '',
    createdAt: prev ? prev.createdAt : now,
    updatedAt: now,
    updatedBy: user.name + (user.isOffice ? ' (Büro)' : ''),
    docIds: prev ? prev.docIds : '',
    docDeUrl: prev ? prev.docDeUrl : '',
    docOrigUrl: prev ? prev.docOrigUrl : '',
    sigData: prev ? prev.sigData : '',
    sigEmployeeInfo: prev ? prev.sigEmployeeInfo : 'nein',
    sigClientInfo: prev ? prev.sigClientInfo : 'nein',
    photoData: prev ? prev.photoData : '',
    photoCount: prev ? Number(prev.photoCount) || 0 : 0,
    mailStatus: 'wird gesendet …'
  };

  if (input.projectId) {
    const p = projects_(ctx).filter(function (x) { return x.id === input.projectId; })[0];
    if (!p) throw apiError_('invalid', 'Bauvorhaben unbekannt', { fields: ['project'] });
    rec.projectId = p.id;
    rec.projectOrig = p.name;
    rec.projectDe = p.name;
  } else {
    rec.projectId = '';
    rec.projectOrig = input.projectText;
    rec.projectDe = pickTranslation_(input.projectText, prev && !prev.projectId ? prev.projectOrig : null,
      prev && !prev.projectId ? prev.projectDe : null, input.projectDe, lang, user, '', warnings, 'project');
  }
  rec.descriptionOrig = input.description;
  rec.descriptionDe = pickTranslation_(input.description, prev ? prev.descriptionOrig : null,
    prev ? prev.descriptionDe : null, input.descriptionDe, lang, user, lang, warnings, 'description');
  rec.materialOrig = input.material;
  rec.materialDe = pickTranslation_(input.material, prev ? prev.materialOrig : null,
    prev ? prev.materialDe : null, input.materialDe, lang, user, lang, warnings, 'material');
  return rec;
}

/**
 * Entscheidet, woher der deutsche Text kommt:
 *  - Deutsch geschrieben → unverändert
 *  - Büro hat die Übersetzung von Hand geändert → diese übernehmen
 *  - Original unverändert → bisherige Übersetzung behalten (außer sie war ein Übersetzungs-Fehler → neu versuchen)
 *  - sonst → automatisch übersetzen
 */
function pickTranslation_(orig, prevOrig, prevDe, officeDe, lang, user, srcLang, warnings, field) {
  const officeChanged = user.isOffice && officeDe !== null && officeDe !== undefined && officeDe !== '' && officeDe !== (prevDe || '');
  if (lang === 'de') return orig;
  if (officeChanged) return officeDe; // Büro darf auch ergänzen, wenn das Original leer ist
  if (!orig) return '';
  const prevFailed = !!prevDe && String(prevDe).indexOf(TRANSLATION_FAILED_MARK) === 0;
  if (prevOrig !== null && prevOrig !== undefined && orig === prevOrig && prevDe && !prevFailed) return prevDe;
  const res = translateSafe_(orig, srcLang, 'de');
  if (res.failed) warnings.push('translation_failed:' + field);
  return res.text;
}

function translateSafe_(text, from, to) {
  try {
    return { text: translate_(text, from, to), failed: false };
  } catch (err) {
    logEvent_('WARNUNG', 'Übersetzung fehlgeschlagen: ' + errText_(err));
    return { text: TRANSLATION_FAILED_MARK + ' – bitte prüfen. Original: ' + text, failed: true };
  }
}

/** Übersetzt mit Google Übersetzer (kostenlos in Apps Script). Zeilenumbrüche bleiben erhalten. */
function translate_(text, from, to) {
  text = String(text || '').trim();
  if (!text || from === to) return text;
  const html = escHtml_(text).replace(/\r?\n/g, '<br>');
  let out;
  try {
    out = LanguageApp.translate(html, from || '', to, { contentType: 'html' });
  } catch (err) {
    if (!from) throw err;
    out = LanguageApp.translate(html, '', to, { contentType: 'html' }); // Sprache automatisch erkennen
  }
  out = String(out || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '');
  return decodeEntities_(out).replace(/[ \t]+\n/g, '\n').trim();
}

function activityLabel_(a, lang) {
  return (lang === 'ar' && a.ar) || (lang === 'ku' && a.ku) || a.de;
}

function diffRecords_(prev, rec) {
  const out = [];
  DIFF_FIELDS.forEach(function (f) {
    const a = prev[f[0]] == null ? '' : String(prev[f[0]]);
    const b = rec[f[0]] == null ? '' : String(rec[f[0]]);
    if (a !== b) out.push({ label: f[1], old: a, now: b });
  });
  return out;
}

function signatureChanges_(input, prev) {
  const data = parseJson_(prev && prev.sigData) || {};
  const out = [];
  [['employee', input.sigEmployee, 'Unterschrift Mitarbeiter'], ['client', input.sigClient, 'Unterschrift Auftraggeber']]
    .forEach(function (x) {
      const had = data[x[0]] ? 'vorhanden (Version ' + data[x[0]].version + ')' : 'keine';
      if (x[1] && x[1] !== 'keep') out.push({ label: x[2], old: had, now: 'neu unterschrieben' });
      else if (!x[1] && data[x[0]]) out.push({ label: x[2], old: had, now: 'entfernt' });
    });
  return out;
}

function saveSignatures_(ctx, rec, input, prev, warnings) {
  const data = parseJson_(prev && prev.sigData) || {};
  [['employee', input.sigEmployee, 'mitarbeiter'], ['client', input.sigClient, 'auftraggeber']].forEach(function (x) {
    const kind = x[0];
    const v = x[1];
    if (v === 'keep') return;                 // unverändert lassen
    if (!v) { delete data[kind]; return; }    // keine / entfernt
    try {
      const bytes = Utilities.base64Decode(v.split(',')[1]);
      // PNG-Signatur prüfen (89 50 4E 47) – nur echte Bilder werden gespeichert
      if (bytes.length < 8 || (bytes[0] & 0xff) !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
        throw new Error('kein PNG');
      }
      const blob = Utilities.newBlob(bytes, 'image/png', rec.id + '_' + x[2] + '_v' + rec.version + '.png');
      const file = folder_(ctx, 'SIG_FOLDER_ID', 'Unterschriften').createFile(blob);
      data[kind] = { fileId: file.getId(), version: rec.version, at: nowText_() };
    } catch (err) {
      warnings.push('signature_failed:' + kind);
      logEvent_('FEHLER', 'Unterschrift ' + rec.id + ': ' + errText_(err));
    }
  });
  rec.sigData = Object.keys(data).length ? JSON.stringify(data) : '';
  rec.sigEmployeeInfo = data.employee ? 'ja (Version ' + data.employee.version + ')' : 'nein';
  rec.sigClientInfo = data.client ? 'ja (Version ' + data.client.version + ')' : 'nein';
}

/**
 * Fotos für das Blatt "Änderungen" und die Korrektur-E-Mail.
 * Zählt auch den Tausch: ein Foto raus, ein anderes rein ergibt zwar wieder zwei,
 * ist aber eine Änderung – sonst würde die Korrektur als "nichts geändert" abgewiesen.
 */
function photoChanges_(input, prev) {
  if (input.photos === null) return [];
  const had = (parseJson_(prev && prev.photoData) || []).map(function (p) { return p.fileId; });
  const keep = input.photos.filter(function (p) { return p.keep; }).map(function (p) { return p.keep; });
  const added = input.photos.filter(function (p) { return p.data; }).length;
  const removed = had.filter(function (id) { return keep.indexOf(id) < 0; }).length;
  if (!added && !removed) return [];
  const note = [];
  if (added) note.push(added + ' neu');
  if (removed) note.push(removed + ' entfernt');
  return [{ label: 'Fotos', old: String(had.length), now: (keep.length + added) + ' (' + note.join(', ') + ')' }];
}

/**
 * Speichert neue Fotos in Drive (Ordner "Fotos") und behält die, die der Nachweis schon hat.
 * Die Bilder stehen nur im Word-/PDF-Dokument, nicht in der Excel-Liste (EXPORT_COLS).
 * Ein Foto, das sich nicht speichern lässt, hält den Nachweis nicht auf: Warnung + Protokoll.
 */
function savePhotos_(ctx, rec, input, prev, warnings) {
  if (input.photos === null) return;           // Feld fehlt → rec hat die Fotos von prev schon übernommen
  const had = parseJson_(prev && prev.photoData) || [];
  const byId = {};
  had.forEach(function (p) { if (p && p.fileId) byId[p.fileId] = p; });
  const out = [];
  input.photos.forEach(function (p, i) {
    if (p.keep) {
      if (byId[p.keep]) out.push(byId[p.keep]);       // unbekannte Kennung wird stillschweigend verworfen
      return;
    }
    try {
      const bytes = Utilities.base64Decode(p.data.split(',')[1]);
      // JPEG prüfen (FF D8 FF) – nur echte Bilder werden gespeichert
      if (bytes.length < 8 || (bytes[0] & 0xff) !== 0xff || (bytes[1] & 0xff) !== 0xd8 || (bytes[2] & 0xff) !== 0xff) {
        throw new Error('kein JPEG');
      }
      const name = rec.id + '_foto' + (i + 1) + '_v' + rec.version + '.jpg';
      const file = folder_(ctx, 'PHOTO_FOLDER_ID', 'Fotos').createFile(Utilities.newBlob(bytes, 'image/jpeg', name));
      out.push({ fileId: file.getId(), version: rec.version, at: nowText_() });
    } catch (err) {
      warnings.push('photo_failed');
      logEvent_('FEHLER', 'Foto ' + rec.id + ': ' + errText_(err));
    }
  });
  rec.photoData = out.length ? JSON.stringify(out) : '';
  rec.photoCount = out.length;
}

function nextId_(ctx, t) {
  const year = Utilities.formatDate(new Date(), TZ, 'yyyy');
  const key = 'COUNTER_' + year;
  let n = Number(ctx.props.getProperty(key) || 0);
  // Sicherheitsnetz: nie eine Nummer vergeben, die es in der Tabelle schon gibt
  t.rows.forEach(function (row) {
    const m = /^(\d{4})-(\d+)$/.exec(str_(row[t.colOf.id]));
    if (m && m[1] === year) n = Math.max(n, Number(m[2]));
  });
  n += 1;
  ctx.props.setProperty(key, String(n));
  let s = String(n);
  while (s.length < 4) s = '0' + s;
  return year + '-' + s;
}

function resultOf_(r, duplicate, warnings) {
  return {
    ok: true, id: r.id, version: Number(r.version), status: r.status,
    mailSent: /^gesendet/.test(r.mailStatus || ''), duplicate: duplicate, warnings: warnings
  };
}

function summaryOf_(r, user) {
  const s = {
    id: r.id, date: r.date, start: r.start, end: r.end, pauseMin: Number(r.pauseMin), hours: Number(r.hours),
    status: r.status, version: Number(r.version), employeeId: r.employeeId, employeeName: r.employeeName,
    project: user.isOffice ? r.projectDe : r.projectOrig, lang: r.lang
  };
  if (user.isOffice) s.mailStatus = r.mailStatus;
  return s;
}

// =====================================================================
//  Tabelle lesen / schreiben
// =====================================================================

function ctx_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SPREADSHEET_ID');
  if (!id) throw apiError_('not_setup', 'Server nicht eingerichtet – Funktion "einrichten" ausführen.');
  return { props: props, ss: SpreadsheetApp.openById(id) };
}

function sheet_(ctx, name) {
  const sh = ctx.ss.getSheetByName(name);
  if (!sh) throw apiError_('not_setup', 'Tabellenblatt fehlt: ' + name + ' – Funktion "einrichten" ausführen.');
  return sh;
}

function reportsTable_(ctx) {
  const sh = sheet_(ctx, SHEET.REPORTS);
  let lastCol = sh.getLastColumn();
  let headers = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(str_) : [];
  // Selbstheilung: fehlende Spalten hinten wieder anfügen
  const missing = REPORT_COLS.filter(function (c) { return headers.indexOf(c[1]) < 0; });
  if (missing.length) {
    ensureCols_(sh, lastCol + missing.length);
    sh.getRange(1, lastCol + 1, 1, missing.length).setValues([missing.map(function (c) { return c[1]; })]);
    lastCol += missing.length;
    headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(str_);
  }
  const colOf = {};
  REPORT_COLS.forEach(function (c) { colOf[c[0]] = headers.indexOf(c[1]); });
  const lastRow = sh.getLastRow();
  const rows = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
  return { sh: sh, headers: headers, colOf: colOf, rows: rows };
}

function findRecord_(t, pred) {
  for (let i = 0; i < t.rows.length; i++) {
    const r = rowToRecord_(t, t.rows[i], i);
    if (r.id && pred(r)) return r;
  }
  return null;
}

function rowToRecord_(t, row, idx) {
  const r = { _row: idx + 2 };
  REPORT_COLS.forEach(function (c) {
    const i = t.colOf[c[0]];
    r[c[0]] = cellIn_(i >= 0 ? row[i] : '', c[0], c[2]);
  });
  return r;
}

function cellIn_(v, key, type) {
  if (v instanceof Date) {
    if (key === 'date') return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
    if (key === 'start' || key === 'end') return Utilities.formatDate(v, TZ, 'HH:mm');
    return Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm');
  }
  if (type === 'n' || type === 'h') {
    const n = Number(v);
    return isFinite(n) ? n : 0;
  }
  let s = v == null ? '' : String(v);
  if (/^'[=+\-@\t\r]/.test(s)) s = s.slice(1); // Schutz-Apostroph entfernen
  return s;
}

function cellOut_(v, type) {
  if (type === 'n' || type === 'h') {
    const n = Number(v);
    return v === '' || v == null || !isFinite(n) ? '' : n;
  }
  return safeCell_(v == null ? '' : String(v));
}

/** Verhindert, dass Text als Formel ausgeführt wird (Formel-Injection) */
function safeCell_(s) {
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function formatOf_(type) {
  return type === 'h' ? '0.00' : (type === 'n' ? '0' : '@');
}

function writeRecord_(t, rec, prev) {
  const width = t.headers.length;
  const rowNum = prev ? prev._row : t.sh.getLastRow() + 1;
  if (rowNum > t.sh.getMaxRows()) t.sh.insertRowsAfter(t.sh.getMaxRows(), 200);
  const range = t.sh.getRange(rowNum, 1, 1, width);
  const values = prev ? t.rows[prev._row - 2].slice() : new Array(width).fill('');
  const formats = range.getNumberFormats()[0];
  REPORT_COLS.forEach(function (c) {
    const i = t.colOf[c[0]];
    if (i < 0 || !Object.prototype.hasOwnProperty.call(rec, c[0])) return;
    values[i] = cellOut_(rec[c[0]], c[2]);
    formats[i] = formatOf_(c[2]);
  });
  range.setNumberFormats([formats]);
  range.setValues([values]);
  rec._row = rowNum;
  if (prev) t.rows[prev._row - 2] = values; else t.rows.push(values);
}

/** Schreibt einzelne Felder eines bereits gespeicherten Datensatzes */
function writeFields_(t, rec, keys) {
  if (!rec._row || str_(t.sh.getRange(rec._row, t.colOf.id + 1).getValue()) !== rec.id) {
    const found = findRecord_(t, function (r) { return r.id === rec.id; });
    if (!found) return;
    rec._row = found._row;
  }
  keys.forEach(function (k) {
    const c = REPORT_COLS.filter(function (x) { return x[0] === k; })[0];
    const i = t.colOf[k];
    if (!c || i < 0) return;
    const cell = t.sh.getRange(rec._row, i + 1);
    cell.setNumberFormat(formatOf_(c[2]));
    cell.setValue(cellOut_(rec[k], c[2]));
  });
}

function setMailStatus_(ctx, rec, text) {
  try {
    const t = reportsTable_(ctx);
    rec.mailStatus = text;
    writeFields_(t, rec, ['mailStatus']);
  } catch (err) {
    logEvent_('FEHLER', 'E-Mail-Status ' + rec.id + ': ' + errText_(err));
  }
}

function logChanges_(ctx, rec, changes, by) {
  const sh = sheet_(ctx, SHEET.CHANGES);
  const now = nowText_();
  const rows = changes.map(function (c) {
    return [now, rec.id, String(rec.version), by, c.label, safeCell_(trunc_(c.old, 2000)), safeCell_(trunc_(c.now, 2000))];
  });
  const start = sh.getLastRow() + 1;
  if (start + rows.length - 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), rows.length + 200);
  const range = sh.getRange(start, 1, rows.length, 7);
  range.setNumberFormat('@');
  range.setValues(rows);
}

function staff_(ctx) {
  if (ctx._staff) return ctx._staff;
  const rows = listSheet_(ctx, SHEET.STAFF, ['ID', 'Name', 'PIN', 'Sprache', 'Rolle', 'Aktiv'], 'M');
  ctx._staff = rows.map(function (r) {
    const role = str_(r.Rolle).toLowerCase();
    const isOffice = /b(ü|ue|u)ro|office|admin/.test(role);
    const pin = sheetDigits_(r.PIN);
    return {
      id: r.ID, name: str_(r.Name),
      pin: pin,
      // zu kurze PINs sind zu leicht zu erraten → damit ist keine Anmeldung möglich (Selbsttest nennt den Namen)
      pinOk: pin.length >= (isOffice ? PIN_MIN_OFFICE : PIN_MIN_STAFF) && pin.length <= PIN_MAX,
      lang: LANGS.indexOf(str_(r.Sprache).toLowerCase()) >= 0 ? str_(r.Sprache).toLowerCase() : 'ar',
      isOffice: isOffice,
      active: isYes_(r.Aktiv)
    };
  });
  return ctx._staff;
}

function projects_(ctx) {
  if (ctx._projects) return ctx._projects;
  const rows = listSheet_(ctx, SHEET.PROJECTS, ['ID', 'Bauvorhaben', 'Adresse / Auftraggeber', 'Aktiv'], 'B');
  ctx._projects = rows.map(function (r) {
    return { id: r.ID, name: str_(r.Bauvorhaben), info: str_(r['Adresse / Auftraggeber']), active: isYes_(r.Aktiv) };
  });
  return ctx._projects;
}

function activities_(ctx) {
  if (ctx._activities) return ctx._activities;
  const rows = listSheet_(ctx, SHEET.ACTIVITIES, ['ID', 'Deutsch', 'Arabisch', 'Kurdisch', 'Aktiv'], 'T');
  ctx._activities = rows.map(function (r) {
    return { id: r.ID, de: str_(r.Deutsch), ar: str_(r.Arabisch), ku: str_(r.Kurdisch), active: isYes_(r.Aktiv) };
  });
  return ctx._activities;
}

/**
 * Liest eine Stammdaten-Liste (Mitarbeiter, Bauvorhaben, Tätigkeiten).
 * Zeilen ohne Namen werden übersprungen. Fehlende IDs werden einmalig vergeben
 * und gespeichert, damit Verweise stabil bleiben, auch wenn sortiert wird.
 */
function listSheet_(ctx, name, cols, prefix) {
  const sh = sheet_(ctx, name);
  const lastRow = sh.getLastRow();
  const lastCol = Math.max(sh.getLastColumn(), cols.length);
  if (lastRow < 2) return [];
  const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = values[0].map(str_);
  const idx = {};
  cols.forEach(function (c) { idx[c] = headers.indexOf(c); });
  if (idx[cols[1]] < 0) throw apiError_('not_setup', 'Spalte "' + cols[1] + '" fehlt im Blatt ' + name);
  const out = [];
  const missingIds = [];
  values.slice(1).forEach(function (row, i) {
    if (!str_(row[idx[cols[1]]])) return;
    const r = {};
    cols.forEach(function (c) { r[c] = idx[c] >= 0 ? row[idx[c]] : ''; });
    r.ID = str_(r.ID);
    if (!r.ID) missingIds.push({ row: i + 2, rec: r });
    out.push(r);
  });
  if (missingIds.length && idx.ID >= 0) {
    const assign = function () {
      missingIds.forEach(function (m) {
        const cell = sh.getRange(m.row, idx.ID + 1);
        const existing = str_(cell.getValue());
        m.rec.ID = existing || (prefix + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase());
        if (!existing) { cell.setNumberFormat('@'); cell.setValue(m.rec.ID); }
      });
    };
    if (SCRIPT_LOCK_HELD) {
      assign(); // Sperre gehört schon dieser Ausführung – nicht noch einmal nehmen (Sperren sind nicht verschachtelbar)
    } else {
      let lock = null;
      try { lock = takeLock_(); } catch (e) { lock = null; } // belegt → die IDs folgen beim nächsten Aufruf
      if (lock) {
        try { assign(); } finally { dropLock_(lock); }
      }
    }
  }
  return out.filter(function (r) { return r.ID; });
}

function settings_(ctx) {
  if (ctx._settings) return ctx._settings;
  const map = {};
  const sh = ctx.ss.getSheetByName(SHEET.SETTINGS);
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) { map[str_(r[0])] = r[1]; });
  }
  const s = {};
  SETTINGS_DEF.forEach(function (d) {
    const v = map[d[1]];
    s[d[0]] = (v === undefined || v === null || String(v).trim() === '') ? d[2] : v;
  });
  s.firma = str_(s.firma) || 'Firma';
  s.recipients = parseEmails_(s.recipients);
  s.weeklyTo = parseEmails_(s.weeklyTo) || s.recipients;
  s.attachWord = isYes_(s.attachWord);
  s.attachPdf = isYes_(s.attachPdf);
  s.backupKeep = Math.max(3, Math.min(365, Math.round(Number(s.backupKeep)) || 30));
  ctx._settings = s;
  return s;
}

// =====================================================================
//  Dokumente (Google Docs → Word / PDF)
// =====================================================================

function renderDocuments_(ctx, rec) {
  const ids = parseJson_(rec.docIds) || {};
  const folder = monthFolder_(ctx, rec.date);
  ids.de = renderDoc_(ctx, ids.de, rec, 'de', folder);
  if (rec.lang !== 'de') ids.orig = renderDoc_(ctx, ids.orig, rec, rec.lang, folder);
  else delete ids.orig;
  rec.docIds = JSON.stringify(ids);
  rec.docDeUrl = docUrl_(ids.de);
  rec.docOrigUrl = ids.orig ? docUrl_(ids.orig) : '';
}

/** Lädt einen Datensatz und erzeugt fehlende Dokumente nach (für "erneut senden"). */
function ensureDocuments_(ctx, id) {
  const lock = takeLock_();
  try {
    const t = reportsTable_(ctx);
    const rec = findRecord_(t, function (r) { return r.id === id; });
    if (!rec) throw apiError_('not_found', 'Nachweis nicht gefunden');
    const ids = parseJson_(rec.docIds) || {};
    if (!ids.de || (rec.lang !== 'de' && !ids.orig)) {
      try {
        renderDocuments_(ctx, rec);
        writeFields_(t, rec, ['docIds', 'docDeUrl', 'docOrigUrl']);
      } catch (err) {
        logEvent_('FEHLER', 'Dokumente ' + rec.id + ': ' + errText_(err));
      }
    }
    return rec;
  } finally {
    dropLock_(lock);
  }
}

function renderDoc_(ctx, docId, rec, lang, folder) {
  const title = 'LN ' + rec.id + ' · ' + fmtDate_(rec.date) + ' · ' + rec.employeeName + ' · ' + LANG_TAG[lang];
  let doc = null;
  if (docId) {
    try { doc = DocumentApp.openById(docId); } catch (e) { doc = null; } // gelöscht → neu anlegen
  }
  if (!doc) doc = DocumentApp.create(title);
  else doc.setName(title);
  DriveApp.getFileById(doc.getId()).moveTo(folder); // auch bei geändertem Datum im richtigen Monatsordner
  buildDocBody_(ctx, doc, rec, lang);
  doc.saveAndClose();
  return doc.getId();
}

function buildDocBody_(ctx, doc, rec, lang) {
  const T = DOC_TEXT[lang];
  const rtl = lang === 'ar';
  const body = doc.getBody();
  body.clear();
  body.setMarginTop(40).setMarginBottom(40).setMarginLeft(48).setMarginRight(48);

  // Kopf im Firmendesign: Logo, darunter Firmenname und Titel
  const first = body.getParagraphs()[0];
  first.setText('');
  para_(first, rtl, { size: 6, after: 6 });
  addLogo_(first);
  para_(body.appendParagraph(settings_(ctx).firma), rtl, { size: 10, color: '#555555' });
  para_(body.appendParagraph(T.title), rtl, { size: 20, bold: true, after: 2, color: BRAND.deep });
  para_(body.appendParagraph(T.subtitle + ' · ' + T.no + ' ' + rec.id + ' · ' + T.version + ' ' + rec.version),
    rtl, { size: 10, color: '#555555', after: 10 });

  const netMin = toMin_(rec.end) - toMin_(rec.start) - Number(rec.pauseMin);
  infoTable_(body, [
    [T.employee, rec.employeeName],
    [T.date, fmtDate_(rec.date)],
    [T.project, lang === 'de' ? rec.projectDe : rec.projectOrig],
    [T.start, rec.start],
    [T.end, rec.end],
    [T.pause, rec.pauseMin + ' ' + T.min],
    [T.worktime, fmtDuration_(netMin) + ' ' + T.hours]
  ], rtl);

  sectionTitle_(body, T.activities, rtl);
  const acts = String(lang === 'de' ? rec.activitiesDe : rec.activitiesOrig).split('; ').filter(Boolean);
  if (acts.length) {
    acts.forEach(function (a) {
      const li = body.appendListItem(a);
      li.setGlyphType(DocumentApp.GlyphType.BULLET);
      para_(li, rtl, { size: 11 });
    });
  } else {
    para_(body.appendParagraph('–'), rtl, { size: 11 });
  }

  sectionTitle_(body, T.description, rtl);
  multiline_(body, lang === 'de' ? rec.descriptionDe : rec.descriptionOrig, rtl);

  if (rec.materialOrig) {
    sectionTitle_(body, T.material, rtl);
    multiline_(body, lang === 'de' ? rec.materialDe : rec.materialOrig, rtl);
  }

  photoSection_(body, rec, T, rtl);

  sectionTitle_(body, T.signatures, rtl);
  signatureTable_(body, rec, T, rtl);

  let foot = T.no + ' ' + rec.id + ' · ' + T.version + ' ' + rec.version + ' · ' + T.created + ' ' + fmtDateTime_(rec.createdAt);
  if (Number(rec.version) > 1) foot += ' · ' + T.changed + ' ' + fmtDateTime_(rec.updatedAt) + ' (' + rec.updatedBy + ')';
  para_(body.appendParagraph(foot), rtl, { size: 8, color: '#777777', before: 14 });
  if (lang === 'de' && rec.lang !== 'de') {
    para_(body.appendParagraph(fill_(DOC_TEXT.de.translatedFrom, { lang: LANG_FROM_DE[rec.lang] })), rtl,
      { size: 8, color: '#777777', italic: true });
  }
  if (T.originalNote) para_(body.appendParagraph(T.originalNote), rtl, { size: 8, color: '#777777', italic: true });
}

function para_(p, rtl, o) {
  p.setLeftToRight(!rtl);
  if (!rtl) p.setAlignment(DocumentApp.HorizontalAlignment.LEFT);
  else if (RTL_ALIGNMENT === 'LEFT') p.setAlignment(DocumentApp.HorizontalAlignment.LEFT);
  else if (RTL_ALIGNMENT !== 'NONE') p.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
  const a = {};
  a[DocumentApp.Attribute.FONT_FAMILY] = 'Arial';
  a[DocumentApp.Attribute.FONT_SIZE] = o.size || 11;
  a[DocumentApp.Attribute.BOLD] = !!o.bold;
  a[DocumentApp.Attribute.ITALIC] = !!o.italic;
  a[DocumentApp.Attribute.FOREGROUND_COLOR] = o.color || '#111111';
  p.setAttributes(a);
  if (o.after != null) p.setSpacingAfter(o.after);
  if (o.before != null) p.setSpacingBefore(o.before);
  return p;
}

function sectionTitle_(body, text, rtl) {
  return para_(body.appendParagraph(text), rtl, { size: 12, bold: true, before: 12, after: 4, color: BRAND.deep });
}

/** Firmenlogo in einen (leeren) Absatz setzen. Fehlt es aus irgendeinem Grund, entsteht das Dokument ohne Logo. */
function addLogo_(p) {
  try {
    const img = p.appendInlineImage(Utilities.newBlob(Utilities.base64Decode(LOGO_PNG_B64), 'image/png', 'logo.png'));
    img.setWidth(LOGO_DOC_W);
    img.setHeight(Math.round(LOGO_DOC_W * LOGO_RATIO));
    return true;
  } catch (e) {
    logEvent_('WARN', 'Logo konnte nicht ins Dokument gesetzt werden: ' + errText_(e));
    return false;
  }
}

function multiline_(body, text, rtl) {
  const lines = String(text || '–').split('\n');
  lines.forEach(function (line) { para_(body.appendParagraph(line), rtl, { size: 11 }); });
}

function infoTable_(body, rows, rtl) {
  const cells = rows.map(function (r) { return rtl ? [String(r[1]), String(r[0])] : [String(r[0]), String(r[1])]; });
  const table = body.appendTable(cells);
  table.setBorderWidth(0.5);
  table.setBorderColor('#B0B0B0');
  const labelCol = rtl ? 1 : 0;
  table.setColumnWidth(labelCol, 170);
  for (let i = 0; i < table.getNumRows(); i++) {
    for (let c = 0; c < 2; c++) {
      const cell = table.getCell(i, c);
      cell.setPaddingTop(3).setPaddingBottom(3).setPaddingLeft(6).setPaddingRight(6);
      if (c === labelCol) cell.setBackgroundColor(BRAND.soft);
      para_(cell.getChild(0).asParagraph(), rtl, { size: 10.5, bold: c === labelCol });
    }
  }
  return table;
}

/** Fotos des Nachweises untereinander ins Dokument, je mit "Foto 1" und Aufnahmezeit darunter. */
function photoSection_(body, rec, T, rtl) {
  const photos = parseJson_(rec.photoData) || [];
  if (!photos.length) return;
  sectionTitle_(body, T.photos, rtl);
  photos.forEach(function (p, i) {
    const par = para_(body.appendParagraph(''), rtl, { size: 10, before: 4 });
    let ok = false;
    try {
      const img = par.appendInlineImage(DriveApp.getFileById(p.fileId).getBlob());
      const ratio = img.getWidth() ? img.getHeight() / img.getWidth() : 0.75;
      img.setWidth(PHOTO_DOC_W);
      img.setHeight(Math.max(20, Math.round(PHOTO_DOC_W * ratio)));
      ok = true;
    } catch (err) {
      par.setText(T.photoMissing);
      para_(par, rtl, { size: 10, color: '#B00020' });
      logEvent_('WARNUNG', 'Foto fehlt im Dokument (' + rec.id + '): ' + errText_(err));
    }
    if (ok) para_(body.appendParagraph(T.photo + ' ' + (i + 1) + ' · ' + fmtDateTime_(p.at)), rtl, { size: 8, color: '#777777' });
  });
}

function signatureTable_(body, rec, T, rtl) {
  const data = parseJson_(rec.sigData) || {};
  const cols = [
    { label: T.sigEmployee, sig: data.employee, name: rec.employeeName },
    { label: T.sigClient, sig: data.client, name: rec.clientName }
  ];
  if (rtl) cols.reverse();
  const table = body.appendTable([[cols[0].label, cols[1].label], ['', ''], ['', '']]);
  table.setBorderWidth(0.5);
  table.setBorderColor('#B0B0B0');
  for (let c = 0; c < 2; c++) {
    const col = cols[c];
    const head = table.getCell(0, c);
    head.setBackgroundColor(BRAND.soft);
    para_(head.getChild(0).asParagraph(), rtl, { size: 9.5, bold: true });

    const imgPar = table.getCell(1, c).getChild(0).asParagraph();
    if (col.sig && col.sig.fileId) {
      try {
        const blob = DriveApp.getFileById(col.sig.fileId).getBlob();
        para_(imgPar, rtl, { size: 10 });
        const img = imgPar.appendInlineImage(blob);
        const w = 170;
        const ratio = img.getWidth() ? img.getHeight() / img.getWidth() : 1 / 3;
        img.setWidth(w);
        img.setHeight(Math.max(20, Math.round(w * ratio)));
      } catch (err) {
        imgPar.setText(T.sigMissing);
        para_(imgPar, rtl, { size: 10, color: '#B00020' });
      }
    } else {
      imgPar.setText(T.noSig);
      para_(imgPar, rtl, { size: 10, color: '#777777', italic: true });
    }

    let info = col.name || '';
    if (col.sig && Number(col.sig.version) !== Number(rec.version)) {
      info += (info ? ' · ' : '') + fill_(T.sigForVersion, { v: col.sig.version });
    }
    const infoPar = table.getCell(2, c).getChild(0).asParagraph();
    infoPar.setText(info || ' ');
    para_(infoPar, rtl, { size: 9, color: '#555555' });
  }
}

function docUrl_(id) {
  return id ? 'https://docs.google.com/document/d/' + id + '/edit' : '';
}

function exportDocx_(docId, name) {
  const url = 'https://docs.google.com/document/d/' + encodeURIComponent(docId) + '/export?format=docx';
  const resp = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) throw new Error('Word-Export fehlgeschlagen (HTTP ' + resp.getResponseCode() + ')');
  return checkFile_(resp.getBlob().setName(name), 'zip', 'Word-Datei');
}

function exportPdf_(docId, name) {
  return checkFile_(DriveApp.getFileById(docId).getAs('application/pdf').setName(name), 'pdf', 'PDF-Datei');
}

function exportXlsx_(spreadsheetId) {
  const url = 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(spreadsheetId) + '/export?format=xlsx';
  const resp = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) throw new Error('Excel-Export fehlgeschlagen (HTTP ' + resp.getResponseCode() + ')');
  return checkFile_(resp.getBlob(), 'zip', 'Excel-Datei');
}

/**
 * Prüft, dass wirklich eine Datei vom erwarteten Typ herauskam (und keine Fehlerseite mit "200 OK"):
 * Word/Excel sind ZIP-Dateien ("PK"), PDF beginnt mit "%PDF". Sonst Fehler → kein kaputter Anhang, kein leeres Backup.
 */
function checkFile_(blob, kind, what) {
  const b = blob.getBytes();
  const ok = b.length > 200 && (kind === 'pdf'
    ? (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46)
    : (b[0] === 0x50 && b[1] === 0x4b));
  if (!ok) throw new Error(what + ' ist unbrauchbar (falsches Format oder leer, ' + b.length + ' Bytes)');
  return blob;
}

// =====================================================================
//  E-Mail
// =====================================================================

function sendReportMail_(ctx, rec, opts) {
  opts = opts || {};
  const attempt = opts.attempt || 1;
  try {
    const s = settings_(ctx);
    if (!s.recipients) throw new Error('Kein E-Mail-Empfänger im Blatt "Einstellungen" eingetragen');
    const ids = parseJson_(rec.docIds) || {};
    const base = fileBase_(rec);
    const tag = LANG_TAG[rec.lang] || 'XX';
    const attachments = [];
    const attachErrors = [];
    if (ids.de) {
      const tryAttach = function (fn) {
        try { attachments.push(fn()); } catch (err) { attachErrors.push(errText_(err)); }
      };
      if (s.attachWord) {
        tryAttach(function () { return exportDocx_(ids.de, base + '_DE.docx'); });
        if (ids.orig) tryAttach(function () { return exportDocx_(ids.orig, base + '_' + tag + '.docx'); });
      }
      if (s.attachPdf) {
        tryAttach(function () { return exportPdf_(ids.de, base + '_DE.pdf'); });
        if (ids.orig) tryAttach(function () { return exportPdf_(ids.orig, base + '_' + tag + '.pdf'); });
      }
    }
    let prefix = '';
    if (opts.resend) prefix = 'ERNEUT: ';
    else if (Number(rec.version) > 1) prefix = 'KORREKTUR V' + rec.version + ': ';
    const subject = prefix + 'Leistungsnachweis ' + rec.id + ' – ' + rec.employeeName + ' – ' +
      fmtDate_(rec.date) + ' – ' + trunc_(rec.projectDe, 60);
    const problems = [];
    if (opts.docsOk === false || !ids.de) problems.push('Die Dokumente konnten nicht erstellt werden. Die Daten sind in der Tabelle gespeichert.');
    if (attachErrors.length) problems.push('Nicht alle Anhänge konnten erzeugt werden: ' + attachErrors.join('; '));
    MailApp.sendEmail({
      to: s.recipients,
      subject: subject.replace(/[\r\n]+/g, ' '),
      htmlBody: mailHtml_(ctx, rec, opts.changes || [], problems),
      body: mailText_(rec, problems),
      name: 'Leistungsnachweis-App',
      attachments: attachments
    });
    setMailStatus_(ctx, rec, 'gesendet ' + nowText_() + (attachErrors.length ? ' (Anhänge unvollständig)' : ''));
    return true;
  } catch (err) {
    const n = Math.min(attempt, MAIL_MAX_ATTEMPTS);
    setMailStatus_(ctx, rec, 'FEHLER (' + n + '/' + MAIL_MAX_ATTEMPTS + ') ' + nowText_() + ': ' + trunc_(errText_(err), 180));
    logEvent_('FEHLER', 'E-Mail ' + rec.id + ': ' + errText_(err));
    return false;
  }
}

function mailHtml_(ctx, rec, changes, problems) {
  const e = escHtml_;
  const row = function (k, v) {
    return '<tr><td style="background:' + BRAND.soft + ';font-weight:bold;padding:6px 10px;border:1px solid #ddd;vertical-align:top">' +
      e(k) + '</td><td style="padding:6px 10px;border:1px solid #ddd">' + v + '</td></tr>';
  };
  const netMin = toMin_(rec.end) - toMin_(rec.start) - Number(rec.pauseMin);
  const sig = parseJson_(rec.sigData) || {};
  let h = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;max-width:720px">';
  h += '<h2 style="margin:0 0 4px;color:' + BRAND.deep + '">Leistungsnachweis ' + e(rec.id) + '</h2>';
  h += '<p style="margin:0 0 14px;color:#555">Version ' + e(rec.version) + ' · Status: ' + e(rec.status) +
    (Number(rec.version) > 1 ? ' · geändert von ' + e(rec.updatedBy) : '') + '</p>';
  problems.forEach(function (p) {
    h += '<p style="background:#fff4e5;border:1px solid #f0b46c;padding:8px 10px">⚠ ' + e(p) + '</p>';
  });
  h += '<table style="border-collapse:collapse;font-size:14px">';
  h += row('Mitarbeiter', e(rec.employeeName));
  h += row('Datum', e(fmtDate_(rec.date)));
  h += row('Bauvorhaben', e(rec.projectDe));
  h += row('Arbeitszeit', e(rec.start + ' – ' + rec.end + ' Uhr, Pause ' + rec.pauseMin + ' Min. = ' + fmtDuration_(netMin) + ' Std.'));
  h += row('Tätigkeiten', e(rec.activitiesDe || '–'));
  h += row('Beschreibung', nl2br_(e(rec.descriptionDe || '–')));
  if (rec.materialOrig) h += row('Material / Geräte', nl2br_(e(rec.materialDe)));
  const photoN = (parseJson_(rec.photoData) || []).length;
  if (photoN) h += row('Fotos', photoN + (photoN === 1 ? ' Foto' : ' Fotos') + ' – im Word- und PDF-Dokument');
  h += row('Unterschriften', 'Mitarbeiter: ' + (sig.employee ? 'ja' : 'nein') + ' · Auftraggeber: ' +
    (sig.client ? 'ja' + (rec.clientName ? ' (' + e(rec.clientName) + ')' : '') : 'nein'));
  h += '</table>';
  if (rec.lang !== 'de') {
    const dir = rec.lang === 'ar' ? 'rtl' : 'ltr';
    h += '<h3 style="margin:18px 0 6px">Original (' + e(LANG_NAME_DE[rec.lang]) + ')</h3>';
    h += '<div dir="' + dir + '" style="text-align:' + (dir === 'rtl' ? 'right' : 'left') +
      ';background:#fafafa;border:1px solid #ddd;padding:8px 10px">' + nl2br_(e(rec.descriptionOrig || '–')) +
      (rec.materialOrig ? '<br><br>' + nl2br_(e(rec.materialOrig)) : '') + '</div>';
    h += '<p style="color:#777;font-size:12px">Deutsche Texte maschinell übersetzt (Google Übersetzer).</p>';
  }
  if (changes.length) {
    h += '<h3 style="margin:18px 0 6px">Änderungen gegenüber Version ' + e(Number(rec.version) - 1) + '</h3>';
    h += '<table style="border-collapse:collapse;font-size:13px"><tr><th style="text-align:left;padding:4px 8px">Feld</th>' +
      '<th style="text-align:left;padding:4px 8px">vorher</th><th style="text-align:left;padding:4px 8px">jetzt</th></tr>';
    changes.forEach(function (c) {
      h += '<tr><td style="padding:4px 8px;border:1px solid #ddd">' + e(c.label) + '</td><td style="padding:4px 8px;border:1px solid #ddd">' +
        nl2br_(e(trunc_(c.old, 400))) + '</td><td style="padding:4px 8px;border:1px solid #ddd">' + nl2br_(e(trunc_(c.now, 400))) + '</td></tr>';
    });
    h += '</table>';
  }
  const links = [];
  if (rec.docDeUrl) links.push('<a href="' + e(rec.docDeUrl) + '">Dokument Deutsch</a>');
  if (rec.docOrigUrl) links.push('<a href="' + e(rec.docOrigUrl) + '">Dokument Original</a>');
  links.push('<a href="' + e(ctx.ss.getUrl()) + '">Tabelle</a>');
  h += '<p style="margin-top:18px">' + links.join(' · ') + '</p>';
  h += '<p style="color:#777;font-size:12px">Automatisch erstellt von der Leistungsnachweis-App · ' + e(nowText_()) + '</p></div>';
  return h;
}

function mailText_(rec, problems) {
  const netMin = toMin_(rec.end) - toMin_(rec.start) - Number(rec.pauseMin);
  return [
    'Leistungsnachweis ' + rec.id + ' (Version ' + rec.version + ')',
    problems.join('\n'),
    'Mitarbeiter: ' + rec.employeeName,
    'Datum: ' + fmtDate_(rec.date),
    'Bauvorhaben: ' + rec.projectDe,
    'Arbeitszeit: ' + rec.start + ' – ' + rec.end + ', Pause ' + rec.pauseMin + ' Min. = ' + fmtDuration_(netMin) + ' Std.',
    'Tätigkeiten: ' + (rec.activitiesDe || '–'),
    'Beschreibung: ' + (rec.descriptionDe || '–'),
    rec.materialOrig ? 'Material/Geräte: ' + rec.materialDe : '',
    rec.lang !== 'de' ? '\nOriginal (' + LANG_NAME_DE[rec.lang] + '):\n' + rec.descriptionOrig : ''
  ].filter(Boolean).join('\n');
}

function fileBase_(rec) {
  const name = String(rec.employeeName || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  return 'LN-' + rec.id + '_' + rec.date + (name ? '_' + name : '');
}

// =====================================================================
//  Excel-Liste, Sicherung, Wartung
// =====================================================================

const EXPORT_COLS = ['id', 'date', 'employeeName', 'projectDe', 'start', 'end', 'pauseMin', 'hours', 'activitiesDe',
  'descriptionDe', 'materialDe', 'status', 'version', 'sigEmployeeInfo', 'sigClientInfo', 'clientName',
  'lang', 'descriptionOrig', 'materialOrig', 'createdAt', 'updatedAt', 'updatedBy'];

/** Erstellt eine Excel-Datei mit allen Nachweisen im Zeitraum (ohne PINs) und schickt sie per E-Mail. */
function sendXlsxList_(ctx, from, to, title) {
  const s = settings_(ctx);
  const recipients = s.weeklyTo || s.recipients;
  if (!recipients) throw apiError_('not_setup', 'Kein E-Mail-Empfänger eingetragen');
  const t = reportsTable_(ctx);
  const recs = [];
  t.rows.forEach(function (row, i) {
    const r = rowToRecord_(t, row, i);
    if (r.id && r.date >= from && r.date <= to) recs.push(r);
  });
  recs.sort(function (a, b) {
    return a.employeeName.localeCompare(b.employeeName) || (a.date + a.start).localeCompare(b.date + b.start);
  });
  const colDefs = EXPORT_COLS.map(function (k) { return REPORT_COLS.filter(function (c) { return c[0] === k; })[0]; });
  const header = colDefs.map(function (c) { return c[1]; });
  const data = recs.map(function (r) { return colDefs.map(function (c) { return cellOut_(r[c[0]], c[2]); }); });

  // Summen je Mitarbeiter
  const sums = {};
  recs.forEach(function (r) {
    const k = r.employeeName;
    if (!sums[k]) sums[k] = { days: {}, hours: 0, count: 0 };
    sums[k].days[r.date] = true;
    sums[k].hours += Number(r.hours) || 0;
    sums[k].count += 1;
  });
  const sumRows = Object.keys(sums).sort().map(function (k) {
    return [safeCell_(k), Object.keys(sums[k].days).length, sums[k].count, Math.round(sums[k].hours * 100) / 100];
  });

  const name = 'Leistungsnachweise ' + from + ' bis ' + to;
  const tmp = SpreadsheetApp.create(name, Math.max(recs.length + 10, 100), header.length + 2);
  try {
    const sh = tmp.getSheets()[0];
    sh.setName('Nachweise');
    const all = [header].concat(data);
    const range = sh.getRange(1, 1, all.length, header.length);
    range.setNumberFormats(all.map(function () {
      return colDefs.map(function (c) { return formatOf_(c[2]); });
    }));
    range.setValues(all);
    sh.getRange(1, 1, 1, header.length).setFontWeight('bold').setBackground('#E8E8E8');
    sh.setFrozenRows(1);
    const sumSheet = tmp.insertSheet('Summen');
    const sumAll = [['Mitarbeiter', 'Arbeitstage', 'Nachweise', 'Stunden']].concat(sumRows);
    sumSheet.getRange(1, 1, sumAll.length, 4).setValues(sumAll);
    sumSheet.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#E8E8E8');
    SpreadsheetApp.flush();
    const blob = exportXlsx_(tmp.getId()).setName(name.replace(/ /g, '_') + '.xlsx');
    let html = '<div style="font-family:Arial,sans-serif;font-size:14px"><p>' + escHtml_(title) + ': ' + recs.length +
      ' Nachweise vom ' + escHtml_(fmtDate_(from)) + ' bis ' + escHtml_(fmtDate_(to)) + '.</p>';
    if (sumRows.length) {
      html += '<table style="border-collapse:collapse">' + sumAll.map(function (r, i) {
        return '<tr>' + r.map(function (v) {
          return '<td style="border:1px solid #ddd;padding:4px 8px;' + (i === 0 ? 'font-weight:bold;background:#eee' : '') + '">' +
            escHtml_(String(v).replace(/^'/, '')) + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</table>';
    }
    html += '</div>';
    MailApp.sendEmail({ to: recipients, subject: name + ' (Excel)', htmlBody: html, body: title, name: 'Leistungsnachweis-App', attachments: [blob] });
  } finally {
    // Aufräumen darf nie den Erfolg kippen: Die E-Mail ist ja schon raus (sonst käme sie stündlich erneut)
    try { DriveApp.getFileById(tmp.getId()).setTrashed(true); } catch (err) { logEvent_('WARNUNG', 'Temporäre Excel-Datei nicht gelöscht: ' + errText_(err)); }
  }
  return { count: recs.length, to: recipients };
}

/** Legt eine vollständige Sicherungskopie (Excel, alle Blätter) in Drive ab und räumt alte auf. */
function sicherung_(ctx) {
  const s = settings_(ctx);
  const folder = folder_(ctx, 'BACKUP_FOLDER_ID', 'Sicherungen');
  const stamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd_HHmm');
  const blob = exportXlsx_(ctx.ss.getId()).setName('Sicherung_' + stamp + '.xlsx');
  const file = folder.createFile(blob);
  // Alte Sicherungen in den Papierkorb (dort noch 30 Tage wiederherstellbar)
  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (/^Sicherung_.*\.xlsx$/.test(f.getName())) files.push(f);
  }
  files.sort(function (a, b) { return b.getName().localeCompare(a.getName()); });
  files.slice(s.backupKeep).forEach(function (f) { f.setTrashed(true); });
  logEvent_('INFO', 'Sicherung erstellt: ' + file.getName());
  return file;
}

/**
 * Sendet E-Mails nach, die nicht rausgingen: Status "FEHLER (n/3)" – und "wird gesendet …", wenn das schon
 * länger als MAIL_STUCK_MINUTES steht (dann wurde die Ausführung vorzeitig beendet, z. B. durch das 6-Minuten-Limit).
 * Nach dem dritten Fehlschlag geht eine Warn-E-Mail ans Büro.
 */
function retryFailedMails_(ctx) {
  const t = reportsTable_(ctx);
  const cutoff = Utilities.formatDate(new Date(Date.now() - 7 * 86400000), TZ, 'yyyy-MM-dd HH:mm');
  const stuckBefore = Utilities.formatDate(new Date(Date.now() - MAIL_STUCK_MINUTES * 60000), TZ, 'yyyy-MM-dd HH:mm');
  let done = 0;
  t.rows.forEach(function (row, i) {
    if (done >= 10) return;
    const r = rowToRecord_(t, row, i);
    if (!r.id || r.updatedAt < cutoff) return;
    const failed = /^FEHLER \((\d+)\/\d+\)/.exec(r.mailStatus || '');
    let attempt;
    if (failed) attempt = Number(failed[1]);
    else if (/^wird gesendet/.test(r.mailStatus || '') && r.updatedAt < stuckBefore) attempt = 1;
    else return;
    if (attempt >= MAIL_MAX_ATTEMPTS) return;
    const rec = ensureDocuments_(ctx, r.id);
    const ok = sendReportMail_(ctx, rec, { docsOk: !!rec.docIds, attempt: attempt + 1 });
    if (!ok && attempt + 1 >= MAIL_MAX_ATTEMPTS) {
      alertOffice_(ctx, 'E-Mail-Versand fehlgeschlagen',
        'Nachweis ' + r.id + ' (' + r.employeeName + ', ' + fmtDate_(r.date) + ') konnte auch nach ' + MAIL_MAX_ATTEMPTS +
        ' Versuchen nicht per E-Mail gesendet werden. Die Daten sind in der Tabelle gespeichert. ' +
        'Bitte in der Tabelle (Blatt "Nachweise", Spalte "E-Mail") nachsehen – dort stehen auch weitere betroffene Nachweise – ' +
        'und in der App unter Büro → Nachweis → "Erneut senden" probieren. Häufige Ursache: Tages-Kontingent für E-Mails aufgebraucht.');
    }
    done++;
  });
  return done;
}

/** Läuft stündlich (nach "Automatik einschalten"): E-Mails nachholen, Sicherung, Wochenliste. */
function wartung() {
  const ctx = ctx_();
  const props = ctx.props;
  const now = new Date();
  const today = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  const hour = Number(Utilities.formatDate(now, TZ, 'H'));
  try { retryFailedMails_(ctx); } catch (err) { logEvent_('FEHLER', 'Wartung/E-Mail: ' + errText_(err)); }
  if (hour >= 1 && props.getProperty('LAST_BACKUP') !== today) {
    try {
      sicherung_(ctx);
      props.setProperty('LAST_BACKUP', today);
    } catch (err) {
      logEvent_('FEHLER', 'Sicherung: ' + errText_(err));
      // stündlich neuer Versuch; die Warn-E-Mail kommt höchstens einmal am Tag
      alertOffice_(ctx, 'Sicherung fehlgeschlagen',
        'Die tägliche Sicherungskopie (Excel) konnte nicht erstellt werden: ' + errText_(err) + '\n' +
        'Die Daten in der Tabelle sind unverändert. Bitte im Menü "Leistungsnachweis" → "Sicherung jetzt erstellen" probieren ' +
        'und den freien Speicherplatz in Google Drive prüfen.');
    }
  }
  const weekday = Utilities.formatDate(now, TZ, 'u'); // 1 = Montag
  if (weekday === '1' && hour >= 6 && props.getProperty('LAST_WEEKLY') !== today) {
    try {
      const w = lastWeek_();
      sendXlsxList_(ctx, w.from, w.to, 'Wochenliste');
      props.setProperty('LAST_WEEKLY', today);
    } catch (err) {
      logEvent_('FEHLER', 'Wochenliste: ' + errText_(err));
      alertOffice_(ctx, 'Wochenliste fehlgeschlagen',
        'Die Excel-Wochenliste konnte nicht gesendet werden: ' + errText_(err) + '\n' +
        'Im Menü "Leistungsnachweis" → "Excel-Liste der letzten Woche senden" lässt sie sich von Hand erneut senden.');
    }
  }
}

function lastWeek_() {
  const now = new Date();
  const dow = Number(Utilities.formatDate(now, TZ, 'u')); // 1..7
  const mondayThisWeek = new Date(now.getTime() - (dow - 1) * 86400000);
  const from = new Date(mondayThisWeek.getTime() - 7 * 86400000);
  const to = new Date(mondayThisWeek.getTime() - 86400000);
  return { from: Utilities.formatDate(from, TZ, 'yyyy-MM-dd'), to: Utilities.formatDate(to, TZ, 'yyyy-MM-dd') };
}

// =====================================================================
//  Menü & Einrichtung (in der Tabelle)
// =====================================================================

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Leistungsnachweis')
    .addItem('1. Einrichten / Prüfen', 'menuEinrichten')
    .addItem('2. Selbsttest (PINs, Übersetzung, Dokumente, Sicherung, E-Mail)', 'menuSelbsttest')
    .addItem('3. Automatik einschalten (Sicherung, Wochenliste)', 'menuAutomatik')
    .addItem('4. Systemcheck (Zustand auf einen Blick)', 'menuSystemcheck')
    .addSeparator()
    .addItem('Sicherung jetzt erstellen', 'menuSicherung')
    .addItem('Excel-Liste der letzten Woche senden', 'menuWochenliste')
    .addItem('Anmelde-Sperre aufheben', 'menuSperreAufheben')
    .addToUi();
}

// Aus dem Menü gestartet → Ergebnis als Fenster. Aus dem Editor gestartet → Ausführungsprotokoll
// (ein Fenster würde dort unbemerkt auf "OK" warten).
let UI_MODE = false;
function withUi_(fn) { UI_MODE = true; try { return fn(); } finally { UI_MODE = false; } }
function menuEinrichten() { return withUi_(einrichten); }
function menuSelbsttest() { return withUi_(selbsttest); }
function menuAutomatik() { return withUi_(automatikEinschalten); }
function menuSystemcheck() { return withUi_(systemcheck); }
function menuSicherung() { return withUi_(sicherungJetzt); }
function menuWochenliste() { return withUi_(wochenlisteJetzt); }
function menuSperreAufheben() { return withUi_(sperreAufheben); }

function einrichten() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Bitte das Skript aus der Google-Tabelle öffnen (Erweiterungen → Apps Script).');
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SPREADSHEET_ID', ss.getId());
  if (!props.getProperty('TOKEN_SECRET')) {
    props.setProperty('TOKEN_SECRET', Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid());
  }
  ss.setSpreadsheetTimeZone(TZ);
  const ctx = { props: props, ss: ss };
  const created = [];

  if (ensureSheet_(ss, SHEET.REPORTS, REPORT_COLS.map(function (c) { return c[1]; }))) created.push(SHEET.REPORTS);
  const rep = ss.getSheetByName(SHEET.REPORTS);
  reportsTable_(ctx); // ergänzt ggf. fehlende Spalten
  formatReportsSheet_(rep);

  let ownerMail = '';
  try { ownerMail = Session.getEffectiveUser().getEmail(); } catch (e) { ownerMail = ''; }

  if (ensureSheet_(ss, SHEET.STAFF, ['ID', 'Name', 'PIN', 'Sprache', 'Rolle', 'Aktiv'])) {
    created.push(SHEET.STAFF);
    const sh = ss.getSheetByName(SHEET.STAFF);
    sh.getRange(2, 1, 200, 3).setNumberFormat('@');
    sh.getRange(2, 1, 2, 6).setValues([
      ['M01', 'Büro', randomPin_(PIN_MIN_OFFICE), 'de', 'Büro', true],
      ['M02', 'Test Mitarbeiter', randomPin_(PIN_MIN_STAFF), 'ar', 'Mitarbeiter', true]
    ]);
    sh.getRange(2, 4, 200, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['ar', 'ku', 'de'], true).build());
    sh.getRange(2, 5, 200, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Mitarbeiter', 'Büro'], true).build());
    sh.getRange(2, 6, 200, 1).insertCheckboxes();
    sh.getRange(2, 6, 2, 1).setValue(true);
    sh.setColumnWidth(2, 200);
  }
  if (ensureSheet_(ss, SHEET.PROJECTS, ['ID', 'Bauvorhaben', 'Adresse / Auftraggeber', 'Aktiv'])) {
    created.push(SHEET.PROJECTS);
    const sh = ss.getSheetByName(SHEET.PROJECTS);
    sh.getRange(2, 1, 200, 3).setNumberFormat('@');
    sh.getRange(2, 1, 1, 4).setValues([['B01', 'Beispiel-Baustelle (bitte ändern)', 'Straße, Ort / Auftraggeber', true]]);
    sh.getRange(2, 4, 200, 1).insertCheckboxes();
    sh.getRange(2, 4).setValue(true);
    sh.setColumnWidth(2, 260);
    sh.setColumnWidth(3, 260);
  }
  if (ensureSheet_(ss, SHEET.ACTIVITIES, ['ID', 'Deutsch', 'Arabisch', 'Kurdisch', 'Aktiv'])) {
    created.push(SHEET.ACTIVITIES);
    const sh = ss.getSheetByName(SHEET.ACTIVITIES);
    sh.getRange(2, 1, 200, 4).setNumberFormat('@');
    sh.getRange(2, 1, DEFAULT_ACTIVITIES.length, 4).setValues(DEFAULT_ACTIVITIES);
    sh.getRange(2, 5, 200, 1).insertCheckboxes();
    sh.getRange(2, 5, DEFAULT_ACTIVITIES.length, 1).setValue(true);
    sh.setColumnWidths(2, 3, 220);
  }
  if (ensureSheet_(ss, SHEET.SETTINGS, ['Einstellung', 'Wert', 'Erklärung'])) {
    created.push(SHEET.SETTINGS);
    const sh = ss.getSheetByName(SHEET.SETTINGS);
    sh.getRange(2, 1, SETTINGS_DEF.length, 3).setNumberFormat('@');
    sh.getRange(2, 1, SETTINGS_DEF.length, 3).setValues(SETTINGS_DEF.map(function (d) {
      return [d[1], d[0] === 'recipients' ? ownerMail : d[2], d[3]];
    }));
    sh.setColumnWidth(1, 220);
    sh.setColumnWidth(2, 280);
    sh.setColumnWidth(3, 420);
  }
  if (ensureSheet_(ss, SHEET.CHANGES, ['Zeitpunkt', 'Nachweis-Nr.', 'Version', 'Geändert von', 'Feld', 'Alter Wert', 'Neuer Wert'])) {
    created.push(SHEET.CHANGES);
  }
  if (ensureSheet_(ss, SHEET.LOG, ['Zeitpunkt', 'Ebene', 'Meldung'])) created.push(SHEET.LOG);

  // Versehentliches Bearbeiten erschweren (Warnhinweis; das Skript darf weiter schreiben)
  [SHEET.REPORTS, SHEET.CHANGES, SHEET.LOG].forEach(function (n) {
    const sh = ss.getSheetByName(n);
    if (!sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) {
      sh.protect().setDescription('Bitte Änderungen über die App vornehmen').setWarningOnly(true);
    }
  });

  // Leeres Standardblatt entfernen
  ss.getSheets().forEach(function (sh) {
    const known = Object.keys(SHEET).map(function (k) { return SHEET[k]; });
    if (known.indexOf(sh.getName()) < 0 && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });

  const root = folder_(ctx, 'FOLDER_ID', 'Leistungsnachweise (App)');
  folder_(ctx, 'SIG_FOLDER_ID', 'Unterschriften');
  folder_(ctx, 'PHOTO_FOLDER_ID', 'Fotos');
  folder_(ctx, 'BACKUP_FOLDER_ID', 'Sicherungen');

  const msg = 'Einrichtung abgeschlossen.\n\n' +
    (created.length ? 'Neu angelegt: ' + created.join(', ') + '\n' : 'Alle Blätter waren schon vorhanden.\n') +
    'Ablage-Ordner in Google Drive: ' + root.getName() + '\n\n' +
    'Nächste Schritte:\n' +
    '1. Blatt "Einstellungen": Firmenname und E-Mail-Empfänger prüfen.\n' +
    '2. Blatt "Mitarbeiter": Namen und PINs eintragen (jede PIN nur einmal; Mitarbeiter mindestens ' + PIN_MIN_STAFF +
    ' Ziffern, Büro mindestens ' + PIN_MIN_OFFICE + ' Ziffern – kürzere PINs funktionieren nicht).\n' +
    '3. Bereitstellen → Neue Bereitstellung → Web-App (Ausführen als: Ich, Zugriff: Jeder).\n' +
    '4. Menü "Leistungsnachweis" → Selbsttest.';
  notify_(msg);
  return msg;
}

function formatReportsSheet_(sh) {
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(str_);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#E8E8E8');
  const maxRows = sh.getMaxRows();
  REPORT_COLS.forEach(function (c) {
    const i = headers.indexOf(c[1]);
    if (i < 0) return;
    if (maxRows > 1) sh.getRange(2, i + 1, maxRows - 1, 1).setNumberFormat(formatOf_(c[2]));
    if (c[3]) sh.hideColumns(i + 1);
  });
  [['Beschreibung (Deutsch)', 320], ['Beschreibung (Original)', 320], ['Tätigkeiten', 240], ['Bauvorhaben', 220], ['E-Mail', 220]]
    .forEach(function (w) {
      const i = headers.indexOf(w[0]);
      if (i >= 0) sh.setColumnWidth(i + 1, w[1]);
    });
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (sh) {
    if (sh.getLastRow() === 0) {
      ensureCols_(sh, headers.length);
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      return false;
    }
    const lastCol = Math.max(sh.getLastColumn(), 1);
    const existing = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(str_);
    const missing = headers.filter(function (h) { return existing.indexOf(h) < 0; });
    if (missing.length) {
      ensureCols_(sh, lastCol + missing.length);
      sh.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
    }
    return false;
  }
  sh = ss.insertSheet(name);
  ensureCols_(sh, headers.length);
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#E8E8E8');
  sh.setFrozenRows(1);
  return true;
}

/** Neue Tabellenblätter haben nur 26 Spalten – bei Bedarf erweitern. */
function ensureCols_(sh, n) {
  const max = sh.getMaxColumns();
  if (max < n) sh.insertColumnsAfter(max, n - max);
}

/** Zufalls-PIN mit len Ziffern (mindestens 6, höchstens 14). Gleichmäßig verteilt; erste Ziffer nie 0 (verschwindet sonst leicht in Tabellen). */
function randomPin_(len) {
  const n = Math.min(Math.max(Number(len) || PIN_MIN_STAFF, PIN_MIN_STAFF), 14);
  for (let attempt = 0; attempt < 5; attempt++) {
    const bytes = [];
    [Utilities.getUuid(), Utilities.getUuid()].forEach(function (u) {
      const h = u.replace(/-/g, '');
      // Byte 6 und 8 einer UUID tragen feste Versions-Bits → nicht verwenden
      for (let k = 0; k < 16; k++) if (k !== 6 && k !== 8) bytes.push(parseInt(h.slice(2 * k, 2 * k + 2), 16));
    });
    let pin = '';
    for (let i = 0; i < bytes.length && pin.length < n; i++) {
      if (bytes[i] >= 250) continue;            // 256 ist nicht durch 10 teilbar → Rest verwerfen, sonst wären Ziffern ungleich häufig
      const d = bytes[i] % 10;
      if (!pin && d === 0) continue;
      pin += String(d);
    }
    if (pin.length === n) return pin;
  }
  throw new Error('PIN konnte nicht erzeugt werden');
}

function automatikEinschalten() {
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    if (tr.getHandlerFunction() === 'wartung') ScriptApp.deleteTrigger(tr);
  });
  ScriptApp.newTrigger('wartung').timeBased().everyHours(1).create();
  notify_('Automatik eingeschaltet:\n- stündlich: fehlgeschlagene E-Mails erneut senden\n' +
    '- täglich ab 1 Uhr: Sicherungskopie (Excel) im Ordner "Sicherungen"\n- montags ab 6 Uhr: Excel-Liste der Vorwoche per E-Mail');
}

function sicherungJetzt() {
  const file = sicherung_(ctx_());
  notify_('Sicherung erstellt: ' + file.getName() + '\n(Ordner "Leistungsnachweise (App)/Sicherungen" in Google Drive)');
}

function wochenlisteJetzt() {
  const w = lastWeek_();
  const res = sendXlsxList_(ctx_(), w.from, w.to, 'Wochenliste');
  notify_('Excel-Liste gesendet an ' + res.to + ' (' + res.count + ' Nachweise, ' + fmtDate_(w.from) + ' – ' + fmtDate_(w.to) + ').');
}

/**
 * Selbsttest: prüft PINs, Anmelde-Sperre, Übersetzung (Arabisch, Kurdisch), Dokumente (Word/PDF),
 * den Excel-Export der Sicherung, E-Mail und die Automatik – ohne einen Eintrag in der Tabelle anzulegen.
 * Die Testdokumente liegen danach im Ordner "Selbsttest".
 */
function selbsttest() {
  const ctx = ctx_();
  const lines = [];
  const check = function (name, fn) {
    try { lines.push('✔ ' + name + ': ' + fn()); } catch (err) { lines.push('✘ ' + name + ': ' + errText_(err)); }
  };
  const todayIso = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  check('Mitarbeiter und PINs', function () {
    const list = staff_(ctx).filter(function (s) { return s.active; });
    if (!list.length) throw new Error('Kein aktiver Eintrag im Blatt "Mitarbeiter"');
    const problems = pinProblems_(list);
    if (problems.length) throw new Error(problems.join('; '));
    return list.length + ' aktive Benutzer, alle PINs in Ordnung';
  });
  check('Anmelde-Sperre', function () {
    const fails = Number(CacheService.getScriptCache().get('login_fails') || 0);
    const day = loginDayCount_(ctx, todayIso);
    const state = fails + ' Fehlversuche in den letzten 10 Min., heute ' + day + ' von ' + LOGIN_MAX_FAILS_DAY;
    if (fails >= LOGIN_MAX_FAILS || day >= LOGIN_MAX_FAILS_DAY) {
      throw new Error('Neue Anmeldungen sind GESPERRT (' + state + ') – Menü "Anmelde-Sperre aufheben"');
    }
    return 'frei (' + state + ')';
  });
  let arDe = '';
  check('Übersetzung Arabisch → Deutsch', function () {
    arDe = translate_('ركّبنا ألواح الجبس بورد في الطابق الثاني.\nبكرة منكمل الدهان.', 'ar', 'de');
    return arDe;
  });
  let kuDe = '';
  check('Übersetzung Kurdisch → Deutsch', function () {
    kuDe = translate_('Me îro li qata duyemîn alçîpan danî.', 'ku', 'de');
    return kuDe;
  });
  const rec = {
    id: '0000-TEST', version: 1, status: STATUS.SUBMITTED, lang: 'ar', employeeId: 'TEST', employeeName: 'Selbsttest',
    date: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'), start: '07:00', end: '16:00', pauseMin: 30, hours: 8.5,
    projectDe: 'Selbsttest-Baustelle', projectOrig: 'Selbsttest-Baustelle',
    activitiesDe: 'Trockenbau; Malerarbeiten', activitiesOrig: 'أعمال الجبس بورد; أعمال الدهان',
    descriptionOrig: 'ركّبنا ألواح الجبس بورد في الطابق الثاني.\nبكرة منكمل الدهان.', descriptionDe: arDe || '–',
    materialOrig: '', materialDe: '', clientName: '', sigData: '', docIds: '',
    createdAt: nowText_(), updatedAt: nowText_(), updatedBy: 'Selbsttest', mailStatus: ''
  };
  let ids = null;
  check('Foto im Nachweis', function () {
    const root = folder_(ctx, 'FOLDER_ID', 'Leistungsnachweise (App)');
    const it = root.getFoldersByName('Selbsttest');
    const folder = it.hasNext() ? it.next() : root.createFolder('Selbsttest');
    // Altes Testfoto wegräumen, damit der Ordner nicht volläuft
    const old = folder.getFilesByName('Selbsttest-Foto.jpg');
    while (old.hasNext()) old.next().setTrashed(true);
    const blob = Utilities.newBlob(Utilities.base64Decode(TEST_PHOTO_B64), 'image/jpeg', 'Selbsttest-Foto.jpg');
    const file = folder.createFile(blob);
    rec.photoData = JSON.stringify([{ fileId: file.getId(), version: 1, at: nowText_() }]);
    rec.photoCount = 1;
    return 'Testfoto gespeichert (' + Math.round(blob.getBytes().length / 1024) + ' KB) – es muss gleich im Word und im PDF zu sehen sein';
  });
  check('Dokumente (Deutsch + Arabisch)', function () {
    const root = folder_(ctx, 'FOLDER_ID', 'Leistungsnachweise (App)');
    const it = root.getFoldersByName('Selbsttest');
    const folder = it.hasNext() ? it.next() : root.createFolder('Selbsttest');
    ids = { de: renderDoc_(ctx, null, rec, 'de', folder), orig: renderDoc_(ctx, null, rec, 'ar', folder) };
    rec.docIds = JSON.stringify(ids);
    rec.docDeUrl = docUrl_(ids.de);
    rec.docOrigUrl = docUrl_(ids.orig);
    return 'erstellt im Ordner "Selbsttest"';
  });
  check('Word- und PDF-Export', function () {
    if (!ids) throw new Error('keine Dokumente');
    const a = exportDocx_(ids.de, 'test.docx');
    const b = exportPdf_(ids.orig, 'test.pdf');
    return 'Word ' + Math.round(a.getBytes().length / 1024) + ' KB, PDF ' + Math.round(b.getBytes().length / 1024) + ' KB (Dateiformat geprüft)';
  });
  check('Sicherung (Excel-Export der ganzen Tabelle nach Drive)', function () {
    // Echter Export + Schreiben in den Ordner "Sicherungen"; die Testdatei wird sofort wieder gelöscht
    const blob = exportXlsx_(ctx.ss.getId()).setName('Selbsttest_Export.xlsx');
    const f = folder_(ctx, 'BACKUP_FOLDER_ID', 'Sicherungen').createFile(blob);
    const kb = Math.round(blob.getBytes().length / 1024);
    f.setTrashed(true);
    return 'Excel-Datei ' + kb + ' KB erzeugt und im Ordner "Sicherungen" abgelegt (Testdatei wieder gelöscht)';
  });
  check('E-Mail', function () {
    const s = settings_(ctx);
    if (!s.recipients) throw new Error('Kein Empfänger im Blatt "Einstellungen"');
    const before = MailApp.getRemainingDailyQuota();
    const ok = sendTestMail_(ctx, rec, s);
    return ok + ' (heute noch ' + (before - 1) + ' E-Mails frei)';
  });
  check('Automatik (Sicherung, Wochenliste, E-Mail-Wiederholung)', function () {
    const on = ScriptApp.getProjectTriggers().some(function (tr) { return tr.getHandlerFunction() === 'wartung'; });
    if (!on) throw new Error('NICHT eingeschaltet – ohne sie gibt es keine tägliche Sicherung. Menü "3. Automatik einschalten"');
    const last = ctx.props.getProperty('LAST_BACKUP');
    if (!last) return 'eingeschaltet; die erste automatische Sicherung kommt in der nächsten Nacht';
    const age = Math.round((Date.parse(todayIso + 'T12:00:00Z') - Date.parse(last + 'T12:00:00Z')) / 86400000);
    if (age > 2) throw new Error('eingeschaltet, aber die letzte Sicherung ist vom ' + fmtDate_(last) + ' (vor ' + age + ' Tagen) – bitte Blatt "Protokoll" prüfen');
    return 'eingeschaltet; letzte automatische Sicherung: ' + fmtDate_(last);
  });
  const msg = 'Selbsttest ' + nowText_() + '\n\n' + lines.join('\n\n');
  logEvent_('INFO', msg.replace(/\n+/g, ' | '));
  notify_(msg);
  return msg;
}

function sendTestMail_(ctx, rec, s) {
  const ids = parseJson_(rec.docIds) || {};
  const attachments = [];
  if (ids.de) {
    if (s.attachWord) { attachments.push(exportDocx_(ids.de, 'SELBSTTEST_DE.docx')); attachments.push(exportDocx_(ids.orig, 'SELBSTTEST_AR.docx')); }
    if (s.attachPdf) { attachments.push(exportPdf_(ids.de, 'SELBSTTEST_DE.pdf')); attachments.push(exportPdf_(ids.orig, 'SELBSTTEST_AR.pdf')); }
  }
  MailApp.sendEmail({
    to: s.recipients, subject: 'SELBSTTEST Leistungsnachweis-App', name: 'Leistungsnachweis-App',
    htmlBody: mailHtml_(ctx, rec, [], ['Dies ist ein Selbsttest. Es wurde kein Nachweis gespeichert.']),
    body: 'Selbsttest der Leistungsnachweis-App', attachments: attachments
  });
  return 'gesendet an ' + s.recipients + ' mit ' + attachments.length + ' Anhängen';
}

// =====================================================================
//  Hilfsfunktionen
// =====================================================================

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function apiError_(code, message, details) {
  const e = new Error(message || code);
  e.isApiError = true;
  e.code = code;
  e.details = details || null;
  return e;
}

/**
 * Skript-Sperre: Immer nur eine Ausführung darf gleichzeitig Tabelle, Nummernkreis und Anmelde-Zähler ändern.
 * Sperren lassen sich nicht verschachteln – SCRIPT_LOCK_HELD verhindert ein zweites Nehmen in derselben Ausführung.
 */
let SCRIPT_LOCK_HELD = false;

function takeLock_(waitMs) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(waitMs || LOCK_WAIT_MS)) throw apiError_('busy', 'Server beschäftigt – wird automatisch erneut versucht.');
  SCRIPT_LOCK_HELD = true;
  return lock;
}

function dropLock_(lock) {
  SCRIPT_LOCK_HELD = false;
  lock.releaseLock();
}

/** Arabisch-indische (U+0660 bis U+0669) und persische (U+06F0 bis U+06F9) Ziffern in 0-9 umwandeln (Handytastaturen liefern je nach Einstellung beides). */
function mapDigits_(s) {
  return String(s == null ? '' : s)
    .replace(/[\u0660-\u0669]/g, function (c) { return String(c.charCodeAt(0) - 0x0660); })
    .replace(/[\u06F0-\u06F9]/g, function (c) { return String(c.charCodeAt(0) - 0x06F0); });
}

/** PIN aus der App: nur Ziffern erlaubt (Leerzeichen und unsichtbare Schreibrichtungs-Zeichen werden ignoriert), sonst leer. */
function pinInput_(v) {
  // Leerzeichen sowie unsichtbare Schreibrichtungs-/Format-Zeichen (U+200B-200F, U+202A-202E, U+2066-2069, U+061C, U+FEFF) fallen weg
  const s = mapDigits_(v).replace(/[\s\u200B-\u200F\u202A-\u202E\u2066-\u2069\u061C\uFEFF]/g, '');
  return /^\d+$/.test(s) ? s : '';
}

/** PIN aus dem Blatt "Mitarbeiter": Leerzeichen, Bindestriche u. Ä. dürfen dort stehen und werden ignoriert. */
function sheetDigits_(v) {
  return mapDigits_(str_(v)).replace(/\D/g, '');
}

/** Kurze Warn-E-Mail ans Büro (höchstens eine pro Tag und Thema). */
function alertOffice_(ctx, subject, text) {
  try {
    const key = 'ALERT_' + Utilities.base64EncodeWebSafe(subject).slice(0, 20);
    const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
    if (ctx.props.getProperty(key) === today) return;
    ctx.props.setProperty(key, today);
    logEvent_('WARNUNG', subject + ': ' + text);
    const to = settings_(ctx).recipients;
    if (to) MailApp.sendEmail({ to: to, subject: 'Leistungsnachweis-App: ' + subject, body: text, name: 'Leistungsnachweis-App' });
  } catch (err) {
    console.error('Warnung nicht gesendet: ' + err);
  }
}

function folder_(ctx, key, name) {
  const id = ctx.props.getProperty(key);
  if (id) {
    try {
      const f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (e) { /* gelöscht → neu anlegen */ }
  }
  const parent = key === 'FOLDER_ID' ? null : folder_(ctx, 'FOLDER_ID', 'Leistungsnachweise (App)');
  const f = parent ? parent.createFolder(name) : DriveApp.createFolder(name);
  ctx.props.setProperty(key, f.getId());
  return f;
}

function monthFolder_(ctx, isoDate) {
  const root = folder_(ctx, 'FOLDER_ID', 'Leistungsnachweise (App)');
  const name = String(isoDate).slice(0, 7);
  const it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

function logEvent_(level, msg) {
  try {
    console.log(level + ': ' + msg);
    const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    if (!id) return;
    const sh = SpreadsheetApp.openById(id).getSheetByName(SHEET.LOG);
    if (!sh) return;
    if (sh.getLastRow() > 3000) sh.deleteRows(2, 1000);
    const row = sh.getLastRow() + 1;
    if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 200);
    const range = sh.getRange(row, 1, 1, 3);
    range.setNumberFormat('@');
    range.setValues([[nowText_(), level, safeCell_(trunc_(msg, 1000))]]);
  } catch (e) {
    console.error('Protokoll nicht möglich: ' + e);
  }
}

function notify_(msg) {
  console.log(msg);
  if (UI_MODE) {
    try { SpreadsheetApp.getUi().alert(msg); return; } catch (e) { /* kein Fenster möglich */ }
  }
  try { SpreadsheetApp.getActiveSpreadsheet().toast(trunc_(msg, 250), 'Leistungsnachweis', 15); } catch (e) { /* egal */ }
}

function str_(v) {
  return v == null ? '' : String(v).trim();
}

function cleanText_(v) {
  if (v == null) return '';
  return String(v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\n{4,}/g, '\n\n\n').trim();
}

/** "1 Nachweis" / "3 Nachweise" */
function pl_(n, one, many) {
  return n + ' ' + (n === 1 ? one : many);
}

function trunc_(s, n) {
  s = s == null ? '' : String(s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function isYes_(v) {
  if (v === true) return true;
  return /^(ja|j|x|yes|y|true|wahr|1|aktiv)$/i.test(str_(v));
}

function isIsoDate_(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T12:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function isTime_(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

function toMin_(t) {
  const p = String(t).split(':');
  return Number(p[0]) * 60 + Number(p[1]);
}

function isoDateOffset_(days) {
  return Utilities.formatDate(new Date(Date.now() + days * 86400000), TZ, 'yyyy-MM-dd');
}

function nowText_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
}

function fmtDate_(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? m[3] + '.' + m[2] + '.' + m[1] : String(iso || '');
}

function fmtDateTime_(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2})/.exec(String(s || ''));
  return m ? m[3] + '.' + m[2] + '.' + m[1] + ' ' + m[4] : String(s || '');
}

function fmtDuration_(min) {
  min = Math.max(0, Math.round(Number(min) || 0));
  const m = min % 60;
  return Math.floor(min / 60) + ':' + (m < 10 ? '0' : '') + m;
}

function fill_(tpl, vars) {
  return String(tpl).replace(/\{(\w+)\}/g, function (_, k) { return vars[k] == null ? '' : String(vars[k]); });
}

function parseJson_(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch (e) { return null; }
}

function parseEmails_(v) {
  return str_(v).split(/[\s,;]+/).filter(function (x) { return /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(x); }).join(',');
}

function escHtml_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function nl2br_(s) {
  return String(s).replace(/\n/g, '<br>');
}

function decodeEntities_(s) {
  return String(s)
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCodePoint(Number(n)); })
    .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCodePoint(parseInt(n, 16)); })
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

function errText_(err) {
  return err && err.message ? String(err.message) : String(err);
}

// =====================================================================
//  Testfoto für den Selbsttest (JPEG 480 × 360 px). Es wird bei jedem Selbsttest
//  neu in den Ordner "Selbsttest" gelegt und muss im Word und im PDF zu sehen sein.
// =====================================================================
const TEST_PHOTO_B64 = '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';

// =====================================================================
//  Firmenlogo Dagho Bau (PNG 480 × 294 px, Türkis #33B6B3 auf transparent),
//  aus dem Firmenlogo vektorisiert – dieselbe Vorlage wie app/icons/logo.svg.
// =====================================================================
const LOGO_PNG_B64 = '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';
