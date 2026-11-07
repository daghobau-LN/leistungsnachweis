/* =====================================================================
   Leistungsnachweis – Handy-App (PWA)
   Läuft im Browser, speichert offline, sendet an Google Apps Script.
   Keine externen Bibliotheken, keine Tracker, keine Cookies.
   ===================================================================== */
(function () {
  'use strict';

  // Schutz vor Einbettung in fremde Seiten (Clickjacking): GitHub Pages kann keinen X-Frame-Options-Header setzen.
  // Nur die eingebettete Vorschau (LN_EMBED, im Produktivbetrieb nie gesetzt) darf in einem Rahmen laufen.
  if (window.top !== window.self && !window.LN_EMBED) {
    document.documentElement.style.display = 'none';
    return;
  }

  const APP_VERSION = '1.2.1';
  const PHOTO_MAX = 3;          // höchstens 3 Fotos je Nachweis (muss zu PHOTO_MAX im Server passen)
  const PHOTO_EDGE = 1280;      // längste Kante nach dem Verkleinern
  const PHOTO_CHARS = 300000;   // Ziel: höchstens ~300.000 Zeichen je Foto (≈ 220 KB), sonst stärker verkleinern
  const RAW_URL = String((window.LN_CONFIG && window.LN_CONFIG.serverUrl) || '').trim();
  const URL_OK = /^https:\/\/script\.google\.com\/(macros|a\/macros\/[\w.-]+)\/s\/[A-Za-z0-9_-]{20,}\/exec$/.test(RAW_URL) ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/[\w/.-]*$/.test(RAW_URL);
  const DEMO = RAW_URL === '';
  const EMBED = !!window.LN_EMBED; // eingebettete Vorschau: Navigation ohne Browser-Verlauf
  // In der eingebetteten Vorschau ist das Mikrofon gesperrt → dort nur der Hinweis auf das Tastatur-Mikrofon
  const SR = EMBED ? null : (window.SpeechRecognition || window.webkitSpeechRecognition || null);
  const CONFIG_ERROR = !DEMO && !URL_OK;
  const SERVER = URL_OK ? RAW_URL : '';
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // Arabische Tastaturen liefern je nach Einstellung arabisch-indische (U+0660..0669) oder persische (U+06F0..06F9) Ziffern -> 0-9; alles andere faellt weg
  const normDigits = (v) => String(v == null ? '' : v)
    .replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x660))
    .replace(/[\u06F0-\u06F9]/g, (c) => String(c.charCodeAt(0) - 0x6F0))
    .replace(/\D/g, '');
  const PIN_MIN = 6; // Mitarbeiter 6, Büro 8 Ziffern (der Server prüft die Rolle)

  // ===================================================================
  //  Texte (Arabisch, Kurdisch-Kurmancî, Deutsch)
  // ===================================================================
  const I18N = {
    de: {
      app: 'Leistungsnachweis', langTitle: 'Sprache wählen',
      loginTitle: 'Anmelden', loginHint: 'Gib deine PIN ein. Du bekommst sie vom Büro.', pin: 'PIN', showPin: 'PIN zeigen',
      loginBtn: 'Anmelden', wrongPin: 'Diese PIN stimmt nicht. Bitte noch einmal versuchen.',
      tooMany: 'Zu viele falsche Versuche. Bitte 10 Minuten warten.', tooManyDay: 'Heute zu viele falsche Versuche. Bitte im Büro melden.',
      errLimit: 'Für heute wurden schon sehr viele Nachweise gesendet. Bitte im Büro melden.',
      pinDuplicate: 'Diese PIN ist doppelt vergeben. Bitte im Büro melden.',
      needOnline: 'Für die Anmeldung braucht das Handy Internet.',
      privacy: 'Deine Angaben werden nur für die Arbeitszeit- und Leistungsnachweise der Firma verwendet.',
      demoHint: 'Demo-Modus: Es wird nichts gesendet. PIN 111111 = Mitarbeiter Arabisch, 222222 = Mitarbeiter Kurdisch, 99999999 = Büro.',
      configError: 'Die Server-Adresse in config.js ist ungültig. Sie muss mit https://script.google.com/macros/s/ beginnen und auf /exec enden.',
      hello: 'Hallo {name}', newReport: 'Neuer Nachweis', myReports: 'Meine Nachweise', allMine: 'Alle meine Nachweise',
      noReports: 'Noch keine Nachweise. Tippe auf „Neuer Nachweis“.',
      pendingOne: 'Ein Nachweis ist noch nicht gesendet und wartet auf Internet.',
      pendingMany: '{n} Nachweise sind noch nicht gesendet und warten auf Internet.',
      errorItems: 'Ein Nachweis wurde vom Server abgelehnt. Bitte öffnen und prüfen.',
      sendNow: 'Jetzt senden', logout: 'Abmelden',
      logoutPending: 'Es gibt noch nicht gesendete Nachweise. Sie bleiben auf dem Handy und werden gesendet, wenn du dich wieder anmeldest. Trotzdem abmelden?',
      office: 'Büro', allReports: 'Alle Nachweise', excelList: 'Excel-Liste senden',
      date: 'Datum', today: 'Heute', yesterday: 'Gestern',
      project: 'Bauvorhaben', projectChoose: 'Bitte wählen', projectOther: 'Anderes Bauvorhaben',
      projectOtherPh: 'Name oder Adresse der Baustelle',
      worktime: 'Arbeitszeit', start: 'Beginn', end: 'Ende', pause: 'Pause', minutes: 'Min.', otherMin: 'Minuten',
      asLastTime: 'Wie zuletzt: {range}', netTime: 'Arbeitszeit ohne Pause', hoursUnit: 'Std.',
      hint6: 'Bei mehr als 6 Stunden Arbeit sind mindestens 30 Minuten Pause Pflicht.',
      hint9: 'Bei mehr als 9 Stunden Arbeit sind mindestens 45 Minuten Pause Pflicht.',
      hint10: 'Mehr als 10 Stunden am Tag sind nur in Ausnahmen erlaubt. Bitte mit dem Büro klären.',
      activities: 'Was hast du gemacht?', activitiesHint: 'Alles antippen, was passt.', activitiesShort: 'Tätigkeiten',
      description: 'Beschreibung', descriptionPh: 'Was genau? Wo? Wie viel? (z. B. 2. OG, 40 m² Gipskarton)',
      material: 'Material / Geräte', optional: 'freiwillig', materialPh: 'z. B. 20 Platten, Bohrhammer',
      speak: 'Sprechen', stopSpeak: 'Fertig', listening: 'Ich höre zu …',
      micHint: 'Tipp: Du kannst auch das Mikrofon auf der Tastatur benutzen.',
      micDenied: 'Kein Zugriff auf das Mikrofon. Bitte in den Einstellungen erlauben.',
      micLang: 'Spracheingabe gibt es für diese Sprache hier nicht. Bitte das Mikrofon der Tastatur benutzen.',
      micNet: 'Spracheingabe braucht Internet. Bitte tippen oder das Mikrofon der Tastatur benutzen.',
      micFail: 'Spracheingabe hat nicht geklappt. Bitte noch einmal.',
      sigEmployee: 'Deine Unterschrift', sigClient: 'Unterschrift Auftraggeber / Bauleitung',
      sigHere: 'Hier mit dem Finger unterschreiben', sigClear: 'Löschen',
      sigPresent: 'Unterschrift vorhanden (Version {v})', sigNew: 'Neu unterschreiben', sigRemove: 'Entfernen',
      sigRemoved: 'Unterschrift wird entfernt', clientName: 'Name des Unterzeichners',
      addClientSig: 'Auftraggeber unterschreiben lassen',
      photos: 'Fotos', photosHint: 'Erst mit der Kamera fotografieren, dann hier hochladen. Höchstens {n} Fotos.',
      photoUpload: 'Foto hochladen', photoRemove: 'Foto entfernen',
      photoLabel: 'Foto {n}', photoSaved: 'Foto {n} (schon gesendet)', photoMax: 'Es gehen höchstens {n} Fotos.',
      photoWorking: 'Foto wird vorbereitet …', photoFail: 'Das Foto hat nicht geklappt. Bitte noch einmal.',
      photoCount: '{n} Fotos', photoOne: '1 Foto', photoNone: 'keine',
      send: 'Senden', sendCorrection: 'Korrektur senden', cancel: 'Abbrechen', back: 'Zurück', ok: 'OK',
      required: 'Bitte ausfüllen.', endAfterStart: 'Das Ende muss nach dem Beginn liegen.',
      pauseTooLong: 'Die Pause ist länger als die Arbeitszeit.', pauseInvalid: 'Bitte die Pause in Minuten angeben (0 bis 600).',
      needActivity: 'Bitte eine Tätigkeit antippen oder eine Beschreibung schreiben.',
      tooLong: 'Der Text ist zu lang.', dateFuture: 'Das Datum liegt in der Zukunft.',
      dateOld: 'Achtung: Das Datum liegt {n} Tage zurück.', fixErrors: 'Bitte die rot markierten Felder prüfen.',
      draftRestored: 'Dein Entwurf wurde wiederhergestellt.',
      draftStale: 'Der Nachweis wurde inzwischen geändert. Dein alter Entwurf wurde verworfen – hier siehst du den aktuellen Stand.', discardDraft: 'Verwerfen', discardConfirm: 'Alle Eingaben verwerfen?',
      sending: 'Wird gesendet …', sendingLong: 'Das kann bis zu einer Minute dauern. Der Nachweis ist schon auf dem Handy gespeichert.',
      continueBg: 'Im Hintergrund weiter senden',
      sentTitle: 'Gesendet', sentText: 'Nachweis {id} ist gespeichert und ans Büro geschickt.',
      sentNoMail: 'Nachweis {id} ist gespeichert. Die E-Mail ans Büro wird automatisch nachgeholt.',
      sentDemo: 'Demo: Im echten Betrieb geht jetzt eine E-Mail mit Word- und PDF-Datei (Original und Deutsch) ans Büro.',
      queuedTitle: 'Auf dem Handy gespeichert',
      queuedText: 'Gerade kein Internet. Der Nachweis wird automatisch gesendet, sobald die App wieder Internet hat.',
      queuedTip: 'Wichtig: Öffne die App später einmal mit Internet.',
      bgTitle: 'Wird gesendet', bgText: 'Der Nachweis ist auf dem Handy gespeichert und wird im Hintergrund gesendet. Den Stand siehst du in der Übersicht.',
      noChanges: 'Keine Änderungen – es wurde nichts gesendet.', alreadyThere: 'Dieser Nachweis war schon beim Büro angekommen. Falls du danach noch etwas geändert hast: bitte über „Bearbeiten“ wiederholen.',
      toOverview: 'Zur Übersicht', anotherReport: 'Noch ein Nachweis',
      errLocked: 'Dieser Nachweis ist vom Büro freigegeben. Änderungen nur noch über das Büro.',
      errConflict: 'Der Nachweis wurde inzwischen geändert. Bitte neu öffnen und noch einmal ändern.',
      errInvalid: 'Der Server hat den Nachweis abgelehnt. Bitte öffnen und die Eingaben prüfen.',
      errNotFound: 'Nachweis nicht gefunden.', errAuth: 'Bitte neu anmelden.',
      errGeneric: 'Das hat nicht geklappt. Bitte später noch einmal versuchen.',
      errStorage: 'Der Speicher des Handys ist voll. Der Nachweis konnte nicht gespeichert werden.',
      noStorage: 'Dieser Browser erlaubt kein Speichern (privater Modus?). Ohne Internet gesendete Nachweise gehen beim Schließen verloren. Bitte die App normal öffnen.',
      errOffline: 'Kein Internet. Bitte später noch einmal versuchen.',
      offlineDetail: 'Ohne Internet sind nur die gespeicherten Angaben sichtbar.', offline: 'Offline',
      offlineStrip: 'Kein Internet. Gesendet wird später.',
      errBusy: 'Der Server ist gerade beschäftigt. Bitte in einer Minute noch einmal versuchen.',
      testLink: 'Verbindung testen', testOk: 'Alles in Ordnung', testProblem: 'Es gibt ein Problem. Bitte den Bericht an das Büro schicken.',
      st_eingereicht: 'Eingereicht', st_korrigiert: 'Korrigiert', st_freigegeben: 'Freigegeben',
      st_pending: 'Wartet auf Internet', st_error: 'Fehler – bitte öffnen',
      version: 'Version', edit: 'Bearbeiten', germanTranslation: 'Deutsche Übersetzung', original: 'Original',
      signatures: 'Unterschriften', yes: 'ja', no: 'nein', lockedNote: 'Vom Büro freigegeben – keine Änderung mehr möglich.',
      discardQueued: 'Nicht gesendeten Nachweis löschen', discardQueuedConfirm: 'Diesen Nachweis wirklich löschen? Er wurde noch nicht gesendet.',
      deleted: 'Gelöscht.', number: 'Nr.', loading: 'Wird geladen …', retry: 'Erneut versuchen',
      updateAvail: 'Neue Version verfügbar.', reload: 'Neu laden',
      installTip: 'Tipp: Im Browser-Menü „Zum Startbildschirm hinzufügen“ wählen. Dann öffnet sich die App wie eine normale App.',
      changeLang: 'Sprache', demoTranslation: 'Im Demo-Modus wird nicht übersetzt. Im echten Betrieb übersetzt Google automatisch.',
      // Büro
      approve: 'Freigeben', unapprove: 'Freigabe aufheben', resend: 'E-Mail erneut senden',
      docDe: 'Dokument Deutsch', docOrig: 'Dokument Original', mailStatus: 'E-Mail', from: 'Von', to: 'Bis',
      employee: 'Mitarbeiter', all: 'Alle', status: 'Status', show: 'Anzeigen', exportTitle: 'Excel-Liste per E-Mail',
      exportHint: 'Alle Nachweise im Zeitraum als Excel-Datei an die eingetragene Adresse.',
      exportDone: 'Excel-Liste mit {n} Nachweisen an {to} gesendet.', approved: 'Freigegeben.', unapproved: 'Freigabe aufgehoben.',
      resent: 'E-Mail wurde erneut gesendet.', resentFail: 'E-Mail konnte nicht gesendet werden. Status in der Tabelle prüfen.',
      translationEdit: 'Deutsche Übersetzung (bei Bedarf korrigieren)',
      translationNote: 'Wenn nur der Originaltext geändert wird, übersetzt der Server automatisch neu.',
      sumLine: '{n} Nachweise, {h} Std.', lastWeek: 'Letzte Woche', thisMonth: 'Dieser Monat', changedBy: 'Geändert von',
      created: 'Erstellt', projectDeLabel: 'Bauvorhaben (Deutsch)'
    },
    ar: {
      app: 'تقرير العمل', langTitle: 'اختر اللغة',
      loginTitle: 'تسجيل الدخول', loginHint: 'أدخل رقمك السري (PIN). تحصل عليه من المكتب.', pin: 'الرقم السري', showPin: 'إظهار الرقم',
      loginBtn: 'دخول', wrongPin: 'الرقم السري غير صحيح. حاول مرة أخرى.',
      tooMany: 'محاولات خاطئة كثيرة. انتظر 10 دقائق من فضلك.', tooManyDay: 'محاولات خاطئة كثيرة اليوم. أبلغ المكتب.',
      errLimit: 'تم إرسال عدد كبير جداً من التقارير اليوم. أبلغ المكتب.',
      pinDuplicate: 'هذا الرقم السري مُعطى لشخصين. أبلغ المكتب.',
      needOnline: 'تحتاج إلى الإنترنت لتسجيل الدخول.',
      privacy: 'تُستخدم بياناتك فقط لتقارير العمل وساعات العمل الخاصة بالشركة.',
      demoHint: 'وضع التجربة: لا يُرسل شيء. الرقم 111111 = عامل (عربي)، 222222 = عامل (كردي)، 99999999 = المكتب.',
      hello: 'مرحباً {name}', newReport: 'تقرير جديد', myReports: 'تقاريري', allMine: 'كل تقاريري',
      noReports: 'لا توجد تقارير بعد. اضغط على «تقرير جديد».',
      pendingOne: 'هناك تقرير لم يُرسل بعد، بانتظار الإنترنت.',
      pendingMany: '{n} تقارير لم تُرسل بعد، بانتظار الإنترنت.',
      errorItems: 'رفض الخادم أحد التقارير. افتحه وتحقق منه.',
      sendNow: 'أرسل الآن', logout: 'تسجيل الخروج',
      logoutPending: 'هناك تقارير لم تُرسل بعد. ستبقى على الهاتف وتُرسل عندما تسجّل الدخول مرة أخرى. هل تريد الخروج؟',
      office: 'المكتب', allReports: 'كل التقارير', excelList: 'إرسال قائمة إكسل',
      date: 'التاريخ', today: 'اليوم', yesterday: 'أمس',
      project: 'المشروع (موقع العمل)', projectChoose: 'اختر المشروع', projectOther: 'مشروع آخر',
      projectOtherPh: 'اسم أو عنوان موقع العمل',
      worktime: 'وقت العمل', start: 'البداية', end: 'النهاية', pause: 'الاستراحة', minutes: 'دقيقة', otherMin: 'دقائق',
      asLastTime: 'مثل آخر مرة: {range}', netTime: 'ساعات العمل بدون استراحة', hoursUnit: 'ساعة',
      hint6: 'إذا عملت أكثر من 6 ساعات فالاستراحة 30 دقيقة على الأقل إلزامية.',
      hint9: 'إذا عملت أكثر من 9 ساعات فالاستراحة 45 دقيقة على الأقل إلزامية.',
      hint10: 'العمل أكثر من 10 ساعات في اليوم مسموح فقط في حالات استثنائية. راجع المكتب.',
      activities: 'ماذا عملت اليوم؟', activitiesHint: 'اضغط على كل ما ينطبق.', activitiesShort: 'الأعمال المنفذة',
      description: 'الوصف', descriptionPh: 'ماذا بالضبط؟ أين؟ كم؟ (مثلاً: الطابق الثاني، 40 م² جبس بورد)',
      material: 'المواد / المعدات', optional: 'اختياري', materialPh: 'مثلاً: 20 لوح، شنيور',
      speak: 'تحدّث', stopSpeak: 'إيقاف', listening: 'أستمع …',
      micHint: 'نصيحة: يمكنك أيضاً استخدام الميكروفون الموجود في لوحة المفاتيح.',
      micDenied: 'لا يوجد إذن للميكروفون. اسمح به من الإعدادات.',
      micLang: 'الإدخال الصوتي غير متاح لهذه اللغة هنا. استخدم ميكروفون لوحة المفاتيح.',
      micNet: 'الإدخال الصوتي يحتاج إلى إنترنت. اكتب أو استخدم ميكروفون لوحة المفاتيح.',
      micFail: 'لم ينجح الإدخال الصوتي. حاول مرة أخرى.',
      sigEmployee: 'توقيعك', sigClient: 'توقيع صاحب العمل / مدير الموقع',
      sigHere: 'وقّع هنا بإصبعك', sigClear: 'مسح',
      sigPresent: 'التوقيع موجود (النسخة {v})', sigNew: 'توقيع جديد', sigRemove: 'إزالة',
      sigRemoved: 'سيتم حذف التوقيع', clientName: 'اسم الموقّع',
      addClientSig: 'اطلب توقيع صاحب العمل',
      photos: 'الصور', photosHint: 'صوّر أولاً بالكاميرا، ثم ارفع الصورة هنا. {n} صور كحد أقصى.',
      photoUpload: 'رفع صورة', photoRemove: 'حذف الصورة',
      photoLabel: 'صورة {n}', photoSaved: 'صورة {n} (أُرسلت من قبل)', photoMax: 'الحد الأقصى {n} صور.',
      photoWorking: 'يتم تجهيز الصورة …', photoFail: 'لم تنجح الصورة. حاول مرة أخرى.',
      photoCount: '{n} صور', photoOne: 'صورة واحدة', photoNone: 'لا يوجد',
      send: 'إرسال', sendCorrection: 'إرسال التصحيح', cancel: 'إلغاء', back: 'رجوع', ok: 'حسناً',
      required: 'هذا الحقل مطلوب.', endAfterStart: 'يجب أن تكون النهاية بعد البداية.',
      pauseTooLong: 'الاستراحة أطول من وقت العمل.', pauseInvalid: 'أدخل الاستراحة بالدقائق (من 0 إلى 600).',
      needActivity: 'اختر عملاً واحداً على الأقل أو اكتب وصفاً.',
      tooLong: 'النص طويل جداً.', dateFuture: 'التاريخ في المستقبل.',
      dateOld: 'انتبه: التاريخ قبل {n} أيام.', fixErrors: 'يرجى التحقق من الحقول المحددة باللون الأحمر.',
      draftRestored: 'تمت استعادة المسودة.',
      draftStale: 'تم تعديل التقرير في الأثناء. حُذفت مسودتك القديمة، وهذه هي البيانات الحالية.', discardDraft: 'حذف المسودة', discardConfirm: 'هل تريد حذف كل ما أدخلته؟',
      sending: 'جارٍ الإرسال …', sendingLong: 'قد يستغرق ذلك حتى دقيقة. التقرير محفوظ على الهاتف.',
      continueBg: 'تابع الإرسال في الخلفية',
      sentTitle: 'تم الإرسال', sentText: 'التقرير {id} محفوظ وتم إرساله إلى المكتب.',
      sentNoMail: 'التقرير {id} محفوظ. سيتم إرسال البريد إلى المكتب تلقائياً لاحقاً.',
      sentDemo: 'تجربة: في الاستخدام الحقيقي يُرسل الآن بريد إلكتروني مع ملف وورد و PDF (الأصل والألماني) إلى المكتب.',
      queuedTitle: 'محفوظ على الهاتف',
      queuedText: 'لا يوجد إنترنت الآن. سيتم إرسال التقرير تلقائياً عندما يتوفر الإنترنت للتطبيق.',
      queuedTip: 'مهم: افتح التطبيق لاحقاً مرة واحدة مع وجود الإنترنت.',
      bgTitle: 'جارٍ الإرسال', bgText: 'التقرير محفوظ على الهاتف ويُرسل في الخلفية. يمكنك رؤية الحالة في الصفحة الرئيسية.',
      noChanges: 'لا توجد تغييرات – لم يُرسل شيء.', alreadyThere: 'هذا التقرير كان قد وصل إلى المكتب من قبل. إذا غيّرت شيئاً بعد ذلك فأعده عبر «تعديل».',
      toOverview: 'إلى الصفحة الرئيسية', anotherReport: 'تقرير آخر',
      errLocked: 'تم اعتماد هذا التقرير من المكتب. التعديل فقط عبر المكتب.',
      errConflict: 'تم تعديل التقرير في الأثناء. افتحه من جديد وعدّل مرة أخرى.',
      errInvalid: 'رفض الخادم التقرير. افتحه وتحقق من البيانات.',
      errNotFound: 'التقرير غير موجود.', errAuth: 'يرجى تسجيل الدخول من جديد.',
      errGeneric: 'لم ينجح ذلك. حاول لاحقاً مرة أخرى.',
      errStorage: 'ذاكرة الهاتف ممتلئة. لم يتم حفظ التقرير.',
      noStorage: 'هذا المتصفح لا يسمح بالحفظ (وضع التصفح الخاص؟). التقارير غير المرسلة تضيع عند الإغلاق. افتح التطبيق بشكل عادي.',
      errOffline: 'لا يوجد إنترنت. حاول لاحقاً مرة أخرى.',
      offlineDetail: 'بدون إنترنت تظهر فقط البيانات المحفوظة.', offline: 'بدون إنترنت',
      offlineStrip: 'لا يوجد إنترنت. سيتم الإرسال لاحقاً.',
      errBusy: 'الخادم مشغول الآن. حاول مرة أخرى بعد دقيقة.',
      testLink: 'اختبار الاتصال', testOk: 'كل شيء على ما يرام', testProblem: 'توجد مشكلة. يرجى إرسال التقرير إلى المكتب.',
      st_eingereicht: 'مُرسَل', st_korrigiert: 'مُصحَّح', st_freigegeben: 'معتمَد',
      st_pending: 'بانتظار الإنترنت', st_error: 'خطأ – افتح التقرير',
      version: 'النسخة', edit: 'تعديل', germanTranslation: 'الترجمة الألمانية', original: 'الأصل',
      signatures: 'التواقيع', yes: 'نعم', no: 'لا', lockedNote: 'معتمد من المكتب – لا يمكن التعديل بعد الآن.',
      discardQueued: 'حذف التقرير غير المرسل', discardQueuedConfirm: 'هل تريد فعلاً حذف هذا التقرير؟ لم يُرسل بعد.',
      deleted: 'تم الحذف.', number: 'رقم', loading: 'جارٍ التحميل …', retry: 'حاول مرة أخرى',
      updateAvail: 'نسخة جديدة متاحة.', reload: 'إعادة التحميل',
      installTip: 'نصيحة: من قائمة المتصفح اختر «إضافة إلى الشاشة الرئيسية». عندها يفتح التطبيق مثل أي تطبيق عادي.',
      changeLang: 'اللغة', demoTranslation: 'في وضع التجربة لا تتم الترجمة. في الاستخدام الحقيقي يترجم Google تلقائياً.'
    },
    ku: {
      app: 'Rapora kar', langTitle: 'Ziman hilbijêre',
      loginTitle: 'Têketin', loginHint: 'PIN-a xwe binivîse. Tu wê ji ofîsê distînî.', pin: 'PIN', showPin: 'PIN nîşan bide',
      loginBtn: 'Têkeve', wrongPin: 'Ev PIN ne rast e. Ji kerema xwe dîsa biceribîne.',
      tooMany: 'Gelek hewldanên şaş. Ji kerema xwe 10 deqîqe bisekine.', tooManyDay: 'Îro gelek hewldanên şaş. Ji ofîsê re bêje.',
      errLimit: 'Îro pir zêde rapor hatin şandin. Ji ofîsê re bêje.',
      pinDuplicate: 'Ev PIN du caran hatiye dayîn. Ji ofîsê re bêje.',
      needOnline: 'Ji bo têketinê înternet pêwîst e.',
      privacy: 'Agahiyên te tenê ji bo raporên kar û demên kar ên şirketê tên bikaranîn.',
      demoHint: 'Moda ceribandinê: tiştek nayê şandin. PIN 111111 = karker (erebî), 222222 = karker (kurdî), 99999999 = ofîs.',
      hello: 'Silav {name}', newReport: 'Raporek nû', myReports: 'Raporên min', allMine: 'Hemû raporên min',
      noReports: 'Hîn rapor tune. Li ser «Raporek nû» bitikîne.',
      pendingOne: 'Raporek hîn nehatiye şandin û li benda înternetê ye.',
      pendingMany: '{n} rapor hîn nehatine şandin û li benda înternetê ne.',
      errorItems: 'Server raporek red kir. Ji kerema xwe veke û kontrol bike.',
      sendNow: 'Niha bişîne', logout: 'Derkeve',
      logoutPending: 'Hîn raporên neşandî hene. Ew li ser telefonê dimînin û dema tu dîsa têkevî tên şandin. Dîsa jî derkevî?',
      office: 'Ofîs', allReports: 'Hemû rapor', excelList: 'Lîsteya Excel bişîne',
      date: 'Dîrok', today: 'Îro', yesterday: 'Duh',
      project: 'Proje (cihê kar)', projectChoose: 'Projeyê hilbijêre', projectOther: 'Projeyeke din',
      projectOtherPh: 'Nav an navnîşana cihê kar',
      worktime: 'Dema kar', start: 'Destpêk', end: 'Dawî', pause: 'Bêhnvedan', minutes: 'deq.', otherMin: 'deqîqe',
      asLastTime: 'Wek cara dawî: {range}', netTime: 'Dema kar bê bêhnvedan', hoursUnit: 'saet',
      hint6: 'Ji 6 saetan zêdetir kar: herî kêm 30 deqîqe bêhnvedan mecbûrî ye.',
      hint9: 'Ji 9 saetan zêdetir kar: herî kêm 45 deqîqe bêhnvedan mecbûrî ye.',
      hint10: 'Ji 10 saetan zêdetir di rojekê de tenê di rewşên awarte de destûr e. Bi ofîsê re biaxive.',
      activities: 'Te îro çi kir?', activitiesHint: 'Li ser her tiştê ku li hev tê bitikîne.', activitiesShort: 'Karên hatine kirin',
      description: 'Danasîn', descriptionPh: 'Bi rastî çi? Li ku? Çiqas? (mînak: qata 2., 40 m² alçîpan)',
      material: 'Malzeme / amûr', optional: 'ne mecbûrî', materialPh: 'mînak: 20 plaka, matkab',
      speak: 'Biaxive', stopSpeak: 'Bes e', listening: 'Guhdarî dikim …',
      micHint: 'Şîret: Tu dikarî mîkrofona li ser klavyeyê jî bi kar bînî.',
      micDenied: 'Destûra mîkrofonê tune. Ji kerema xwe di mîhengan de destûr bide.',
      micLang: 'Ji bo vî zimanî li vir nivîsandina bi deng tune. Mîkrofona klavyeyê bi kar bîne.',
      micNet: 'Nivîsandina bi deng înternet dixwaze. Binivîse an mîkrofona klavyeyê bi kar bîne.',
      micFail: 'Nivîsandina bi deng bi ser neket. Dîsa biceribîne.',
      sigEmployee: 'Îmzeya te', sigClient: 'Îmzeya xwediyê kar / berpirsê cih',
      sigHere: 'Li vir bi tiliya xwe îmze bike', sigClear: 'Jê bibe',
      sigPresent: 'Îmze heye (guherto {v})', sigNew: 'Ji nû ve îmze bike', sigRemove: 'Rake',
      sigRemoved: 'Îmze dê were rakirin', clientName: 'Navê kesê ku îmze dike',
      addClientSig: 'Bila xwediyê kar îmze bike',
      photos: 'Wêne', photosHint: 'Pêşî bi kamerayê wêne bikişîne, paşê li vir bar bike. Herî zêde {n} wêne.',
      photoUpload: 'Wêne bar bike', photoRemove: 'Wêne rake',
      photoLabel: 'Wêne {n}', photoSaved: 'Wêne {n} (berê hat şandin)', photoMax: 'Herî zêde {n} wêne dibin.',
      photoWorking: 'Wêne tê amadekirin …', photoFail: 'Wêne pêk nehat. Ji kerema xwe dîsa biceribîne.',
      photoCount: '{n} wêne', photoOne: '1 wêne', photoNone: 'tune',
      send: 'Bişîne', sendCorrection: 'Rastkirinê bişîne', cancel: 'Betal bike', back: 'Vegere', ok: 'Baş e',
      required: 'Ev qad pêwîst e.', endAfterStart: 'Dawî divê piştî destpêkê be.',
      pauseTooLong: 'Bêhnvedan ji dema kar dirêjtir e.', pauseInvalid: 'Bêhnvedanê bi deqîqeyan binivîse (0 heta 600).',
      needActivity: 'Karekî hilbijêre an danasînekê binivîse.',
      tooLong: 'Nivîs pir dirêj e.', dateFuture: 'Dîrok di pêşerojê de ye.',
      dateOld: 'Hay jê hebe: dîrok {n} roj berê ye.', fixErrors: 'Ji kerema xwe qadên sor kontrol bike.',
      draftRestored: 'Pêşnûmeya te hate vegerandin.',
      draftStale: 'Rapor di vê navberê de hat guhertin. Pêşnûmeya te ya kevn hate avêtin; daneyên heyî têne nîşandan.', discardDraft: 'Pêşnûmeyê bavêje', discardConfirm: 'Hemû nivîsandinan bavêjî?',
      sending: 'Tê şandin …', sendingLong: 'Dibe ku heta deqîqeyekê bikişîne. Rapor jixwe li ser telefonê hatiye tomarkirin.',
      continueBg: 'Di paşperdeyê de bişîne',
      sentTitle: 'Hat şandin', sentText: 'Rapora {id} hat tomarkirin û ji ofîsê re hat şandin.',
      sentNoMail: 'Rapora {id} hat tomarkirin. E-name dê paşê bixweber ji ofîsê re were şandin.',
      sentDemo: 'Ceribandin: Di karê rastîn de niha e-nameyek bi pelên Word û PDF (orîjînal û almanî) diçe ofîsê.',
      queuedTitle: 'Li ser telefonê hat tomarkirin',
      queuedText: 'Niha înternet tune. Dema ku sepan dîsa înternet bibîne, rapor dê bixweber were şandin.',
      queuedTip: 'Girîng: Paşê carekê sepanê bi înternetê veke.',
      bgTitle: 'Tê şandin', bgText: 'Rapor li ser telefonê hatiye tomarkirin û di paşperdeyê de tê şandin. Rewşê li rûpela sereke dibînî.',
      noChanges: 'Guhertin tune – tiştek nehat şandin.', alreadyThere: 'Ev rapor berê gihîştibû ofîsê. Heke te paşê tiştek guhertibe, bi «Biguherîne» dubare bike.',
      toOverview: 'Rûpela sereke', anotherReport: 'Raporeke din',
      errLocked: 'Ev rapor ji aliyê ofîsê ve hat pejirandin. Guhertin tenê bi rêya ofîsê.',
      errConflict: 'Rapor di vê navberê de hat guhertin. Ji nû ve veke û dîsa biguherîne.',
      errInvalid: 'Server rapor red kir. Veke û agahiyan kontrol bike.',
      errNotFound: 'Rapor nehat dîtin.', errAuth: 'Ji kerema xwe dîsa têkeve.',
      errGeneric: 'Bi ser neket. Paşê dîsa biceribîne.',
      errStorage: 'Bîra telefonê tije ye. Rapor nehat tomarkirin.',
      noStorage: 'Ev gerok destûrê nade tomarkirinê (moda taybet?). Raporên neşandî dema girtinê winda dibin. Sepanê bi awayê asayî veke.',
      errOffline: 'Înternet tune. Paşê dîsa biceribîne.',
      offlineDetail: 'Bê înternet tenê agahiyên tomarkirî xuya dibin.', offline: 'Bê înternet',
      offlineStrip: 'Înternet tune. Şandin paşê pêk tê.',
      errBusy: 'Server niha mijûl e. Piştî deqeyekê dîsa biceribîne.',
      testLink: 'Girêdanê biceribîne', testOk: 'Her tişt baş e', testProblem: 'Pirsgirêkek heye. Ji kerema xwe raporê ji ofîsê re bişîne.',
      st_eingereicht: 'Hat şandin', st_korrigiert: 'Hat rastkirin', st_freigegeben: 'Pejirandî',
      st_pending: 'Li benda înternetê', st_error: 'Çewtî – veke',
      version: 'Guherto', edit: 'Biguherîne', germanTranslation: 'Wergera almanî', original: 'Orîjînal',
      signatures: 'Îmze', yes: 'erê', no: 'na', lockedNote: 'Ji aliyê ofîsê ve hat pejirandin – êdî nayê guhertin.',
      discardQueued: 'Rapora neşandî jê bibe', discardQueuedConfirm: 'Bi rastî vê raporê jê bibî? Hîn nehatiye şandin.',
      deleted: 'Hat jêbirin.', number: 'Hejmar', loading: 'Tê barkirin …', retry: 'Dîsa biceribîne',
      updateAvail: 'Guhertoyeke nû heye.', reload: 'Ji nû ve bar bike',
      installTip: 'Şîret: Ji menuya gerokê «Li ekrana sereke zêde bike» hilbijêre. Wê demê sepan wek sepaneke asayî vedibe.',
      changeLang: 'Ziman', demoTranslation: 'Di moda ceribandinê de werger tune. Di karê rastîn de Google bixweber werdigerîne.'
    }
  };
  const LANG_NAMES = { ar: 'العربية', ku: 'Kurmancî', de: 'Deutsch' };

  // Textkorrekturen aus config.js (z. B. nach dem Gegenlesen durch Muttersprachler):
  //   window.LN_CONFIG.texts = { ar: { send: 'إرسال' }, ku: { … }, de: { … } }
  // Es zählen nur bekannte Schlüssel, Zeichenketten bis 500 Zeichen und dieselben {Platzhalter} wie im deutschen Text.
  // Alles andere wird ignoriert und im Gerätetest genannt. Angezeigt wird Text nie als HTML (nur als textContent).
  const TEXT_FIXES = { applied: 0, ignored: [] };
  (function applyTextFixes() {
    const fx = window.LN_CONFIG && window.LN_CONFIG.texts;
    if (fx === undefined || fx === null) return;
    if (typeof fx !== 'object' || Array.isArray(fx)) { TEXT_FIXES.ignored.push('texts (muss { de: {…}, ar: {…}, ku: {…} } sein)'); return; }
    const holders = (x) => (String(x).match(/\{\w+\}/g) || []).sort().join(',');
    Object.keys(fx).forEach((l) => { if (l !== 'de' && l !== 'ar' && l !== 'ku') TEXT_FIXES.ignored.push(l + ' (unbekannte Sprache)'); });
    ['de', 'ar', 'ku'].forEach((l) => {
      const set = fx[l];
      if (set === undefined || set === null) return;
      if (typeof set !== 'object' || Array.isArray(set)) { TEXT_FIXES.ignored.push(l + ' (muss { Schlüssel: \'Text\' } sein)'); return; }
      Object.keys(set).forEach((k) => {
        const v = set[k];
        const known = Object.prototype.hasOwnProperty.call(I18N.de, k);
        if (known && typeof v === 'string' && v.trim() && v.length <= 500 && holders(v) === holders(I18N.de[k])) { I18N[l][k] = v; TEXT_FIXES.applied += 1; }
        else TEXT_FIXES.ignored.push(l + '.' + k);
      });
    });
  })();
  const KU_WEEKDAYS = ['Yekşem', 'Duşem', 'Sêşem', 'Çarşem', 'Pêncşem', 'În', 'Şemî'];

  // ===================================================================
  //  Speicher (alle Zugriffe abgesichert – privater Modus, voller Speicher)
  // ===================================================================
  // Ist dauerhafter Speicher verfügbar? (Privater Modus / gesperrte Website-Daten → nur Arbeitsspeicher)
  const LS_OK = (() => {
    try { localStorage.setItem('ln.__test', '1'); localStorage.removeItem('ln.__test'); return true; } catch (e) { return false; }
  })();
  const mem = new Map();
  const store = {
    get(k, d) {
      try {
        const v = LS_OK ? localStorage.getItem('ln.' + k) : (mem.has(k) ? mem.get(k) : null);
        return v === null ? d : JSON.parse(v);
      } catch (e) { return d; }
    },
    set(k, v) {
      try {
        const s = JSON.stringify(v);
        if (LS_OK) localStorage.setItem('ln.' + k, s); else mem.set(k, s);
        return true;
      } catch (e) { return false; }
    },
    del(k) { try { if (LS_OK) localStorage.removeItem('ln.' + k); else mem.delete(k); } catch (e) { /* egal */ } }
  };

  const S = {
    lang: store.get('lang', null),
    auth: store.get('auth', null),
    syncing: false,
    waiters: {},
    lastResult: null,
    navDepth: 0,
    swUpdate: null,
    csp: [] // Verstöße gegen die Sicherheitsregel (Browser meldet sie) – nur Regel und Host, für den Gerätetest
  };
  const uid = () => (S.auth && S.auth.user ? S.auth.user.id : '');
  const isOffice = () => !!(S.auth && S.auth.user && S.auth.user.isOffice);
  const meta = () => store.get('meta.' + uid(), null) || { projects: [], activities: [], firma: '' };

  function t(key, vars) {
    const dict = I18N[S.lang] || I18N.de;
    let s = dict[key];
    if (s === undefined) s = I18N.de[key];
    if (s === undefined) s = key;
    return vars ? s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined || vars[k] === null ? '' : String(vars[k]))) : s;
  }

  // ===================================================================
  //  DOM-Hilfen (nie innerHTML mit Daten → kein eingeschleuster Code)
  // ===================================================================
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'value') el.value = v;
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, String(v));
      }
    }
    append(el, kids);
    return el;
  }
  function append(el, kids) {
    for (const kid of kids) {
      if (kid === null || kid === undefined || kid === false) continue;
      if (Array.isArray(kid)) append(el, kid);
      else el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
  }
  const ltr = (s, cls) => h('span', { dir: 'ltr', class: 'num' + (cls ? ' ' + cls : '') }, s);
  /** "keine" / "1 Foto" / "3 Fotos" – die Bilder selbst stehen im Word- und PDF-Dokument */
  const photoText = (n) => (n === 0 ? t('photoNone') : n === 1 ? t('photoOne') : t('photoCount', { n: n }));

  const ICONS = {
    plus: 'M12 5v14M5 12h14',
    mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
    globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    cloud: 'M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.6 1.6A3.3 3.3 0 0 0 7 18zM4 4l16 16',
    send: 'M4 12l16-8-6 16-2.5-6.5L4 12zM11.5 13.5L20 4',
    edit: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
    back: 'M15 5l-7 7 7 7',
    trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
    doc: 'M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5',
    image: 'M4 5h16v14H4zM4 16l4.5-4.5 3.5 3.5 3-3L20 16M9 9.5h.5',
    upload: 'M12 16V4M12 4 7.5 8.5M12 4l4.5 4.5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4',
    mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
    out: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
    alert: 'M12 4l9 16H3zM12 10v4M12 17v.5',
    list: 'M8 7h12M8 12h12M8 17h12M4 7h.5M4 12h.5M4 17h.5',
    sheet: 'M5 4h14v16H5zM5 9h14M5 14h14M10 4v16',
    eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
    close: 'M6 6l12 12M18 6L6 18',
    info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.5',
    dash: 'M6 12h12'
  };
  function icon(name, cls) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'ic' + (cls ? ' ' + cls : ''));
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', ICONS[name]);
    svg.appendChild(p);
    return svg;
  }

  // ===================================================================
  //  Zeit & Datum
  // ===================================================================
  const pad2 = (n) => String(n).padStart(2, '0');
  function isoOf(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function todayIso(offset) { const d = new Date(); d.setDate(d.getDate() + (offset || 0)); return isoOf(d); }
  function toMin(v) { return /^\d{2}:\d{2}$/.test(v || '') ? Number(v.slice(0, 2)) * 60 + Number(v.slice(3)) : null; }
  function fmtDur(min) { min = Math.max(0, Math.round(min || 0)); return Math.floor(min / 60) + ':' + pad2(min % 60); }
  function daysBetween(a, b) { return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000); }
  function fmtDay(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return iso || '';
    const d = new Date(iso + 'T12:00:00');
    const dm = pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.';
    let wd;
    if (S.lang === 'ku') wd = KU_WEEKDAYS[d.getDay()];
    else {
      try { wd = new Intl.DateTimeFormat(S.lang === 'ar' ? 'ar-u-nu-latn' : 'de-DE', { weekday: 'short' }).format(d); } catch (e) { wd = ''; }
    }
    return (wd ? wd + ' ' : '') + dm;
  }
  /** Wochentag + Datum; das Datum bleibt in arabischem Text als Einheit (Punkt am richtigen Platz) */
  function dayNode(iso) {
    const s = fmtDay(iso);
    const m = /^(.*?)(\d{2}\.\d{2}\.)$/.exec(s);
    return m ? [m[1], ltr(m[2])] : s;
  }
  function fmtDateFull(iso) { return /^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4) : (iso || ''); }
  function netOf(r) {
    const s = toMin(r.start); const e = toMin(r.end);
    if (s === null || e === null) return null;
    return e - s - (Number(r.pauseMin) || 0);
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = new Uint8Array(16); crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const x = Array.from(b, (n) => n.toString(16).padStart(2, '0')).join('');
    return x.slice(0, 8) + '-' + x.slice(8, 12) + '-' + x.slice(12, 16) + '-' + x.slice(16, 20) + '-' + x.slice(20);
  }

  // ===================================================================
  //  Server-Verbindung
  // ===================================================================
  class ApiError extends Error {
    constructor(code, message, details, network) { super(message || code); this.code = code; this.details = details; this.network = !!network; }
  }

  async function api(action, payload, opts) {
    if (DEMO) return demoApi(action, payload || {});
    const body = JSON.stringify(Object.assign({ action, token: S.auth ? S.auth.token : undefined }, payload || {}));
    const ctrl = new AbortController();
    const timeout = (opts && opts.timeout) || 45000; // der Server wartet bis zu 45 s auf eine belegte Sperre
    const timer = setTimeout(() => ctrl.abort(), timeout);
    let res;
    try {
      res = await fetch(SERVER, {
        method: 'POST', body, signal: ctrl.signal, redirect: 'follow', credentials: 'omit', cache: 'no-store',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' } // "einfache" Anfrage, kein CORS-Vorabtest
      });
    } catch (e) {
      // Zeitüberschreitung: Anfrage kann trotzdem angekommen sein
      throw new ApiError(e && e.name === 'AbortError' ? 'timeout' : 'offline', '', null, true);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new ApiError('http_' + res.status, '', null, true);
    let data;
    try { data = await res.json(); } catch (e) { throw new ApiError('bad_response', '', null, true); }
    if (!data || data.ok !== true) throw new ApiError((data && data.error) || 'server_error', data && data.message, data && data.details, false);
    return data;
  }

  const TRANSIENT = new Set(['busy', 'server_error', 'not_setup']);
  const isTransient = (e) => e.network || TRANSIENT.has(e.code);

  function errorText(e) {
    if (!e) return t('errGeneric');
    if (e.network) return navigator.onLine === false || e.code === 'offline' ? t('errOffline') : t('errGeneric');
    return ({
      locked: t('errLocked'), conflict: t('errConflict'), invalid: t('errInvalid'), not_found: t('errNotFound'),
      auth: t('errAuth'), wrong_pin: t('wrongPin'), too_many: t('tooMany'), too_many_day: t('tooManyDay'), pin_duplicate: t('pinDuplicate'), limit: t('errLimit'),
      busy: t('errBusy'), forbidden: t('errGeneric')
    })[e.code] || t('errGeneric');
  }

  async function refreshMeta() {
    if (!S.auth) return;
    try {
      const b = await api('bootstrap');
      store.set('meta.' + uid(), { projects: b.projects, activities: b.activities, firma: b.firma, staff: b.staff || [], at: Date.now() });
      if (b.user) { S.auth.user = b.user; store.set('auth', S.auth); }
    } catch (e) {
      if (e.code === 'auth') { logout(); toast(t('errAuth')); }
    }
  }

  // ===================================================================
  //  Warteschlange (Outbox) – nichts geht verloren
  //  Ein Nachweis wird ZUERST auf dem Handy gespeichert und erst gelöscht,
  //  wenn der Server den Empfang bestätigt hat. Doppelte Sendungen erkennt
  //  der Server an der clientId.
  // ===================================================================
  const outbox = () => store.get('outbox', []);
  const outboxMine = () => outbox().filter((i) => i.userId === uid());
  function saveOutbox(list) { if (!store.set('outbox', list)) throw new ApiError('storage_full'); }
  function putOutbox(item) {
    const list = outbox().filter((i) => i.clientId !== item.clientId);
    list.push(item);
    saveOutbox(list);
  }
  function removeOutbox(clientId) { saveOutbox(outbox().filter((i) => i.clientId !== clientId)); }

  async function sync() {
    if (!S.auth) { resolveAllWaiters({ status: 'queued' }); return; }
    if (S.syncing) { S.syncAgain = true; return; } // läuft schon → danach noch einmal
    S.syncing = true;
    S.syncAgain = false;
    let stopped = false;
    let sentAny = false;
    let loggedOut = false;
    try {
      const mine = outboxMine().filter((i) => i.state !== 'error').sort((a, b) => a.createdAt - b.createdAt);
      for (const item of mine) {
        let outcome;
        try {
          const res = await api('submit', { report: item.report }, { timeout: 120000 });
          removeOutbox(item.clientId);
          rememberSent(item, res);
          sentAny = true;
          outcome = { status: 'sent', res, item };
        } catch (e) {
          const list = outbox();
          const cur = list.find((i) => i.clientId === item.clientId);
          if (cur) {
            cur.tries = (cur.tries || 0) + 1;
            if (e.code === 'timeout' || /^http_5/.test(e.code)) cur.maybeReceived = true;
          }
          if (e.code === 'auth' || isTransient(e)) {
            try { saveOutbox(list); } catch (x) { /* egal */ }
            stopped = true;
            if (e.code === 'auth') loggedOut = true;
            break; // später erneut (bzw. nach neuer Anmeldung)
          }
          if (cur) { cur.state = 'error'; cur.error = e.code; cur.errorMsg = e.message || ''; cur.details = e.details || null; }
          try { saveOutbox(list); } catch (x) { /* egal */ }
          outcome = { status: 'error', error: e, item };
        }
        resolveWaiter(item.clientId, outcome);
      }
    } finally {
      S.syncing = false;
      if (stopped) resolveAllWaiters({ status: 'queued' });
      if (loggedOut) { logout(); toast(t('errAuth')); }
      renderBar();
      if (currentRoute() === '') refreshHomeLists(sentAny);
      if (S.syncAgain && !stopped) { S.syncAgain = false; setTimeout(sync, 0); }
    }
  }
  function resolveWaiter(clientId, outcome) {
    const w = S.waiters[clientId];
    if (w) { delete S.waiters[clientId]; w(outcome); }
  }
  function resolveAllWaiters(outcome) {
    Object.keys(S.waiters).forEach((k) => resolveWaiter(k, outcome));
  }
  function waitFor(clientId, ms) {
    return new Promise((resolve) => {
      S.waiters[clientId] = resolve;
      setTimeout(() => resolveWaiter(clientId, { status: 'queued', timeout: true }), ms);
    });
  }
  function rememberSent(item, res) {
    const key = 'mine.' + item.userId;
    const cache = store.get(key, { items: [] });
    const r = item.report;
    const entry = {
      id: res.id, date: r.date, start: r.start, end: r.end, pauseMin: r.pauseMin,
      hours: Math.round((netOf(r) || 0) / 60 * 100) / 100, status: res.status, version: res.version,
      project: item.summary ? item.summary.project : '', lang: r.lang
    };
    cache.items = [entry].concat((cache.items || []).filter((x) => x.id !== res.id)).slice(0, 60);
    store.set(key, cache);
  }

  // ===================================================================
  //  Kleine UI-Bausteine
  // ===================================================================
  let toastTimer = null;
  function toast(msg, kind) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 4500);
  }

  function modal(content, actions) {
    return new Promise((resolve) => {
      const close = (val) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
      const onKey = (e) => { if (e.key === 'Escape') close(false); };
      const btns = actions.map((a) => h('button', { type: 'button', class: 'btn ' + (a.cls || ''), onclick: () => close(a.value) }, a.label));
      const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, content, h('div', { class: 'modal-actions' }, btns));
      const overlay = h('div', { class: 'overlay', onclick: (e) => { if (e.target === overlay) close(false); } }, box);
      document.body.append(overlay);
      document.addEventListener('keydown', onKey);
      (btns[btns.length - 1] || box).focus();
    });
  }
  const confirmBox = (text, okLabel, danger) => modal(h('p', { class: 'modal-text' }, text), [
    { label: t('cancel'), value: false, cls: 'btn-quiet' },
    { label: okLabel || t('ok'), value: true, cls: danger ? 'btn-danger' : 'btn-primary' }
  ]);

  function statusBadge(status) {
    const map = { eingereicht: 'blue', korrigiert: 'orange', freigegeben: 'green', pending: 'pending', error: 'red' };
    return h('span', { class: 'badge ' + (map[status] || 'blue') },
      status === 'pending' ? icon('cloud') : null, t('st_' + status));
  }

  /** Die Zollstock-Leiste: zeigt die Arbeitszeit des Tages auf einen Blick */
  function ruler(r, compact) {
    const s = toMin(r.start); const e = toMin(r.end);
    let lo = 5 * 60; let hi = 21 * 60;
    if (s !== null && s < lo) lo = Math.floor(s / 60) * 60;
    if (e !== null && e > hi) hi = Math.min(24 * 60, Math.ceil(e / 60) * 60);
    const span = hi - lo;
    const pct = (m) => ((m - lo) / span * 100).toFixed(3) + '%';
    const el = h('div', { class: 'ruler' + (compact ? ' compact' : ''), 'aria-hidden': 'true' });
    if (s !== null && e !== null && e > s) {
      const work = h('div', { class: 'ruler-span' });
      work.style.insetInlineStart = pct(s);
      work.style.width = ((e - s) / span * 100).toFixed(3) + '%';
      const p = Math.min(Number(r.pauseMin) || 0, e - s);
      if (p > 0) {
        const pause = h('div', { class: 'ruler-pause' });
        pause.style.width = (p / (e - s) * 100).toFixed(3) + '%';
        pause.style.insetInlineStart = ((1 - p / (e - s)) / 2 * 100).toFixed(3) + '%';
        work.append(pause);
      }
      el.append(work);
    }
    for (let m = lo; m <= hi; m += 60) {
      const tick = h('div', { class: 'tick' + ((m / 60) % 2 === 0 ? ' major' : '') });
      tick.style.insetInlineStart = pct(m);
      el.append(tick);
      if (!compact && (m / 60) % 2 === 0 && m !== lo && m !== hi) {
        const lab = h('div', { class: 'tick-label' }, String(m / 60));
        lab.style.insetInlineStart = pct(m);
        el.append(lab);
      }
    }
    return el;
  }

  // ===================================================================
  //  Kopfleiste
  // ===================================================================
  function renderBar() {
    const bar = document.getElementById('bar');
    if (!bar) return;
    const route = currentRoute();
    const showBack = (S.lang && S.auth && route !== '' && route !== 'login') || route === 'test';
    const pending = S.auth ? outboxMine().length : 0;
    bar.replaceChildren(
      showBack
        ? h('button', { type: 'button', class: 'bar-btn back', 'aria-label': t('back'), onclick: goBack }, icon('back'))
        : h('span', { class: 'bar-spacer' }),
      h('div', { class: 'bar-title' },
        h('img', { class: 'bar-logo', src: 'icons/logo-mark.svg', alt: '', width: '28', height: '28', decoding: 'async' }),
        h('span', { class: 'bar-title-text' }, t('app')), DEMO ? h('span', { class: 'demo-tag' }, 'Demo') : null),
      h('div', { class: 'bar-end' },
        pending ? h('span', { class: 'pending-dot', title: t('st_pending') }, String(pending)) : null,
        S.lang ? h('button', { type: 'button', class: 'bar-btn lang', 'aria-label': t('changeLang'), onclick: langMenu }, icon('globe'), h('span', null, S.lang.toUpperCase())) : null
      )
    );
    if (navigator.onLine === false) {
      bar.append(h('div', { class: 'offline-strip', role: 'status' }, icon('cloud'), S.auth ? t('offlineStrip') : t('needOnline')));
    }
    if (S.swUpdate) {
      bar.append(h('div', { class: 'update' }, t('updateAvail'), h('button', { type: 'button', class: 'link-btn', onclick: () => location.reload() }, t('reload'))));
    }
  }

  function goBack() {
    if (EMBED) { navTo(parentRoute(), true); return; }
    if (S.navDepth > 0) { S.navDepth -= 1; history.back(); } else navTo('#/', true);
  }
  /** Übergeordnete Ansicht (für eingebettete Vorschau ohne Browser-Verlauf) */
  function parentRoute() {
    const p = location.hash.replace(/^#\/?/, '').split('/');
    if (p[0] === 'office' && p[1] === 'r') return '#/office';
    if (p[0] === 'qedit') return '#/q/' + p[1];
    if (p[0] === 'edit') return (isOffice() ? '#/office/r/' : '#/r/') + p[1];
    return '#/';
  }
  /** Wechselt die Ansicht genau einmal (hashchange zeichnet neu, sonst direkt). */
  function navTo(hash, replace) {
    if (EMBED) replace = true;
    const cur = location.hash || '#/';
    if (cur === hash || (hash === '#/' && (cur === '#' || cur === '#/'))) { route(); return; }
    if (replace) location.replace(hash); else location.hash = hash;
  }
  const currentRoute = () => location.hash.replace(/^#\/?/, '').split('/')[0] || '';

  async function langMenu() {
    const choice = await modal(h('div', { class: 'lang-list' }, h('p', { class: 'modal-text' }, t('langTitle'))), [
      { label: LANG_NAMES.ar, value: 'ar', cls: 'lang-opt' }, { label: LANG_NAMES.ku, value: 'ku', cls: 'lang-opt' },
      { label: LANG_NAMES.de, value: 'de', cls: 'lang-opt' }
    ]);
    if (choice) setLang(choice);
  }
  function setLang(l) {
    if (S.formSave) { S.formSave(); S.silentRestore = true; } // Eingaben sichern, bevor neu gezeichnet wird
    S.lang = l;
    store.set('lang', l);
    applyLang();
    route();
  }
  function applyLang() {
    const l = S.lang || 'de';
    document.documentElement.lang = l === 'ku' ? 'ku' : l;
    document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
    document.title = t('app');
  }

  // ===================================================================
  //  Router
  // ===================================================================
  function route() {
    stopDictation();
    S.formSave = null;
    const main = document.getElementById('main');
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch (e) { return x; } });
    let view;
    if (parts[0] === 'test') view = viewTest(); // Gerätetest: vor Sprachwahl und Anmeldung erreichbar (Fehlersuche)
    else if (!S.lang) view = viewLang();
    else if (CONFIG_ERROR) view = viewConfigError();
    else if (!S.auth) view = viewLogin();
    else {
      switch (parts[0]) {
        case undefined: view = viewHome(); break;
        case 'new': view = viewForm({ mode: 'new' }); break;
        case 'edit': view = viewEditLoader(parts[1]); break;
        case 'q': view = viewQueued(parts[1]); break;
        case 'qedit': view = viewQueuedEdit(parts[1]); break;
        case 'r': view = viewDetail(parts[1]); break;
        case 'list': view = viewList(); break;
        case 'done': view = viewDone(); break;
        case 'office': view = isOffice() ? (parts[1] === 'r' ? viewDetail(parts[2], true) : (parts[1] === 'check' ? viewCheck() : viewOffice())) : viewHome(); break;
        case 'export': view = isOffice() ? viewExport() : viewHome(); break;
        default: view = viewHome();
      }
    }
    main.replaceChildren(view);
    renderBar();
    window.scrollTo(0, 0);
  }

  // ===================================================================
  //  Ansichten: Sprache, Anmeldung, Start
  // ===================================================================
  /** Firmenlogo (Raute und Schriftzug „DAGHO BAU“) für Sprachauswahl und Anmeldung */
  function brandLogo() {
    return h('img', { class: 'brand-logo', src: 'icons/logo.svg', alt: 'Dagho Bau', width: '550', height: '336', decoding: 'async' });
  }

  function viewLang() {
    return h('section', { class: 'screen' },
      brandLogo(),
      h('h1', { class: 'title' }, 'اختر اللغة', h('br'), 'Ziman hilbijêre', h('br'), 'Sprache wählen'),
      h('div', { class: 'stack' },
        ['ar', 'ku', 'de'].map((l) => h('button', {
          type: 'button', class: 'btn btn-big lang-' + l, lang: l, dir: l === 'ar' ? 'rtl' : 'ltr', onclick: () => setLang(l)
        }, LANG_NAMES[l]))
      )
    );
  }

  function viewConfigError() {
    return h('section', { class: 'screen' }, h('div', { class: 'note error' }, icon('alert'), h('p', null, I18N.de.configError)),
      h('a', { href: '#/test', class: 'link' }, I18N.de.testLink));
  }

  function viewLogin() {
    const err = h('p', { class: 'field-error', role: 'alert' });
    const input = h('input', {
      id: 'pin', type: 'password', inputmode: 'numeric', autocomplete: 'off', pattern: '[0-9]*', maxlength: '10',
      class: 'pin-input', dir: 'ltr', 'aria-describedby': 'pin-hint'
    });
    const btn = h('button', { type: 'submit', class: 'btn btn-primary btn-big' }, t('loginBtn'));
    const toggle = h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('showPin'), onclick: () => { input.type = input.type === 'password' ? 'text' : 'password'; input.focus(); } }, icon('eye'));
    const form = h('form', {
      class: 'stack', novalidate: true,
      onsubmit: async (ev) => {
        ev.preventDefault();
        err.textContent = '';
        const pin = normDigits(input.value);
        if (pin.length < PIN_MIN) { err.textContent = t('wrongPin'); input.focus(); return; }
        if (!DEMO && navigator.onLine === false) { err.textContent = t('needOnline'); return; }
        btn.disabled = true;
        btn.textContent = t('loading');
        try {
          const res = await api('login', { pin });
          S.auth = { token: res.token, user: res.user };
          store.set('auth', S.auth);
          if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
          await refreshMeta();
          S.navDepth = 0;
          navTo('#/', true);
          sync();
        } catch (e) {
          err.textContent = e.network ? (navigator.onLine === false ? t('needOnline') : t('errGeneric')) : errorText(e);
          input.select();
        } finally {
          btn.disabled = false;
          btn.textContent = t('loginBtn');
        }
      }
    },
    h('label', { class: 'field' },
      h('span', { class: 'cap' }, t('pin')),
      h('span', { class: 'pin-row' }, input, toggle)
    ),
    err, btn);
    setTimeout(() => input.focus(), 50);
    return h('section', { class: 'screen' },
      brandLogo(),
      h('h1', { class: 'title' }, t('loginTitle')),
      h('p', { class: 'lead', id: 'pin-hint' }, t('loginHint')),
      form,
      DEMO ? h('p', { class: 'note' }, t('demoHint')) : null,
      h('p', { class: 'fine' }, t('privacy')),
      h('a', { href: '#/test', class: 'link test-link' }, t('testLink'))
    );
  }

  function viewHome() {
    const user = S.auth.user;
    const lists = h('div', { id: 'home-lists' });
    const page = h('section', { class: 'screen' },
      h('h1', { class: 'title' }, t('hello', { name: user.name })),
      LS_OK ? null : h('div', { class: 'note error' }, icon('alert'), h('p', null, t('noStorage'))),
      h('a', { href: '#/new', class: 'btn btn-primary btn-big btn-new', onclick: navClick }, icon('plus'), t('newReport')),
      lists,
      isOffice() ? h('div', { class: 'office-box' },
        h('h2', { class: 'h2' }, t('office')),
        h('div', { class: 'row-btns' },
          h('a', { href: '#/office', class: 'btn', onclick: navClick }, icon('list'), t('allReports')),
          h('a', { href: '#/export', class: 'btn', onclick: navClick }, icon('sheet'), t('excelList'))
        ),
        h('a', { href: '#/office/check', class: 'btn', onclick: navClick }, icon('check'), 'Systemcheck')) : null,
      isStandalone() ? null : h('p', { class: 'fine tip' }, t('installTip')),
      h('div', { class: 'home-foot' },
        h('button', { type: 'button', class: 'btn btn-quiet', onclick: doLogout }, icon('out'), t('logout')),
        h('span', { class: 'fine' }, 'v' + APP_VERSION, ' · ', h('a', { href: '#/test', class: 'link', onclick: navClick }, t('testLink')))
      )
    );
    fillHomeLists(lists);
    return page;
  }
  function navClick() { S.navDepth += 1; }
  const isStandalone = () => window.matchMedia && (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true);

  function refreshHomeLists(fromServer) {
    const el = document.getElementById('home-lists');
    if (el) fillHomeLists(el, fromServer);
  }

  function fillHomeLists(el, fromServer) {
    const cached = store.get('mine.' + uid(), { items: [] }).items || [];
    const render = (items, note) => {
      // Warteschlange erst beim Zeichnen lesen: Eine Serverantwort, die später eintrifft, darf keinen veralteten Stand
      // (z. B. "wartet", obwohl der Server den Nachweis inzwischen abgelehnt hat) über den neuen zeichnen.
      const queued = outboxMine();
      const parts = [];
      const pending = queued.filter((q) => q.state !== 'error');
      const errors = queued.filter((q) => q.state === 'error');
      if (pending.length) {
        parts.push(h('div', { class: 'note warn' }, icon('cloud'),
          h('p', null, pending.length === 1 ? t('pendingOne') : t('pendingMany', { n: pending.length })),
          navigator.onLine !== false ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => sync() }, t('sendNow')) : null));
      }
      if (errors.length) parts.push(h('div', { class: 'note error' }, icon('alert'), h('p', null, t('errorItems'))));
      parts.push(h('h2', { class: 'h2' }, t('myReports')));
      const cards = queued.map(queuedCard).concat(items.slice(0, 8).map((r) => reportCard(r, false)));
      if (!cards.length) parts.push(h('p', { class: 'empty' }, t('noReports')));
      else parts.push(h('div', { class: 'cards' }, cards));
      if (items.length > 8) parts.push(h('a', { href: '#/list', class: 'link', onclick: navClick }, t('allMine')));
      if (note) parts.push(h('p', { class: 'fine' }, note));
      el.replaceChildren(...parts);
    };
    render(cached);
    if (fromServer !== false && (DEMO || navigator.onLine !== false)) {
      api('list', { scope: 'mine' }).then((res) => {
        store.set('mine.' + uid(), { items: res.items, at: Date.now() });
        if (el.isConnected) render(res.items);
      }).catch((e) => { if (e.code === 'auth') { logout(); toast(t('errAuth')); } });
    }
  }

  function projectLabel(r) {
    if (r.projectId) {
      const p = meta().projects.find((x) => x.id === r.projectId);
      if (p) return p.name;
    }
    return r.projectText || r.project || r.projectOrig || '';
  }

  function reportCard(r, office) {
    const net = r.hours ? Math.round(r.hours * 60) : netOf(r);
    return h('a', { href: (office ? '#/office/r/' : '#/r/') + encodeURIComponent(r.id), class: 'card', onclick: navClick },
      h('div', { class: 'card-top' }, h('span', { class: 'card-date' }, dayNode(r.date)), statusBadge(r.status)),
      office ? h('div', { class: 'card-who' }, r.employeeName) : null,
      h('div', { class: 'card-project' }, r.project || ''),
      h('div', { class: 'card-time' }, ltr(r.start + '–' + r.end), h('span', { class: 'card-net' }, ltr(fmtDur(net)), ' ', t('hoursUnit'))),
      ruler(r, true),
      office && r.mailStatus && /^FEHLER/.test(r.mailStatus) ? h('div', { class: 'card-warn' }, icon('mail'), r.mailStatus) : null
    );
  }

  function queuedCard(q) {
    const r = q.report;
    return h('a', { href: '#/q/' + encodeURIComponent(q.clientId), class: 'card queued' + (q.state === 'error' ? ' has-error' : ''), onclick: navClick },
      h('div', { class: 'card-top' }, h('span', { class: 'card-date' }, dayNode(r.date)), statusBadge(q.state === 'error' ? 'error' : 'pending')),
      h('div', { class: 'card-project' }, (q.summary && q.summary.project) || projectLabel(r)),
      h('div', { class: 'card-time' }, ltr(r.start + '–' + r.end), h('span', { class: 'card-net' }, ltr(fmtDur(netOf(r))), ' ', t('hoursUnit'))),
      ruler(r, true)
    );
  }

  async function doLogout() {
    if (outboxMine().length && !(await confirmBox(t('logoutPending'), t('logout'), true))) return;
    logout();
  }
  /** Abmelden. Warteschlange und Entwürfe bleiben auf dem Handy und gehen nach erneuter Anmeldung raus. */
  function logout() {
    stopDictation();
    S.auth = null;
    store.del('auth');
    S.navDepth = 0;
    navTo('#/', true);
  }

  // ===================================================================
  //  Formular (neu / Korrektur / Warteschlange bearbeiten)
  // ===================================================================
  function viewEditLoader(id) {
    const box = h('section', { class: 'screen' }, h('p', { class: 'loading' }, t('loading')));
    api('get', { id }).then((res) => {
      if (!box.isConnected) return;
      const r = res.report;
      if (r.locked && !isOffice()) { box.replaceChildren(h('div', { class: 'note' }, h('p', null, t('lockedNote')))); return; }
      box.replaceWith(viewForm({ mode: 'edit', report: r }));
    }).catch((e) => {
      if (!box.isConnected) return;
      if (e.code === 'auth') { logout(); toast(t('errAuth')); return; }
      box.replaceChildren(h('div', { class: 'note error' }, icon('alert'), h('p', null, errorText(e))),
        h('button', { type: 'button', class: 'btn', onclick: () => route() }, t('retry')));
    });
    return box;
  }

  function viewQueuedEdit(clientId) {
    const item = outboxMine().find((i) => i.clientId === clientId);
    if (!item) return viewHome();
    return viewForm({ mode: 'queued', item });
  }

  function viewForm(opts) {
    const m = meta();
    const office = isOffice();
    const mode = opts.mode;
    const src = opts.report || (opts.item && opts.item.report) || null;
    const draftKey = 'draft.' + uid() + '.' + (mode === 'new' ? 'new' : mode === 'edit' ? src.id : 'q:' + opts.item.clientId);
    const last = store.get('last.' + uid(), null);

    // Ausgangswerte
    let F = {
      date: todayIso(), projectId: '', projectText: '', start: '', end: '', pauseMin: 30, activityIds: [],
      description: '', material: '', clientName: '', sigEmployee: null, sigClient: null, showClient: false,
      photos: [], descriptionDe: null, materialDe: null, projectDe: null
    };
    let reportLang = S.lang;
    let sigVersions = { employee: null, client: null };
    if (mode === 'edit') {
      reportLang = src.lang;
      F = Object.assign(F, {
        date: src.date, projectId: src.projectId || '', projectText: src.projectId ? '' : src.projectOrig,
        start: src.start, end: src.end, pauseMin: Number(src.pauseMin) || 0, activityIds: (src.activityIds || []).slice(),
        description: src.descriptionOrig || '', material: src.materialOrig || '', clientName: src.clientName || '',
        sigEmployee: src.sigEmployee ? 'keep' : null, sigClient: src.sigClient ? 'keep' : null, showClient: !!src.sigClient || !!src.clientName,
        photos: (src.photos || []).map((p) => ({ keep: p.id })),
        descriptionDe: src.descriptionDe || '', materialDe: src.materialDe || '', projectDe: src.projectId ? '' : (src.projectDe || '')
      });
      sigVersions = { employee: src.sigEmployee ? src.sigEmployee.version : null, client: src.sigClient ? src.sigClient.version : null };
    } else if (mode === 'queued') {
      const r = src;
      reportLang = r.lang;
      F = Object.assign(F, {
        date: r.date, projectId: r.projectId || '', projectText: r.projectText || '', start: r.start, end: r.end,
        pauseMin: r.pauseMin, activityIds: (r.activityIds || []).slice(), description: r.description || '', material: r.material || '',
        clientName: r.clientName || '', sigEmployee: r.sigEmployee || null, sigClient: r.sigClient || null,
        showClient: !!r.sigClient || !!r.clientName,
        photos: (r.photos || []).map((p) => (String(p).slice(0, 5) === 'data:' ? { data: p } : { keep: p })),
        descriptionDe: r.descriptionDe === undefined ? null : r.descriptionDe, materialDe: r.materialDe === undefined ? null : r.materialDe,
        projectDe: r.projectDe === undefined ? null : r.projectDe
      });
      if (opts.item.sigVersions) sigVersions = opts.item.sigVersions;
    }
    const draftBase = mode === 'edit' && src ? Number(src.version) : null; // Stand des Nachweises, auf dem ein Entwurf beruht
    const draft = store.get(draftKey, null);
    let restored = false;
    let draftStale = false;
    if (draft && draft.F) {
      // Wurde der Nachweis seit dem Entwurf geändert (anderes Handy, Büro), würde der alte Entwurf die neuen Daten überschreiben
      if (mode === 'edit' && Number(draft.v) !== draftBase) { store.del(draftKey); draftStale = true; }
      else { F = Object.assign(F, draft.F); restored = !S.silentRestore; }
    }
    S.silentRestore = false;
    const officeEdit = office && mode !== 'new' && reportLang !== 'de' && (mode === 'edit' || F.descriptionDe !== null);

    const errs = {};
    let triedSubmit = false;
    let saveTimer = null;
    let draftDone = false; // nach Senden oder Verwerfen darf der verzögerte Zeitgeber keinen Entwurf mehr anlegen
    const saveDraft = () => { clearTimeout(saveTimer); if (!draftDone) store.set(draftKey, { F, at: Date.now(), v: draftBase }); };
    const dropDraft = () => { draftDone = true; clearTimeout(saveTimer); store.del(draftKey); S.formSave = null; };
    const touch = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveDraft, 400); if (triedSubmit) runValidation(false); updateTime(); };
    S.formSave = saveDraft;

    // ---------- Felder ----------
    const errEl = {};
    const fieldBox = (name, label, control, extra) => {
      errEl[name] = h('p', { class: 'field-error', id: 'err-' + name, role: 'alert' });
      return h('div', { class: 'field', 'data-field': name },
        h('label', { class: 'cap', for: 'f-' + name }, label, extra || null), control, errEl[name]);
    };

    // Datum
    const dateIn = h('input', { id: 'f-date', type: 'date', dir: 'ltr', value: F.date, max: todayIso(1), oninput: (e) => { F.date = e.target.value; dateHint(); touch(); } });
    const dateHintEl = h('p', { class: 'field-hint' });
    const dateHint = () => {
      const d = F.date ? daysBetween(F.date, todayIso()) : 0;
      dateHintEl.textContent = d > 7 ? t('dateOld', { n: d }) : '';
      chipToday.classList.toggle('on', F.date === todayIso());
      chipYest.classList.toggle('on', F.date === todayIso(-1));
    };
    const chipToday = h('button', { type: 'button', class: 'chip-s', onclick: () => { F.date = todayIso(); dateIn.value = F.date; dateHint(); touch(); } }, t('today'));
    const chipYest = h('button', { type: 'button', class: 'chip-s', onclick: () => { F.date = todayIso(-1); dateIn.value = F.date; dateHint(); touch(); } }, t('yesterday'));

    // Bauvorhaben (in der Auswahl nur der Name; Adresse/Info darunter – lange Namen werden sonst abgeschnitten)
    const projInfo = h('p', { class: 'field-hint proj-info', dir: 'auto' });
    const syncProj = () => {
      const opt = projSel.options[projSel.selectedIndex];
      // Schreibrichtung folgt dem gewählten Eintrag (deutscher Baustellenname in arabischer Ansicht)
      projSel.dir = opt && /[֐-ࣿ]/.test(opt.textContent) ? 'rtl' : (opt && opt.value ? 'ltr' : '');
      const p = m.projects.find((x) => x.id === projSel.value);
      projInfo.textContent = p && p.info ? p.info : '';
    };
    const projSel = h('select', { id: 'f-project', onchange: (e) => { F.projectId = e.target.value === '__other' ? '' : e.target.value; if (e.target.value !== '__other') F.projectText = ''; projOther.hidden = e.target.value !== '__other'; syncProj(); if (e.target.value === '__other') projText.focus(); touch(); } },
      h('option', { value: '' }, t('projectChoose')),
      m.projects.map((p) => h('option', { value: p.id }, p.name)),
      h('option', { value: '__other' }, t('projectOther') + ' …'));
    if (F.projectId && !m.projects.some((p) => p.id === F.projectId)) {
      projSel.insertBefore(h('option', { value: F.projectId }, projectLabel({ projectId: F.projectId, projectText: src && (src.projectOrig || src.projectText) })), projSel.lastChild);
    }
    projSel.value = F.projectId ? F.projectId : (F.projectText ? '__other' : '');
    const projText = h('input', { id: 'f-projectText', type: 'text', maxlength: '200', dir: 'auto', placeholder: t('projectOtherPh'), value: F.projectText, oninput: (e) => { F.projectText = e.target.value; touch(); } });
    const projOther = h('div', { class: 'sub' }, projText);
    projOther.hidden = projSel.value !== '__other';
    syncProj();

    // Zeiten
    const startIn = h('input', { id: 'f-start', type: 'time', dir: 'ltr', value: F.start, oninput: (e) => { F.start = e.target.value; touch(); } });
    const endIn = h('input', { id: 'f-end', type: 'time', dir: 'ltr', value: F.end, oninput: (e) => { F.end = e.target.value; touch(); } });
    const pauseBtns = [0, 15, 30, 45, 60].map((n) => h('button', { type: 'button', class: 'seg', 'data-min': String(n), onclick: () => { F.pauseMin = n; pauseIn.value = String(n); touch(); } }, String(n)));
    const pauseIn = h('input', { id: 'f-pause', type: 'number', inputmode: 'numeric', min: '0', max: '600', step: '5', dir: 'ltr', value: String(F.pauseMin), 'aria-label': t('pause') + ' (' + t('otherMin') + ')', oninput: (e) => { F.pauseMin = e.target.value === '' ? '' : Number(e.target.value); touch(); } });
    const lastBtn = last && last.start && last.end && mode === 'new'
      ? h('button', { type: 'button', class: 'chip-s', onclick: () => { F.start = last.start; F.end = last.end; F.pauseMin = last.pauseMin; startIn.value = F.start; endIn.value = F.end; pauseIn.value = String(F.pauseMin); touch(); } },
        t('asLastTime', { range: last.start + '–' + last.end }))
      : null;
    const rulerHost = h('div', { class: 'ruler-host' });
    const netEl = h('div', { class: 'net' });
    const hintsEl = h('div', { class: 'hints' });
    const updateTime = () => {
      pauseBtns.forEach((b) => b.classList.toggle('on', Number(b.dataset.min) === Number(F.pauseMin) && F.pauseMin !== ''));
      rulerHost.replaceChildren(ruler(F, false));
      const net = netOf(F);
      netEl.replaceChildren(h('span', { class: 'net-label' }, t('netTime')), h('span', { class: 'net-value' }, ltr(net !== null && net > 0 ? fmtDur(net) : '–:––'), ' ', t('hoursUnit')));
      const hints = [];
      if (net !== null && net > 0) {
        const p = Number(F.pauseMin) || 0;
        if (net > 9 * 60 && p < 45) hints.push(t('hint9'));
        else if (net > 6 * 60 && p < 30) hints.push(t('hint6'));
        if (net > 10 * 60) hints.push(t('hint10'));
      }
      hintsEl.replaceChildren(...hints.map((x) => h('p', { class: 'note warn small' }, icon('alert'), h('span', null, x))));
    };

    // Tätigkeiten
    const actLabel = (a) => (S.lang === 'ar' && a.ar) || (S.lang === 'ku' && a.ku) || a.de;
    const chips = m.activities.map((a) => {
      const b = h('button', {
        type: 'button', class: 'chip' + (F.activityIds.includes(a.id) ? ' on' : ''), 'aria-pressed': F.activityIds.includes(a.id) ? 'true' : 'false',
        onclick: () => {
          const on = !F.activityIds.includes(a.id);
          F.activityIds = on ? F.activityIds.concat(a.id) : F.activityIds.filter((x) => x !== a.id);
          b.classList.toggle('on', on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
          touch();
        }
      }, icon('check', 'chip-check'), h('span', { class: 'chip-main' }, actLabel(a)), S.lang !== 'de' ? h('span', { class: 'chip-sub', lang: 'de', dir: 'ltr' }, a.de) : null);
      return b;
    });

    // Texte mit Spracheingabe
    const textArea = (name, ph, max, rows) => {
      const ta = h('textarea', { id: 'f-' + name, rows: String(rows), maxlength: String(max), placeholder: ph, dir: 'auto', oninput: (e) => { F[name] = e.target.value; grow(ta); touch(); } });
      ta.value = F[name] || '';
      setTimeout(() => grow(ta), 0);
      const mic = micButton(ta, () => { F[name] = ta.value; grow(ta); touch(); });
      return { ta, mic };
    };
    const desc = textArea('description', t('descriptionPh'), 4000, 4);
    const mat = textArea('material', t('materialPh'), 2000, 2);

    // Übersetzung (nur Büro, nur bei fremdsprachigen Nachweisen)
    let deBlock = null;
    if (officeEdit) {
      const deTa = (key, val, rows) => {
        const ta = h('textarea', { rows: String(rows), dir: 'ltr', lang: 'de', 'data-de': key, oninput: (e) => { F[key] = e.target.value; grow(ta); touch(); } });
        ta.value = val || '';
        setTimeout(() => grow(ta), 0);
        return ta;
      };
      deBlock = h('div', { class: 'field de-block' },
        h('p', { class: 'cap' }, t('translationEdit')),
        h('p', { class: 'field-hint' }, t('translationNote')),
        h('label', { class: 'cap small' }, t('description')), deTa('descriptionDe', F.descriptionDe, 3),
        h('label', { class: 'cap small' }, t('material')), deTa('materialDe', F.materialDe, 2),
        !F.projectId ? [h('label', { class: 'cap small' }, t('projectDeLabel')), deTa('projectDe', F.projectDe, 1)] : null
      );
    }

    // Unterschriften
    const sigBlock = (kind, label) => {
      const host = h('div', { class: 'sig-host' });
      const key = kind === 'employee' ? 'sigEmployee' : 'sigClient';
      const renderSig = () => {
        if (F[key] === 'keep') {
          host.replaceChildren(h('div', { class: 'sig-keep' }, icon('check'), h('span', null, t('sigPresent', { v: sigVersions[kind] || 1 })),
            h('button', { type: 'button', class: 'btn btn-small', onclick: () => { F[key] = null; renderSig(); touch(); } }, t('sigNew')),
            h('button', { type: 'button', class: 'btn btn-small btn-quiet', onclick: () => { F[key] = null; renderSig(); touch(); toast(t('sigRemoved')); } }, t('sigRemove'))));
          return;
        }
        const pad = signaturePad(F[key], (data) => { F[key] = data; touch(); });
        host.replaceChildren(pad.el);
      };
      renderSig();
      return h('div', { class: 'field' }, h('p', { class: 'cap' }, label), host);
    };
    const clientNameIn = h('input', { id: 'f-clientName', type: 'text', maxlength: '100', autocomplete: 'off', value: F.clientName, oninput: (e) => { F.clientName = e.target.value; touch(); } });
    const clientBlock = h('div', { class: 'client-block' }, sigBlock('client', t('sigClient')), fieldBox('clientName', t('clientName'), clientNameIn));
    clientBlock.hidden = !F.showClient;
    const clientToggle = h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => { F.showClient = true; clientBlock.hidden = false; clientToggle.hidden = true; touch(); } }, icon('edit'), t('addClientSig'));
    clientToggle.hidden = F.showClient;

    // Fotos (freiwillig): fertige Arbeit oder ein Problem. Sie kommen nur ins Word/PDF, nicht in die Excel-Liste.
    const photoHost = h('div', { class: 'photos' });
    const photoErr = h('p', { class: 'field-error', role: 'alert' });
    const photoBusy = h('p', { class: 'field-hint', role: 'status' }, t('photoWorking'));
    photoBusy.hidden = true;
    // Ein Knopf, kein Kamera-Zugriff: Der Mitarbeiter fotografiert wie gewohnt mit der Kamera-App
    // und lädt das Bild danach hier vom Handy hoch. Was das Auswahlfenster anbietet (Galerie, Dateien,
    // auf manchen Handys auch die Kamera), entscheidet das Handy selbst.
    const photoIn = h('input', { id: 'f-photo', type: 'file', accept: 'image/*', multiple: true, class: 'photo-input', tabindex: '-1', 'aria-hidden': 'true' });
    photoIn.addEventListener('change', async (ev) => { const f = [...ev.target.files]; ev.target.value = ''; await addPhotos(f); });
    const uploadBtn = h('button', { type: 'button', class: 'btn', onclick: () => photoIn.click() }, icon('upload'), t('photoUpload'));
    const renderPhotos = () => {
      photoHost.replaceChildren(...F.photos.map((p, i) => {
        const label = p.keep ? t('photoSaved', { n: i + 1 }) : t('photoLabel', { n: i + 1 });
        return h('div', { class: 'photo' },
          p.data ? h('img', { class: 'photo-img', src: p.data, alt: label })
            : h('div', { class: 'photo-img photo-kept' }, icon('image')),
          h('span', { class: 'photo-cap' }, label),
          h('button', {
            type: 'button', class: 'icon-btn photo-del', 'aria-label': t('photoRemove') + ': ' + label,
            onclick: () => { F.photos.splice(i, 1); photoErr.textContent = ''; renderPhotos(); touch(); }
          }, icon('trash')));
      }));
      photoHost.hidden = !F.photos.length;
      uploadBtn.disabled = F.photos.length >= PHOTO_MAX;
    };
    async function addPhotos(files) {
      photoErr.textContent = '';
      if (!files.length) return;
      const free = Math.max(0, PHOTO_MAX - F.photos.length);
      if (files.length > free) photoErr.textContent = t('photoMax', { n: PHOTO_MAX });
      photoBusy.hidden = false;
      try {
        for (const f of files.slice(0, free)) {
          try { F.photos.push({ data: await shrinkPhoto(f) }); } catch (e) { photoErr.textContent = t('photoFail'); }
        }
      } finally { photoBusy.hidden = true; }
      renderPhotos();
      touch();
    }
    renderPhotos();
    const photoBlock = h('fieldset', { class: 'group', 'data-field': 'photos' },
      h('legend', { class: 'h2' }, t('photos'), h('span', { class: 'opt' }, ' (' + t('optional') + ')')),
      h('p', { class: 'field-hint' }, t('photosHint', { n: PHOTO_MAX })),
      photoHost, photoErr, photoBusy,
      h('div', { class: 'btn-row' }, uploadBtn), photoIn);

    // ---------- Prüfung ----------
    const runValidation = (focusFirst) => {
      Object.keys(errs).forEach((k) => delete errs[k]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(F.date || '')) errs.date = t('required');
      else if (F.date > todayIso(1)) errs.date = t('dateFuture');
      if (!F.projectId && !(F.projectText || '').trim()) errs.project = t('required');
      if (!F.start) errs.start = t('required');
      if (!F.end) errs.end = t('required');
      const s = toMin(F.start); const e = toMin(F.end);
      const p = F.pauseMin;
      if (p === '' || !Number.isInteger(Number(p)) || Number(p) < 0 || Number(p) > 600) errs.pause = t('pauseInvalid');
      if (s !== null && e !== null) {
        if (e <= s) errs.end = t('endAfterStart');
        else if (!errs.pause && e - s - Number(p) <= 0) errs.pause = t('pauseTooLong');
      }
      if (!F.activityIds.length && !(F.description || '').trim()) errs.activities = t('needActivity');
      if ((F.description || '').length > 4000) errs.description = t('tooLong');
      if ((F.material || '').length > 2000) errs.material = t('tooLong');
      if (F.showClient && F.sigClient && F.sigClient !== 'keep' && !(F.clientName || '').trim()) errs.clientName = t('required');
      Object.keys(errEl).forEach((k) => {
        errEl[k].textContent = errs[k] || '';
        const box = errEl[k].closest('[data-field]');
        if (box) box.classList.toggle('invalid', !!errs[k]);
      });
      const keys = Object.keys(errs);
      if (focusFirst && keys.length) {
        const target = form.querySelector('[data-field="' + keys[0] + '"]');
        if (target) { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); const inp = target.querySelector('input,select,textarea,button'); if (inp) inp.focus({ preventScroll: true }); }
      }
      return keys.length === 0;
    };

    // ---------- Senden ----------
    const sendBtn = h('button', { type: 'submit', class: 'btn btn-primary btn-big' }, icon('send'), mode === 'new' ? t('send') : t('sendCorrection'));
    const form = h('form', {
      class: 'form', novalidate: true,
      onsubmit: async (ev) => {
        ev.preventDefault();
        triedSubmit = true;
        stopDictation();
        if (!runValidation(true)) { toast(t('fixErrors'), 'error'); return; }
        const report = {
          clientId: mode === 'queued' ? opts.item.clientId : uuid(),
          lang: reportLang, date: F.date, projectId: F.projectId, projectText: F.projectId ? '' : (F.projectText || '').trim(),
          start: F.start, end: F.end, pauseMin: Number(F.pauseMin), activityIds: F.activityIds.slice(),
          description: (F.description || '').trim(), material: (F.material || '').trim(),
          clientName: F.showClient ? (F.clientName || '').trim() : '',
          sigEmployee: F.sigEmployee || null, sigClient: F.showClient ? (F.sigClient || null) : null,
          photos: F.photos.map((p) => p.keep || p.data)
        };
        if (mode === 'edit') { report.id = src.id; report.baseVersion = src.version; }
        if (mode === 'queued' && src.id) { report.id = src.id; report.baseVersion = src.baseVersion; }
        if (officeEdit) { report.descriptionDe = F.descriptionDe || ''; report.materialDe = F.materialDe || ''; report.projectDe = F.projectDe || ''; }
        const item = {
          clientId: report.clientId, userId: uid(), createdAt: mode === 'queued' ? opts.item.createdAt : Date.now(), state: 'pending',
          report, summary: { project: projectLabel(report) }, sigVersions,
          editedAfterTry: mode === 'queued' && !!opts.item.maybeReceived
        };
        try { putOutbox(item); } catch (e) { toast(t('errStorage'), 'error'); return; }
        dropDraft();
        store.set('last.' + uid(), { start: F.start, end: F.end, pauseMin: Number(F.pauseMin) });
        await sendWithOverlay(item);
      }
    });

    const discardBtn = restored ? h('button', {
      type: 'button', class: 'link-btn', onclick: async () => {
        if (!(await confirmBox(t('discardConfirm'), t('discardDraft'), true))) return;
        dropDraft();
        route();
      }
    }, t('discardDraft')) : null;

    append(form, [
      restored ? h('div', { class: 'note' }, h('p', null, t('draftRestored')), discardBtn) : null,
      draftStale ? h('div', { class: 'note' }, h('p', null, t('draftStale'))) : null,
      mode !== 'new' && src && src.id ? h('p', { class: 'form-ref' }, t('number'), ' ', ltr(src.id), ' · ', t('version'), ' ', ltr(String(src.version || ''))) : null,
      fieldBox('date', t('date'), h('div', { class: 'with-chips' }, dateIn, h('div', { class: 'chips-s' }, chipToday, chipYest)), null),
      dateHintEl,
      fieldBox('project', t('project'), h('div', null, projSel, projInfo, projOther)),
      h('fieldset', { class: 'group' },
        h('legend', { class: 'h2' }, t('worktime')),
        h('div', { class: 'row-2' }, fieldBox('start', t('start'), startIn), fieldBox('end', t('end'), endIn)),
        lastBtn ? h('div', { class: 'chips-s' }, lastBtn) : null,
        fieldBox('pause', t('pause') + ' (' + t('minutes') + ')', h('div', { class: 'pause-row' }, h('div', { class: 'segs', role: 'group' }, pauseBtns), pauseIn)),
        rulerHost, netEl, hintsEl
      ),
      h('fieldset', { class: 'group', 'data-field': 'activities' },
        h('legend', { class: 'h2' }, t('activities')),
        h('p', { class: 'field-hint' }, t('activitiesHint')),
        h('div', { class: 'chips' }, chips),
        (errEl.activities = h('p', { class: 'field-error', role: 'alert' }))
      ),
      fieldBox('description', t('description'), h('div', null, desc.ta, h('div', { class: 'tools' }, desc.mic, SR ? null : h('span', { class: 'field-hint' }, t('micHint'))))),
      fieldBox('material', t('material'), h('div', null, mat.ta, h('div', { class: 'tools' }, mat.mic)), h('span', { class: 'opt' }, ' (' + t('optional') + ')')),
      deBlock,
      photoBlock,
      h('fieldset', { class: 'group' }, h('legend', { class: 'h2' }, t('signatures')), sigBlock('employee', t('sigEmployee')), clientToggle, clientBlock),
      h('div', { class: 'action-bar' }, sendBtn)
    ]);
    dateHint();
    updateTime();
    if (restored) setTimeout(() => runValidation(false), 0);
    return h('section', { class: 'screen form-screen' }, h('h1', { class: 'title' }, mode === 'new' ? t('newReport') : t('edit')), form);
  }

  function grow(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight + 2, 600) + 'px';
  }

  async function sendWithOverlay(item) {
    const longText = h('p', { class: 'fine' });
    const bgBtn = h('button', { type: 'button', class: 'btn btn-quiet', hidden: true }, t('continueBg'));
    const overlay = h('div', { class: 'overlay sending', role: 'alertdialog', 'aria-live': 'assertive' },
      h('div', { class: 'modal center' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('p', { class: 'modal-text strong' }, t('sending')), longText, bgBtn));
    document.body.append(overlay);
    const slow = setTimeout(() => { longText.textContent = t('sendingLong'); bgBtn.hidden = false; }, 6000);
    let leave;
    const leavePromise = new Promise((resolve) => { leave = resolve; bgBtn.onclick = () => resolve({ status: 'background' }); });
    const waiter = waitFor(item.clientId, 125000);
    sync();
    const outcome = await Promise.race([waiter, leavePromise]);
    clearTimeout(slow);
    overlay.remove();
    leave(null);
    S.lastResult = Object.assign({ item }, outcome);
    S.navDepth = 0;
    navTo('#/done', true);
  }

  function viewDone() {
    const r = S.lastResult;
    if (!r) return viewHome();
    const actions = h('div', { class: 'stack' },
      h('a', { href: '#/', class: 'btn btn-big', onclick: () => { S.navDepth = 0; } }, t('toOverview')),
      h('a', { href: '#/new', class: 'btn btn-primary btn-big', onclick: navClick }, icon('plus'), t('anotherReport')));
    if (r.status === 'sent') {
      const res = r.res;
      const noChange = res.warnings && res.warnings.includes('no_changes');
      let text;
      if (noChange) text = t('noChanges');
      else if (DEMO) text = t('sentDemo');
      else text = res.mailSent ? t('sentText', { id: res.id }) : t('sentNoMail', { id: res.id });
      return h('section', { class: 'screen done' },
        h('div', { class: 'done-icon ok' }, icon('check')),
        h('h1', { class: 'title' }, t('sentTitle')),
        h('p', { class: 'lead' }, text),
        res.duplicate && r.item && r.item.editedAfterTry ? h('p', { class: 'note warn' }, t('alreadyThere')) : null,
        actions);
    }
    if (r.status === 'error') {
      return h('section', { class: 'screen done' },
        h('div', { class: 'done-icon err' }, icon('alert')),
        h('h1', { class: 'title' }, t('st_error')),
        h('p', { class: 'lead' }, errorText(r.error)),
        h('a', { href: '#/q/' + encodeURIComponent(r.item.clientId), class: 'btn btn-big', onclick: navClick }, t('edit')),
        actions);
    }
    if (r.status === 'background') {
      return h('section', { class: 'screen done' },
        h('div', { class: 'done-icon wait' }, icon('send')),
        h('h1', { class: 'title' }, t('bgTitle')),
        h('p', { class: 'lead' }, t('bgText')),
        actions);
    }
    return h('section', { class: 'screen done' },
      h('div', { class: 'done-icon wait' }, icon('cloud')),
      h('h1', { class: 'title' }, t('queuedTitle')),
      h('p', { class: 'lead' }, t('queuedText')),
      h('p', { class: 'note' }, t('queuedTip')),
      actions);
  }

  // ===================================================================
  //  Spracheingabe (wo der Browser sie anbietet)
  // ===================================================================
  let activeRec = null;
  function micButton(ta, onUpdate) {
    if (!SR) return null;
    const label = h('span', null, t('speak'));
    const btn = h('button', { type: 'button', class: 'mic', 'aria-pressed': 'false' }, icon('mic'), label);
    btn.addEventListener('click', () => {
      if (activeRec && activeRec.btn === btn) stopDictation();
      else startDictation(ta, btn, label, onUpdate, 0);
    });
    return btn;
  }
  function startDictation(ta, btn, label, onUpdate, idx) {
    stopDictation();
    const codes = { ar: ['ar-SY', 'ar-LB', 'ar-JO', 'ar'], ku: ['ku-TR', 'ku'], de: ['de-DE'] }[S.lang] || ['de-DE'];
    let rec;
    try { rec = new SR(); } catch (e) { toast(t('micFail')); return; }
    rec.lang = codes[idx];
    rec.interimResults = true;
    rec.continuous = !isIOS;
    rec.maxAlternatives = 1;
    const base = ta.value;
    let finalText = '';
    let nextLang = false;
    const join = (add) => {
      add = add.trim();
      if (!add) return base;
      return base + (base && !/\s$/.test(base) ? ' ' : '') + add;
    };
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript + ' '; else interim += r[0].transcript;
      }
      ta.value = join(finalText + interim);
      onUpdate();
    };
    rec.onerror = (e) => {
      if (e.error === 'language-not-supported' && idx + 1 < codes.length) { nextLang = true; return; }
      const msg = { 'not-allowed': 'micDenied', 'service-not-allowed': 'micDenied', network: 'micNet', 'language-not-supported': 'micLang', 'audio-capture': 'micDenied' }[e.error];
      if (msg === 'micDenied' && isIOS && isStandalone()) toast(t('micHint')); // iPhone-App vom Home-Bildschirm: keine Browser-Spracheingabe, "erlauben" hilft dort nicht
      else if (msg) toast(t(msg));
      else if (e.error !== 'no-speech' && e.error !== 'aborted') toast(t('micFail'));
    };
    rec.onend = () => {
      ta.value = join(finalText);
      onUpdate();
      if (activeRec && activeRec.rec === rec) { activeRec = null; setMicUi(btn, label, false); }
      if (nextLang) startDictation(ta, btn, label, onUpdate, idx + 1);
    };
    activeRec = { rec, btn, label };
    setMicUi(btn, label, true);
    try { rec.start(); } catch (e) { activeRec = null; setMicUi(btn, label, false); toast(t('micFail')); }
  }
  function setMicUi(btn, label, on) {
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    label.textContent = on ? t('listening') + ' ' + t('stopSpeak') : t('speak');
  }
  function stopDictation() {
    if (!activeRec) return;
    const a = activeRec;
    activeRec = null;
    try { a.rec.stop(); } catch (e) { /* egal */ }
    setMicUi(a.btn, a.label, false);
  }

  // ===================================================================
  //  Unterschrift
  // ===================================================================
  /**
   * Macht aus einem aufgenommenen Foto ein kleines JPEG: längste Kante PHOTO_EDGE,
   * höchstens PHOTO_CHARS Zeichen. Sonst wäre die Warteschlange auf dem Handy voll
   * und das Senden über Mobilfunk zu langsam. Dreht das Bild nach EXIF richtig herum.
   */
  async function shrinkPhoto(file) {
    if (!file || !/^image\//.test(file.type || '')) throw new Error('kein Bild');
    let src = null;
    let url = null;
    try { if (window.createImageBitmap) src = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { src = null; }
    if (!src) {
      url = URL.createObjectURL(file);
      src = await new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => rej(new Error('nicht lesbar'));
        im.src = url;
      });
    }
    try {
      const w0 = src.width || src.naturalWidth;
      const h0 = src.height || src.naturalHeight;
      if (!w0 || !h0) throw new Error('leeres Bild');
      let scale = Math.min(1, PHOTO_EDGE / Math.max(w0, h0));
      for (let tries = 0; tries < 3; tries++) {
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w0 * scale));
        c.height = Math.max(1, Math.round(h0 * scale));
        const g = c.getContext('2d');
        if (!g) throw new Error('kein Canvas');
        g.fillStyle = '#FFFFFF';
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(src, 0, 0, c.width, c.height);
        for (const q of [0.72, 0.6, 0.5]) {
          const data = c.toDataURL('image/jpeg', q);
          if (data.slice(0, 15) !== 'data:image/jpeg') throw new Error('kein JPEG');
          if (data.length <= PHOTO_CHARS) return data;
        }
        scale *= 0.75;
      }
      throw new Error('zu groß');
    } finally {
      if (url) URL.revokeObjectURL(url);
      if (src && src.close) src.close();
    }
  }

  function signaturePad(initial, onChange) {
    const canvas = h('canvas', { class: 'sig-canvas', role: 'img', 'aria-label': t('sigHere') });
    const hint = h('div', { class: 'sig-hint' }, t('sigHere'));
    const clearBtn = h('button', { type: 'button', class: 'btn btn-small btn-quiet sig-clear' }, t('sigClear'));
    const wrap = h('div', { class: 'sig' }, h('div', { class: 'sig-line' }), canvas, hint, clearBtn);
    const ctx = canvas.getContext('2d');
    let drawing = false;
    let last = null;
    let hasInk = false;
    let pendingImage = initial && /^data:image\/png;base64,/.test(initial) ? initial : null;

    const setup = () => {
      const r = canvas.getBoundingClientRect();
      if (!r.width) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const snapshot = hasInk ? canvas.toDataURL('image/png') : pendingImage;
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#18222C';
      ctx.fillStyle = '#18222C';
      if (snapshot) {
        const img = new Image();
        img.onload = () => { ctx.drawImage(img, 0, 0, r.width, r.height); hasInk = true; hint.hidden = true; pendingImage = null; };
        img.src = snapshot;
      }
    };
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* egal */ }
      drawing = true;
      last = pos(e);
      ctx.beginPath(); ctx.arc(last.x, last.y, 1.3, 0, Math.PI * 2); ctx.fill();
      hint.hidden = true;
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      e.preventDefault();
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of (evs.length ? evs : [e])) {
        const p = pos(ev);
        ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
        last = p;
      }
    });
    const end = () => {
      if (!drawing) return;
      drawing = false;
      hasInk = true;
      onChange(exportPng());
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('lostpointercapture', end);
    clearBtn.addEventListener('click', () => {
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.restore();
      hasInk = false; pendingImage = null; hint.hidden = false;
      onChange(null);
    });
    function exportPng() {
      const out = document.createElement('canvas');
      out.width = 600; out.height = 200;
      const o = out.getContext('2d');
      o.fillStyle = '#FFFFFF'; o.fillRect(0, 0, 600, 200);
      o.drawImage(canvas, 0, 0, 600, 200);
      return out.toDataURL('image/png');
    }
    if (window.ResizeObserver) new ResizeObserver(() => setup()).observe(canvas);
    else setTimeout(setup, 0);
    return { el: wrap };
  }

  // ===================================================================
  //  Detailansichten
  // ===================================================================
  const listSep = () => (S.lang === 'ar' ? '\u060C ' : ', '); // arabisches Komma
  function kv(label, value) { return h('div', { class: 'kv' }, h('dt', null, label), h('dd', null, value)); }

  // Der Server nennt fehlerhafte Felder mit technischen Namen ("pause"); der Mitarbeiter soll die Bezeichnung aus dem Formular lesen
  const FIELD_LABEL = {
    date: 'date', start: 'start', end: 'end', pause: 'pause', project: 'project', description: 'description',
    material: 'material', clientName: 'clientName', sigEmployee: 'sigEmployee', sigClient: 'sigClient'
  };
  const fieldNames = (fields) => (Array.isArray(fields) ? fields : []).map((f) => (FIELD_LABEL[f] ? t(FIELD_LABEL[f]) : null)).filter(Boolean);

  function viewQueued(clientId) {
    const item = outboxMine().find((i) => i.clientId === clientId);
    if (!item) return viewHome();
    const r = item.report;
    const badFields = fieldNames(item.details && item.details.fields);
    const m = meta();
    const acts = (r.activityIds || []).map((id) => m.activities.find((a) => a.id === id)).filter(Boolean)
      .map((a) => (S.lang === 'ar' && a.ar) || (S.lang === 'ku' && a.ku) || a.de);
    return h('section', { class: 'screen' },
      h('h1', { class: 'title' }, dayNode(r.date)),
      statusBadge(item.state === 'error' ? 'error' : 'pending'),
      item.state === 'error' ? h('div', { class: 'note error' }, icon('alert'), h('p', null, errorText({ code: item.error }) + (badFields.length ? ' (' + badFields.join(listSep()) + ')' : ''))) : null,
      h('dl', { class: 'kvs' },
        kv(t('project'), (item.summary && item.summary.project) || projectLabel(r)),
        kv(t('worktime'), [ltr(r.start + '–' + r.end), ' · ', t('pause'), ' ', ltr(String(r.pauseMin)), ' ', t('minutes')]),
        kv(t('netTime'), [ltr(fmtDur(netOf(r))), ' ', t('hoursUnit')]),
        kv(t('activitiesShort'), acts.join(listSep()) || '–'),
        kv(t('description'), h('span', { class: 'pre', dir: 'auto' }, r.description || '–')),
        r.material ? kv(t('material'), h('span', { class: 'pre', dir: 'auto' }, r.material)) : null,
        kv(t('photos'), photoText((r.photos || []).length)),
        kv(t('signatures'), t('sigEmployee') + ': ' + (r.sigEmployee ? t('yes') : t('no')))
      ),
      ruler(r, false),
      h('div', { class: 'stack' },
        item.state !== 'error' && navigator.onLine !== false ? h('button', { type: 'button', class: 'btn btn-primary btn-big', onclick: async () => { await sync(); route(); } }, icon('send'), t('sendNow')) : null,
        h('a', { href: '#/qedit/' + encodeURIComponent(clientId), class: 'btn btn-big', onclick: (e) => {
          // Fehlerhafte Einträge werden beim Bearbeiten wieder auf "wartet" gesetzt
          const list = outbox(); const it = list.find((i) => i.clientId === clientId);
          if (it && it.state === 'error') { it.state = 'pending'; delete it.error; try { saveOutbox(list); } catch (x) { e.preventDefault(); toast(t('errStorage')); return; } }
          navClick();
        } }, icon('edit'), t('edit')),
        h('button', { type: 'button', class: 'btn btn-danger', onclick: async () => {
          if (!(await confirmBox(t('discardQueuedConfirm'), t('discardQueued'), true))) return;
          try { removeOutbox(clientId); } catch (e) { toast(t('errStorage')); return; }
          toast(t('deleted'));
          S.navDepth = 0;
          navTo('#/', true);
        } }, icon('trash'), t('discardQueued'))
      )
    );
  }

  function viewDetail(id, officeView) {
    const box = h('section', { class: 'screen' }, h('p', { class: 'loading' }, t('loading')));
    const cached = (store.get('mine.' + uid(), { items: [] }).items || []).find((x) => x.id === id);
    const showCached = (msg) => {
      if (!cached) { box.replaceChildren(h('div', { class: 'note error' }, icon('alert'), h('p', null, msg))); return; }
      box.replaceChildren(
        h('h1', { class: 'title' }, dayNode(cached.date)), statusBadge(cached.status),
        h('div', { class: 'note' }, h('p', null, msg)),
        h('dl', { class: 'kvs' }, kv(t('project'), cached.project), kv(t('worktime'), ltr(cached.start + '–' + cached.end)),
          kv(t('netTime'), [ltr(fmtDur(Math.round((cached.hours || 0) * 60))), ' ', t('hoursUnit')])),
        ruler(cached, false));
    };
    if (!DEMO && navigator.onLine === false) { showCached(t('offlineDetail')); return box; }
    api('get', { id }).then((res) => {
      if (box.isConnected) box.replaceChildren(...renderReport(res.report, officeView, box));
    }).catch((e) => {
      if (!box.isConnected) return;
      if (e.code === 'auth') { logout(); toast(t('errAuth')); return; }
      showCached(e.network ? t('offlineDetail') : errorText(e));
    });
    return box;
  }

  function renderReport(r, officeView, box) {
    const m = meta();
    const actIds = r.activityIds || [];
    const acts = actIds.map((aid) => m.activities.find((a) => a.id === aid)).filter(Boolean)
      .map((a) => (S.lang === 'ar' && a.ar) || (S.lang === 'ku' && a.ku) || a.de);
    const actsText = acts.length ? acts.join(listSep()) : (S.lang === 'de' ? r.activitiesDe : r.activitiesOrig) || '–';
    const showDe = r.lang !== 'de';
    const out = [
      h('h1', { class: 'title' }, dayNode(r.date)),
      h('div', { class: 'detail-head' }, statusBadge(r.status), h('span', { class: 'fine' }, t('number'), ' ', ltr(r.id), ' · ', t('version'), ' ', ltr(String(r.version)))),
      h('dl', { class: 'kvs' },
        officeView ? kv(t('employee'), r.employeeName) : null,
        kv(t('project'), officeView ? r.projectDe : r.projectOrig),
        kv(t('worktime'), [ltr(r.start + '–' + r.end), ' · ', t('pause'), ' ', ltr(String(r.pauseMin)), ' ', t('minutes')]),
        kv(t('netTime'), [ltr(fmtDur(netOf(r))), ' ', t('hoursUnit')]),
        kv(t('activitiesShort'), actsText),
        kv(showDe ? t('description') + ' (' + t('original') + ')' : t('description'), h('span', { class: 'pre', dir: 'auto' }, r.descriptionOrig || '–')),
        showDe ? kv(t('germanTranslation'), h('span', { class: 'pre', dir: 'ltr', lang: 'de' }, r.descriptionDe || '–')) : null,
        r.materialOrig ? kv(t('material'), h('span', { class: 'pre', dir: 'auto' }, r.materialOrig)) : null,
        r.materialOrig && showDe ? kv(t('material') + ' – ' + t('germanTranslation'), h('span', { class: 'pre', dir: 'ltr', lang: 'de' }, r.materialDe || '–')) : null,
        kv(t('photos'), photoText((r.photos || []).length)),
        kv(t('signatures'), [
          h('span', { class: 'sig-line-text' }, (officeView ? t('employee') : t('sigEmployee')) + ': ' + (r.sigEmployee ? t('yes') : t('no'))),
          h('span', { class: 'sig-line-text' }, t('sigClient') + ': ' + (r.sigClient ? t('yes') + (r.clientName ? ' (' + r.clientName + ')' : '') : t('no')))
        ]),
        officeView ? kv(t('mailStatus'), r.mailStatus || '–') : null,
        officeView && r.version > 1 ? kv(t('changedBy'), (r.updatedBy || '') + ' · ' + (r.updatedAt || '')) : null
      ),
      ruler(r, false),
      DEMO && showDe ? h('p', { class: 'fine' }, t('demoTranslation')) : null
    ];
    const actions = h('div', { class: 'stack' });
    if (r.locked && !officeView) actions.append(h('p', { class: 'note' }, t('lockedNote')));
    if (!r.locked || officeView) {
      actions.append(h('a', { href: '#/edit/' + encodeURIComponent(r.id), class: 'btn btn-big', onclick: navClick }, icon('edit'), t('edit')));
    }
    if (officeView) {
      const docs = r.docs || {};
      const docLink = (url, label) => (/^https:\/\/docs\.google\.com\//.test(url || '')
        ? h('a', { href: url, class: 'btn', target: '_blank', rel: 'noopener noreferrer' }, icon('doc'), label) : null);
      actions.append(
        h('button', { type: 'button', class: 'btn ' + (r.locked ? '' : 'btn-primary'), onclick: async (ev) => {
          const b = ev.currentTarget; // nach "await" ist currentTarget leer
          b.disabled = true;
          try {
            const res = await api('approve', { id: r.id, approve: !r.locked }, { timeout: 70000 });
            toast(res.status === 'freigegeben' ? t('approved') : t('unapproved'));
            box.replaceChildren(h('p', { class: 'loading' }, t('loading')));
            const fresh = await api('get', { id: r.id });
            box.replaceChildren(...renderReport(fresh.report, true, box));
          } catch (e) { toast(errorText(e), 'error'); b.disabled = false; }
        } }, icon('check'), r.locked ? t('unapprove') : t('approve')),
        h('div', { class: 'row-btns' }, docLink(docs.de, t('docDe')), docLink(docs.orig, t('docOrig'))),
        h('button', { type: 'button', class: 'btn btn-quiet', onclick: async (ev) => {
          const b = ev.currentTarget; b.disabled = true;
          try { const res = await api('resend', { id: r.id }, { timeout: 120000 }); toast(res.mailSent ? t('resent') : t('resentFail'), res.mailSent ? '' : 'error'); }
          catch (e) { toast(errorText(e), 'error'); }
          b.disabled = false;
        } }, icon('mail'), t('resend'))
      );
    }
    out.push(actions);
    return out.filter(Boolean); // replaceChildren() würde ein null als Text "null" anzeigen
  }

  function viewList() {
    const el = h('div');
    fillHomeListsAll(el);
    return h('section', { class: 'screen' }, h('h1', { class: 'title' }, t('myReports')), el);
  }
  function fillHomeListsAll(el) {
    const render = (items) => {
      const cards = outboxMine().map(queuedCard).concat(items.map((r) => reportCard(r, false)));
      el.replaceChildren(cards.length ? h('div', { class: 'cards' }, cards) : h('p', { class: 'empty' }, t('noReports')));
    };
    render(store.get('mine.' + uid(), { items: [] }).items || []);
    api('list', { scope: 'mine' }).then((res) => { store.set('mine.' + uid(), { items: res.items, at: Date.now() }); if (el.isConnected) render(res.items); }).catch(() => {});
  }

  // ===================================================================
  //  Büro
  // ===================================================================
  function viewOffice() {
    const saved = store.get('officeFilter', null) || { from: todayIso(-13), to: todayIso(), employeeId: '', status: '' };
    const f = Object.assign({}, saved);
    const staff = meta().staff || [];
    const fromIn = h('input', { type: 'date', dir: 'ltr', value: f.from, onchange: (e) => { f.from = e.target.value; } });
    const toIn = h('input', { type: 'date', dir: 'ltr', value: f.to, onchange: (e) => { f.to = e.target.value; } });
    const empSel = h('select', { onchange: (e) => { f.employeeId = e.target.value; } }, h('option', { value: '' }, t('all')), staff.map((s) => h('option', { value: s.id }, s.name)));
    empSel.value = f.employeeId;
    const stSel = h('select', { onchange: (e) => { f.status = e.target.value; } }, h('option', { value: '' }, t('all')),
      ['eingereicht', 'korrigiert', 'freigegeben'].map((s) => h('option', { value: s }, t('st_' + s))));
    stSel.value = f.status;
    const results = h('div', { class: 'results' });
    const load = async () => {
      store.set('officeFilter', f);
      results.replaceChildren(h('p', { class: 'loading' }, t('loading')));
      try {
        const res = await api('list', { scope: 'all', from: f.from, to: f.to, employeeId: f.employeeId, status: f.status });
        const hours = res.items.reduce((s, x) => s + (Number(x.hours) || 0), 0);
        results.replaceChildren(
          h('p', { class: 'sum' }, t('sumLine', { n: res.items.length, h: fmtDur(Math.round(hours * 60)) })),
          res.items.length ? h('div', { class: 'cards' }, res.items.map((r) => reportCard(r, true))) : h('p', { class: 'empty' }, '–'));
      } catch (e) {
        if (e.code === 'auth') { logout(); toast(t('errAuth')); return; }
        results.replaceChildren(h('div', { class: 'note error' }, icon('alert'), h('p', null, errorText(e))));
      }
    };
    setTimeout(load, 0);
    return h('section', { class: 'screen' },
      h('h1', { class: 'title' }, t('allReports')),
      h('form', { class: 'filters', onsubmit: (e) => { e.preventDefault(); load(); } },
        h('div', { class: 'row-2' },
          h('label', { class: 'field' }, h('span', { class: 'cap' }, t('from')), fromIn),
          h('label', { class: 'field' }, h('span', { class: 'cap' }, t('to')), toIn)),
        h('div', { class: 'row-2' },
          h('label', { class: 'field' }, h('span', { class: 'cap' }, t('employee')), empSel),
          h('label', { class: 'field' }, h('span', { class: 'cap' }, t('status')), stSel)),
        h('button', { type: 'submit', class: 'btn' }, t('show'))),
      results);
  }

  function viewExport() {
    const now = new Date();
    const dow = (now.getDay() + 6) % 7; // 0 = Montag
    const mon = new Date(now); mon.setDate(now.getDate() - dow - 7);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    const f = { from: isoOf(mon), to: isoOf(sun) };
    const fromIn = h('input', { type: 'date', dir: 'ltr', value: f.from, onchange: (e) => { f.from = e.target.value; } });
    const toIn = h('input', { type: 'date', dir: 'ltr', value: f.to, onchange: (e) => { f.to = e.target.value; } });
    const setRange = (a, b) => { f.from = a; f.to = b; fromIn.value = a; toIn.value = b; };
    const btn = h('button', { type: 'submit', class: 'btn btn-primary btn-big' }, icon('mail'), t('excelList'));
    return h('section', { class: 'screen' },
      h('h1', { class: 'title' }, t('exportTitle')),
      h('p', { class: 'lead' }, t('exportHint')),
      h('div', { class: 'chips-s' },
        h('button', { type: 'button', class: 'chip-s', onclick: () => setRange(isoOf(mon), isoOf(sun)) }, t('lastWeek')),
        h('button', { type: 'button', class: 'chip-s', onclick: () => setRange(todayIso().slice(0, 8) + '01', todayIso()) }, t('thisMonth'))),
      h('form', { class: 'stack', onsubmit: async (e) => {
        e.preventDefault();
        btn.disabled = true;
        try {
          const res = await api('exportXlsx', { from: f.from, to: f.to }, { timeout: 120000 });
          toast(t('exportDone', { n: res.count, to: res.sentTo }));
        } catch (err) { toast(errorText(err), 'error'); }
        btn.disabled = false;
      } },
      h('div', { class: 'row-2' }, h('label', { class: 'field' }, h('span', { class: 'cap' }, t('from')), fromIn),
        h('label', { class: 'field' }, h('span', { class: 'cap' }, t('to')), toIn)),
      btn));
  }

  // ===================================================================
  //  Gerätetest und Systemcheck (Einrichtung und Fehlersuche)
  //  Bewusst deutsch: Bedient wird beides vom Büro oder vom Chef, nicht von den Mitarbeitern.
  //  Gerätetest: prüft dieses Handy und die Verbindung (auch ohne Anmeldung, erreichbar über #/test).
  //  Systemcheck: zeigt den Zustand des Servers (nur Büro).
  // ===================================================================
  const LEVEL = {
    ok: { icon: 'check', word: 'in Ordnung', mark: '[OK]' },
    info: { icon: 'info', word: 'Hinweis', mark: '[i] ' },
    warn: { icon: 'alert', word: 'Warnung', mark: '[!] ' },
    fail: { icon: 'close', word: 'Fehler', mark: '[X] ' },
    skip: { icon: 'dash', word: 'übersprungen', mark: '[-] ' },
    run: { icon: null, word: 'läuft', mark: '[…] ' }
  };
  const hostOf = (u) => { try { return new URL(String(u)).host; } catch (e) { return String(u || '').slice(0, 40); } };
  const fmtSec = (ms) => (Math.round(ms / 100) / 10).toString().replace('.', ',') + ' s';
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const clip = (s, n) => { const x = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return x.length > n ? x.slice(0, n - 1) + '…' : x; };
  const shortUrl = (u) => String(u).replace(/(\/s\/[A-Za-z0-9_-]{6})[A-Za-z0-9_-]+([A-Za-z0-9_-]{4})\//, '$1…$2/');
  const nowStamp = () => { const d = new Date(); return fmtDateFull(isoOf(d)) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
  const settle = (ms) => new Promise((r) => setTimeout(r, ms || 80));
  const countLevels = (list) => ({
    ok: list.filter((c) => c.level === 'ok').length,
    warn: list.filter((c) => c.level === 'warn').length,
    fail: list.filter((c) => c.level === 'fail').length
  });

  function checkRow(c) {
    const lv = LEVEL[c.level] || LEVEL.info;
    return h('li', { class: 'check-row ' + c.level },
      h('span', { class: 'check-ic' }, lv.icon ? icon(lv.icon) : h('span', { class: 'spinner-s', 'aria-hidden': 'true' })),
      h('div', { class: 'check-body' },
        h('div', { class: 'check-title' }, c.label, h('span', { class: 'sr' }, ' – ' + lv.word)),
        c.detail ? h('div', { class: 'check-detail' }, c.detail) : null));
  }

  /** Ergebniszeile über der Liste; mit `trilingual` zusätzlich Arabisch und Kurdisch (für Mitarbeiter, die den Test selbst starten). */
  function checkBanner(list, trilingual) {
    const n = countLevels(list);
    const kind = n.fail ? 'error' : (n.warn ? 'warn' : 'ok');
    const text = n.fail
      ? plural(n.fail, 'Fehler', 'Fehler') + (n.warn ? ' und ' + plural(n.warn, 'Warnung', 'Warnungen') : '')
      : (n.warn ? plural(n.warn, 'Warnung', 'Warnungen') : 'Alles in Ordnung');
    const key = kind === 'ok' ? 'testOk' : 'testProblem';
    return h('div', { class: 'note ' + kind, role: 'status' }, icon(n.fail ? 'close' : (n.warn ? 'alert' : 'check')),
      h('div', { class: 'multi' },
        h('p', null, text),
        trilingual ? h('p', { lang: 'ar', dir: 'rtl' }, I18N.ar[key]) : null,
        trilingual ? h('p', { lang: 'ku', dir: 'ltr' }, I18N.ku[key]) : null));
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
    } catch (e) { /* weiter mit dem alten Weg */ }
    try {
      const ta = h('textarea', { class: 'copy-ta', 'aria-hidden': 'true', readonly: true, tabindex: '-1' });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return !!ok;
    } catch (e) { return false; }
  }

  function reportButtons(getText, title) {
    const copy = h('button', {
      type: 'button', class: 'btn',
      onclick: async () => {
        const ok = await copyText(getText());
        toast(ok ? 'Bericht kopiert. Jetzt in eine Nachricht einfügen.' : 'Kopieren nicht möglich. Bitte „Bericht anzeigen“ öffnen und den Text von Hand markieren.', ok ? '' : 'error');
      }
    }, icon('doc'), 'Bericht kopieren');
    const out = [copy];
    if (navigator.share) {
      out.push(h('button', { type: 'button', class: 'btn', onclick: () => { navigator.share({ title, text: getText() }).catch(() => {}); } }, icon('send'), 'Bericht teilen'));
    }
    return out;
  }

  function uaSummary() {
    const ua = navigator.userAgent || '';
    let os = 'unbekanntes Betriebssystem';
    let m;
    if ((m = /(iPhone|iPad|iPod).*? OS (\d+)[_.](\d+)/.exec(ua))) os = 'iOS ' + m[2] + '.' + m[3];
    else if ((m = /Android (\d+(\.\d+)?)/.exec(ua))) os = 'Android ' + m[1];
    else if (/Windows/.test(ua)) os = 'Windows';
    else if (/Mac OS X/.test(ua)) os = isIOS ? 'iPadOS' : 'macOS';
    else if (/Linux/.test(ua)) os = 'Linux';
    let br = 'unbekannter Browser';
    if ((m = /SamsungBrowser\/(\d+)/.exec(ua))) br = 'Samsung Internet ' + m[1];
    else if ((m = /(EdgA|EdgiOS|Edg)\/(\d+)/.exec(ua))) br = 'Edge ' + m[2];
    else if ((m = /(FxiOS|Firefox)\/(\d+)/.exec(ua))) br = 'Firefox ' + m[2];
    else if ((m = /(CriOS|Chrome)\/(\d+)/.exec(ua))) br = 'Chrome ' + m[2];
    else if ((m = /Version\/(\d+(\.\d+)?).*Safari/.exec(ua))) br = 'Safari ' + m[1];
    return { os, br };
  }

  /** Eine Anfrage wie die der App, aber mit Zeitmessung und Beschreibung des Fehlers statt einer Ausnahme. */
  async function probe(body, ms) {
    const out = { t0: Date.now(), ms: 0 };
    const p0 = performance.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms || 20000);
    try {
      const res = await fetch(SERVER, {
        method: 'POST', body: JSON.stringify(body), signal: ctrl.signal, redirect: 'follow', credentials: 'omit', cache: 'no-store',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }
      });
      out.status = res.status;
      out.redirected = !!res.redirected;
      out.host = hostOf(res.url);
      const text = await res.text();
      out.text = text.slice(0, 1500);
      try { out.data = JSON.parse(text); } catch (e) { out.notJson = true; }
    } catch (e) {
      out.error = e && e.name === 'AbortError' ? 'timeout' : 'network';
    } finally {
      clearTimeout(timer);
      out.ms = performance.now() - p0;
      out.t1 = Date.now();
    }
    return out;
  }

  /** Antwortet der Host überhaupt? (ohne die Antwort lesen zu müssen – so lässt sich "Verbindung fehlt" von "Antwort gesperrt" trennen) */
  async function reachable(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try { await fetch(url, { mode: 'no-cors', cache: 'no-store', credentials: 'omit', signal: ctrl.signal }); return true; } catch (e) { return false; } finally { clearTimeout(timer); }
  }

  /** Server vor Version 1.0.2 kennt "ping" nicht – die Version steht aber auf der Statusseite (GET). */
  async function legacyVersion() {
    try {
      const r = await fetch(SERVER, { cache: 'no-store', credentials: 'omit' });
      const d = await r.json();
      return d && d.version ? String(d.version) : '?';
    } catch (e) { return '?'; }
  }

  /** Erlaubt die Sicherheitsregel in index.html Verbindungen zu dieser Adresse? (ohne Regel: ja) */
  function cspAllowsConnect(url) {
    try {
      const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
      const dir = ((meta && meta.getAttribute('content')) || '').split(';').map((x) => x.trim()).find((x) => /^connect-src(\s|$)/.test(x));
      if (!dir) return true;
      const origin = new URL(url).origin;
      return dir.split(/\s+/).slice(1).some((src) => (src === "'self'" ? origin === location.origin : src.replace(/\/$/, '') === origin));
    } catch (e) { return true; }
  }

  /** Chromium meldet bei einer gesperrten Umleitung NICHT das Ziel (z. B. accounts.google.com), sondern die ursprüngliche Adresse.
      Ist diese Adresse laut Sicherheitsregel erlaubt, kann die Sperre nur von einer Umleitung auf eine fremde Adresse kommen
      – bei Google praktisch immer die Anmeldeseite, weil „Zugriff: Jeder“ fehlt. (Geprüft in Chromium; Safari/Firefox melden eventuell das Ziel – beides wird erkannt.) */
  function redirectBlocked(c) {
    return !!c && c.d === 'connect-src' && c.h === hostOf(SERVER) && cspAllowsConnect(SERVER);
  }

  const isLoginHost = (h) => /(^|\.)accounts\.google\.com$/.test(String(h || ''));
  const LOGIN_FIX = 'In Apps Script unter „Bereitstellen → Bereitstellungen verwalten → Bearbeiten“ muss bei „Ausführen als“ die Auswahl „Ich“ und bei „Zugriff“ die Auswahl „Jeder“ stehen (nicht „Jeder mit Google-Konto“). Danach eine NEUE VERSION bereitstellen und diese Seite neu laden.';

  /** Meldung, wenn der Browser eine Umleitung der Anfrage gesperrt hat (leer = diese Liste sagt dazu nichts).
      Meldet der Browser die Anmeldeseite selbst, ist es sicher; meldet er nur die ursprüngliche Adresse (Chromium), heißt es vorsichtig „fast immer“. */
  function redirectMessage(list) {
    if (list.some((c) => isLoginHost(c.h))) {
      return 'Google verlangt eine Anmeldung (die Anfrage wurde auf die Google-Anmeldeseite umgeleitet). ' + LOGIN_FIX;
    }
    if (list.some(redirectBlocked)) {
      return 'Google leitet die Anfrage auf eine Adresse um, die die App nicht aufrufen darf. Fast immer ist das die Google-Anmeldeseite. ' + LOGIN_FIX + ' Steht das schon so, bitte den Bericht schicken.';
    }
    return '';
  }

  /** Übersetzt einen gescheiterten Verbindungsversuch in einen Satz, mit dem das Büro etwas anfangen kann. */
  async function explainFailure(p, csp) {
    const viaRedirect = redirectMessage(csp);
    if (viaRedirect) return viaRedirect;
    if (csp.length) {
      return 'Die Sicherheitsregel der App blockiert die Verbindung (' + csp[0].d + ' → ' + (csp[0].h || '?') + '). Die Datei index.html darf nicht verändert werden. Seite neu laden; bleibt es so, den Bericht schicken.';
    }
    if (p.error === 'timeout') {
      return 'Keine Antwort innerhalb von 20 Sekunden. Entweder ist die Verbindung sehr schlecht oder Google antwortet nicht. Noch einmal versuchen, gern zwischen WLAN und Mobilfunk wechseln.';
    }
    if (p.error === 'network') {
      if (navigator.onLine === false) return 'Das Handy meldet: kein Internet.';
      // Fehlt der CORS-Kopf schon an der Umleitung auf die Anmeldeseite, scheitert die Anfrage ohne Sicherheitsregel-Ereignis.
      // Die Probe unten folgt der Umleitung ohne CORS-Prüfung – dabei meldet der Browser die Sperre.
      const n0 = S.csp.length;
      const direct = await reachable(SERVER);
      if (!direct) {
        await settle(200);
        const viaProbe = redirectMessage(S.csp.slice(n0));
        if (viaProbe) return viaProbe;
      }
      if (direct) {
        return 'Google ist erreichbar, aber der Browser darf die Antwort nicht lesen. Mögliche Ursachen: ' +
          '(1) Bei der Bereitstellung steht „Zugriff“ nicht auf „Jeder“. ' +
          '(2) Die Adresse in config.js ist nicht die /exec-Adresse der aktuellen Bereitstellung (nicht /dev, nicht gelöscht). ' +
          '(3) Der Server-Code ist unvollständig eingefügt oder bricht mit einem Fehler ab (Apps Script → „Ausführungen“ ansehen). ' +
          'Zuerst die Adresse in einem neuen Browser-Tab öffnen: Es muss eine Zeile mit "ok":true erscheinen.';
      }
      if (await reachable('https://script.google.com/')) {
        return 'Google ist erreichbar, aber diese Adresse nicht. Mögliche Ursachen: Die Web-App-URL in config.js ist falsch oder die Bereitstellung wurde gelöscht; oder ein Werbeblocker, VPN oder Netzwerkfilter sperrt diese Adresse. Bitte die URL in Apps Script unter „Bereitstellungen verwalten“ neu kopieren und Blocker ausschalten.';
      }
      return 'Keine Verbindung zu Google. Bitte WLAN oder Mobilfunk prüfen, VPN, Werbeblocker und Netzwerkfilter ausschalten und noch einmal testen.';
    }
    if (p.status && p.status >= 400) {
      if (p.status === 404) return 'Die Adresse gibt es nicht (HTTP 404). Bitte die Web-App-URL in config.js prüfen.';
      if (p.status === 401 || p.status === 403) return 'Zugriff verweigert (HTTP ' + p.status + '). Bei der Bereitstellung muss „Zugriff: Jeder“ stehen.';
      return 'Google meldet einen Fehler (HTTP ' + p.status + '). In einigen Minuten noch einmal versuchen.';
    }
    if (p.notJson) {
      const x = p.text || '';
      if (/accounts\.google|ServiceLogin|Sign in|Anmelden/i.test(x)) return 'Google zeigt eine Anmeldeseite statt der Daten. Bei der Bereitstellung muss „Zugriff: Jeder“ stehen.';
      if (/Script function not found|doPost/i.test(x)) return 'Im Apps-Script-Projekt fehlt die Funktion doPost. Bitte den kompletten Inhalt von Code.gs neu einfügen und neu bereitstellen.';
      if (/unable to open|nicht geöffnet|Datei kann/i.test(x)) return 'Die Adresse gehört zu keiner aktiven Bereitstellung. Bitte die Web-App-URL neu aus Apps Script kopieren.';
      return 'Unerwartete Antwort (kein JSON): ' + clip(x.replace(/<[^>]*>/g, ' '), 160);
    }
    return 'Unerwartete Antwort: ' + clip(JSON.stringify(p.data), 160);
  }

  function canvasProbe() {
    const c = document.createElement('canvas');
    c.width = 8; c.height = 8;
    const g = c.getContext && c.getContext('2d', { willReadFrequently: true });
    if (!g) return ['fail', 'Der Browser bietet keine Zeichenfläche. Unterschreiben ist so nicht möglich.'];
    g.fillStyle = '#ff0000';
    g.fillRect(0, 0, 8, 8);
    let px;
    let url;
    try { px = g.getImageData(3, 3, 1, 1).data; url = c.toDataURL('image/png'); } catch (e) {
      return ['warn', 'Der Browser sperrt das Auslesen der Zeichenfläche (Datenschutz- oder Anti-Tracking-Modus). Unterschriften könnten nicht gespeichert werden. Bitte Chrome oder Safari ohne Schutzmodus benutzen.'];
    }
    const touch = 'Touch: ' + (navigator.maxTouchPoints || 0) + ' Punkt(e)' + (window.PointerEvent ? ', Pointer-Events' : ', keine Pointer-Events');
    if (!/^data:image\/png;base64,/.test(url)) return ['fail', 'Die Zeichenfläche liefert kein PNG-Bild. Unterschriften können nicht gespeichert werden.'];
    if (px[0] !== 255 || px[1] !== 0 || px[2] !== 0 || px[3] !== 255) {
      return ['warn', 'Der Browser verfälscht Zeichenflächen (Datenschutz- oder Anti-Tracking-Modus). Unterschriften könnten leer oder gestört ankommen. Bitte Chrome oder Safari ohne Schutzmodus benutzen. (' + touch + ')'];
    }
    return ['ok', 'Unterschrift-Feld funktioniert (' + touch + ')'];
  }

  async function storageProbe() {
    if (!LS_OK) return ['fail', 'Dieser Browser erlaubt kein dauerhaftes Speichern (privater Modus?). Ohne Internet erfasste Nachweise gehen beim Schließen verloren. Bitte die App normal (nicht privat) öffnen.'];
    const key = 'ln.__probe';
    let fits = true;
    try { localStorage.setItem(key, 'x'.repeat(1000000)); } catch (e) { fits = false; } finally { try { localStorage.removeItem(key); } catch (e) { /* egal */ } }
    let est = '';
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const e = await navigator.storage.estimate();
        if (e && e.quota) est = ' · belegt ' + (Math.round((e.usage || 0) / 1e5) / 10).toString().replace('.', ',') + ' MB von ' + Math.round(e.quota / 1e6) + ' MB';
      }
    } catch (e) { /* egal */ }
    const queued = outboxMine().length;
    const q = queued ? ' · ' + plural(queued, 'Nachweis wartet', 'Nachweise warten') + ' auf diesem Handy aufs Senden' : '';
    if (!fits) return ['warn', 'Der Speicher der App ist fast voll (1 MB frei zu machen war nicht möglich). Nachweise ohne Internet könnten sich nicht mehr speichern lassen. Bitte Website-Daten anderer Seiten löschen oder die App neu installieren.' + est + q];
    return ['ok', 'Speichern funktioniert' + est + q];
  }

  async function offlineProbe() {
    if (window.LN_NO_SW) return ['info', 'In der Vorschau ist der Offline-Speicher abgeschaltet.'];
    if (!('serviceWorker' in navigator)) return ['warn', 'Dieser Browser kann die App nicht für den Start ohne Internet speichern. Sie startet dann nur mit Internet; bereits erfasste Nachweise gehen nicht verloren.'];
    if (location.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return ['warn', 'Die Seite ist nicht über https geöffnet – dann gibt es keinen Start ohne Internet.'];
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return ['warn', 'Noch nicht eingerichtet. Bitte die Seite einmal neu laden und den Test wiederholen.'];
    const name = 'ln-app-' + APP_VERSION;
    let files = 0;
    let has = false;
    try {
      if (window.caches) {
        has = (await caches.keys()).indexOf(name) >= 0;
        if (has) files = (await (await caches.open(name)).keys()).length;
      }
    } catch (e) { /* egal */ }
    if (!has) return ['warn', 'Der Offline-Speicher dieser Version fehlt (' + name + '). Seite einmal neu laden, ggf. vom Startbildschirm entfernen und neu hinzufügen.'];
    if (!navigator.serviceWorker.controller) return ['warn', 'Der Offline-Speicher ist angelegt, steuert diese Seite aber noch nicht. Bitte einmal neu laden.'];
    return ['ok', 'Die App startet auch ohne Internet (' + name + ', ' + plural(files, 'Datei', 'Dateien') + ').'];
  }

  async function speechProbe() {
    if (EMBED) return ['info', 'In der Vorschau ist das Mikrofon gesperrt.'];
    let perm = '';
    try {
      if (navigator.permissions && navigator.permissions.query) {
        const st = await navigator.permissions.query({ name: 'microphone' });
        perm = ' · Mikrofon-Erlaubnis: ' + ({ granted: 'erteilt', denied: 'abgelehnt', prompt: 'wird beim ersten Mal gefragt' }[st.state] || st.state);
      }
    } catch (e) { /* Safari kennt die Abfrage nicht */ }
    if (SR) return ['ok', 'Diktierfunktion des Browsers ist vorhanden (Arabisch, Kurdisch: je nach Gerät)' + perm];
    return ['info', (isIOS ? 'Auf dem iPhone gibt es in der App keine eigene Diktierfunktion. ' : 'Dieser Browser bietet auf Webseiten keine Diktierfunktion. ') + 'Bitte das Mikrofon der Tastatur benutzen – der Tipp dazu steht im Formular.'];
  }

  async function fontsProbe() {
    if (!document.fonts || !document.fonts.load) return ['info', 'Der Browser kann die Schrift nicht prüfen. Bitte die Beispiele unten ansehen.'];
    try {
      const a = await document.fonts.load('600 17px "LN Sans"', 'مرحبا');
      const k = await document.fonts.load('600 17px "LN Sans"', 'şêîûç');
      if (a.length && k.length) return ['ok', 'Schriften für Arabisch und Kurdisch sind geladen'];
      return ['warn', 'Die mitgelieferte Schrift ist nicht vollständig geladen. Die Anzeige nutzt die Systemschrift; Kurdische Sonderzeichen können dann fehlen.'];
    } catch (e) {
      return ['warn', 'Die mitgelieferte Schrift konnte nicht geladen werden. Die Anzeige nutzt die Systemschrift; Kurdische Sonderzeichen können dann fehlen.'];
    }
  }

  function viewTest() {
    const rows = [];
    const tech = [];
    let running = false;
    let runs = 0;
    const list = h('ol', { class: 'check-list' });
    const banner = h('div');
    const reportBox = h('pre', { class: 'report-pre' });
    const btns = h('div', { class: 'btn-row' });
    const again = h('button', { type: 'button', class: 'btn btn-primary btn-big', onclick: () => run() }, 'Test starten');
    const draw = () => list.replaceChildren(...rows.map(checkRow));
    const report = () => {
      const n = countLevels(rows);
      return ['Leistungsnachweis – Gerätetest', 'Zeit: ' + nowStamp() + ' · App ' + APP_VERSION,
        'Ergebnis: ' + n.ok + ' in Ordnung · ' + plural(n.warn, 'Warnung', 'Warnungen') + ' · ' + plural(n.fail, 'Fehler', 'Fehler'), '',
        ...rows.map((r) => LEVEL[r.level].mark + ' ' + r.label + ': ' + r.detail), '', 'Technik',
        ...tech.map((x) => ' ' + x), ' User-Agent: ' + (navigator.userAgent || '?')].join('\n');
    };
    const step = async (label, fn) => {
      const row = { label, level: 'run', detail: '' };
      rows.push(row);
      draw();
      try { const r = await fn(); row.level = r[0]; row.detail = r[1]; } catch (e) { row.level = 'fail'; row.detail = 'Der Test selbst ist abgestürzt: ' + clip(e && e.message, 160); }
      draw();
      return row;
    };

    const run = async () => {
      if (running) return;
      running = true;
      rows.length = 0;
      tech.length = 0;
      again.disabled = true;
      again.textContent = 'Test läuft …';
      btns.replaceChildren();
      banner.replaceChildren();
      reportBox.textContent = '';
      if (runs++) S.csp.length = 0; // beim erneuten Test zählt nur, was jetzt noch passiert (sonst bliebe eine längst behobene Sperre stehen)
      const csp0 = S.csp.length;
      const live = !DEMO && URL_OK;
      let ping = null;
      let netFail = false;

      await step('Handy und Browser', async () => {
        const { os, br } = uaSummary();
        const missing = [['fetch', typeof fetch === 'function'], ['AbortController', typeof AbortController === 'function'],
          ['Zeichenfläche', !!(document.createElement('canvas').getContext)]].filter((x) => !x[1]).map((x) => x[0]);
        let tz = '?';
        try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '?'; } catch (e) { /* egal */ }
        tech.push('Bildschirm: ' + innerWidth + '×' + innerHeight + ' px, Pixeldichte ' + (window.devicePixelRatio || 1) + ', Sprache ' + (navigator.language || '?') + ', Zeitzone ' + tz);
        tech.push('App-Sprache: ' + (S.lang || 'noch nicht gewählt'));
        const d = os + ' · ' + br + ' · ' + (isStandalone() ? 'als App installiert' : 'im Browser geöffnet');
        return missing.length ? ['fail', d + ' · Dieser Browser ist zu alt (es fehlt: ' + missing.join(', ') + '). Bitte Chrome oder Safari aktualisieren.'] : ['ok', d];
      });

      await step('Server-Adresse (config.js)', async () => {
        if (DEMO) return ['info', 'Demo-Modus: In config.js steht keine Server-Adresse. Die App funktioniert, sendet aber nichts. Für den echten Betrieb die Web-App-URL aus Apps Script dort eintragen.'];
        if (CONFIG_ERROR) return ['fail', 'Die Adresse in config.js ist ungültig („' + clip(RAW_URL, 60) + '“). Sie muss mit https://script.google.com/macros/s/ beginnen und auf /exec enden.'];
        tech.push('Adresse: ' + shortUrl(SERVER));
        return ['ok', shortUrl(SERVER)];
      });

      if (live) {
        await step('Internet', async () => {
          if (navigator.onLine === false) { netFail = true; return ['fail', 'Das Handy meldet: kein Internet. WLAN oder Mobilfunk einschalten und den Test wiederholen.']; }
          const c = navigator.connection;
          const extra = c ? ' · ' + [c.effectiveType, c.saveData ? 'Datensparmodus an' : ''].filter(Boolean).join(', ') : '';
          return ['ok', 'verbunden' + extra];
        });
      }

      if (live && !netFail) {
        await step('Verbindung zum Server', async () => {
          const times = [];
          for (let i = 0; i < 3; i++) {
            const p = await probe({ action: 'ping' }, 20000);
            const good = !p.error && !p.notJson && p.data && p.data.ok === true;
            if (!good) {
              if (!p.error && !p.notJson && p.data && p.data.error === 'unknown_action') {
                ping = { old: true, version: await legacyVersion() };
                return ['warn', 'Der Server antwortet, ist aber älter als die App (er kennt „ping“ noch nicht).'];
              }
              await settle(200); // das Ereignis der Sicherheitsregel trifft kurz nach dem Fehler ein
              const why = await explainFailure(p, S.csp.slice(csp0));
              if (i === 0) { netFail = true; return ['fail', why]; }
              return ['warn', plural(times.length, 'Antwort kam', 'Antworten kamen') + ' (' + times.map(fmtSec).join(' · ') + '), die nächste schlug fehl: ' + why];
            }
            times.push(p.ms);
            if (i === 0) {
              ping = p.data;
              ping.skew = Number(p.data.time) - (p.t0 + (p.t1 - p.t0) / 2);
              tech.push('Antwort: HTTP ' + p.status + (p.redirected ? ', weitergeleitet über ' + p.host : ''));
            }
          }
          const max = Math.max.apply(null, times);
          tech.push('Antwortzeiten: ' + times.map(fmtSec).join(' · '));
          return [max > 6000 ? 'warn' : 'ok', 'drei Antworten: ' + times.map(fmtSec).join(' · ') +
            (max > 6000 ? ' – ungewöhnlich langsam (Apps Script braucht nach Pausen etwas länger; Verbindung prüfen)' : '')];
        });

        await step('Version von App und Server', async () => {
          if (!ping) return ['skip', 'übersprungen (keine Verbindung)'];
          if (ping.old) return ['warn', 'App ' + APP_VERSION + ' · Server ' + ping.version + '. Der Server ist älter als die App: In Apps Script den neuen Code einfügen und unter „Bereitstellen → Bereitstellungen verwalten → Bearbeiten“ eine NEUE VERSION bereitstellen (die Adresse bleibt gleich).'];
          if (String(ping.version) !== APP_VERSION) return ['warn', 'App ' + APP_VERSION + ' · Server ' + ping.version + '. Beide sollten gleich sein: entweder in Apps Script neu bereitstellen (neue Version) oder die App neu laden (ggf. vom Startbildschirm entfernen und neu hinzufügen).'];
          return ['ok', 'App ' + APP_VERSION + ' · Server ' + ping.version];
        });

        await step('Server eingerichtet', async () => {
          if (!ping) return ['skip', 'übersprungen (keine Verbindung)'];
          if (ping.old) return ['skip', 'übersprungen (alter Server)'];
          if (ping.eingerichtet === false) return ['fail', 'Der Server meldet: noch nicht eingerichtet. In Apps Script die Funktion „einrichten“ ausführen (Anleitung, Schritt „Einrichten“).'];
          return ['ok', 'Tabelle, Ordner und Geheimnis sind vorhanden'];
        });

        await step('Uhr des Handys', async () => {
          if (!ping || ping.old) return ['skip', 'übersprungen'];
          const skew = ping.skew;
          const phoneDay = todayIso();
          let serverDay = phoneDay;
          try { serverDay = new Intl.DateTimeFormat('en-CA', { timeZone: ping.tz || 'Europe/Berlin' }).format(new Date(Number(ping.time))); } catch (e) { /* egal */ }
          tech.push('Uhr: Abweichung zum Server ' + Math.round(skew / 1000) + ' s; Handy-Datum ' + phoneDay + ', Server-Datum ' + serverDay);
          const mins = Math.round(Math.abs(skew) / 60000);
          const dir = skew > 0 ? 'geht nach' : 'geht vor';
          if (phoneDay !== serverDay) return ['fail', 'Das Datum des Handys (' + fmtDateFull(phoneDay) + ') weicht vom Server (' + fmtDateFull(serverDay) + ') ab. „Heute“ im Formular wäre falsch. In den Einstellungen Datum und Uhrzeit auf „automatisch“ stellen.'];
          if (Math.abs(skew) > 30 * 60000) return ['fail', 'Die Uhr des Handys ' + dir + ' um etwa ' + mins + ' Minuten. Bitte in den Einstellungen Datum und Uhrzeit auf „automatisch“ stellen.'];
          if (Math.abs(skew) > 3 * 60000) return ['warn', 'Die Uhr des Handys ' + dir + ' um etwa ' + mins + ' Minuten. Bitte Datum und Uhrzeit auf „automatisch“ stellen.'];
          return ['ok', 'stimmt (Abweichung unter 3 Minuten)'];
        });
      }

      if (!live) {
        await step('Verbindung zum Server', async () => ['skip', DEMO ? 'übersprungen (Demo-Modus)' : 'übersprungen (Server-Adresse ungültig)']);
      }

      await step('Anmeldung und Daten', async () => {
        if (!S.auth) return ['info', 'Nicht angemeldet – geprüft wird dann nur die Verbindung. Nach der Anmeldung den Test noch einmal starten: Dann wird auch das Laden von Baustellen und Tätigkeiten geprüft.'];
        if (live && (netFail || !ping)) return ['skip', 'übersprungen (keine Verbindung)'];
        const p0 = performance.now();
        try {
          const b = await api('bootstrap', {}, { timeout: 30000 });
          const msg = 'angemeldet als ' + b.user.name + (b.user.isOffice ? ' (Büro)' : '') + ' · ' + plural((b.projects || []).length, 'Baustelle', 'Baustellen') +
            ' · ' + plural((b.activities || []).length, 'Tätigkeit', 'Tätigkeiten') + ' · ' + fmtSec(performance.now() - p0);
          if (!(b.projects || []).length) return ['warn', msg + ' · Es ist keine Baustelle eingetragen (Blatt „Bauvorhaben“).'];
          if (!(b.activities || []).length) return ['warn', msg + ' · Es ist keine Tätigkeit eingetragen (Blatt „Tätigkeiten“).'];
          return ['ok', msg];
        } catch (e) {
          if (e.code === 'auth') return ['fail', 'Die Anmeldung dieses Handys ist abgelaufen oder ungültig (PIN geändert oder Mitarbeiter deaktiviert). Bitte neu anmelden.'];
          return ['fail', 'Baustellen und Tätigkeiten konnten nicht geladen werden (' + (e.network ? 'keine Verbindung' : e.code) + ').'];
        }
      });

      await step('Speicher auf dem Handy', storageProbe);
      await step('Start ohne Internet', offlineProbe);
      await step('Unterschrift-Feld', async () => canvasProbe());
      await step('Spracheingabe (Diktat)', speechProbe);
      await step('Schrift (Arabisch, Kurdisch)', fontsProbe);

      await step('Sicherheitsregel des Browsers', async () => {
        const seen = S.csp.slice();
        if (!seen.length) return ['ok', 'keine Verstöße seit dem Öffnen der App'];
        const lines = seen.slice(0, 5).map((c) => c.d + ' → ' + (c.h || '?') + (isLoginHost(c.h) ? ' (Google-Anmeldeseite)' : (redirectBlocked(c) ? ' (Umleitung des Servers auf eine nicht erlaubte Adresse)' : '')));
        tech.push('Sicherheitsregel: ' + lines.join('; '));
        const viaLogin = seen.some((c) => isLoginHost(c.h) || redirectBlocked(c));
        return ['warn', plural(seen.length, 'Verstoß', 'Verstöße') + ': ' + lines.join('; ') + '. ' +
          (viaLogin ? 'Das passiert, wenn Google auf die Anmeldeseite umleitet („Zugriff: Jeder“ fehlt, siehe oben).' : 'Etwas wurde blockiert; bitte den Bericht schicken.')];
      });

      await step('Fotos hochladen', async () => {
        const inp = document.createElement('input');
        inp.type = 'file';
        const canPick = inp.type === 'file';
        let canShrink = false;
        try {
          const c = document.createElement('canvas');
          c.width = 8; c.height = 8;
          const g = c.getContext('2d');
          if (g) { g.fillRect(0, 0, 8, 8); canShrink = c.toDataURL('image/jpeg', 0.7).slice(0, 15) === 'data:image/jpeg'; }
        } catch (e) { canShrink = false; }
        tech.push('Fotos: auswählen ' + canPick + ', verkleinern ' + canShrink);
        if (!canPick || !canShrink) return ['fail', 'Dieses Handy kann in der App keine Fotos anhängen. Bitte einen anderen Browser versuchen (Android: Chrome, iPhone: Safari).'];
        return ['ok', 'Fotos vom Handy hochladen und verkleinern möglich (höchstens ' + PHOTO_MAX + ' je Nachweis)'];
      });

      if (TEXT_FIXES.applied || TEXT_FIXES.ignored.length) {
        await step('Textkorrekturen (config.js)', async () => {
          if (TEXT_FIXES.ignored.length) return ['warn', plural(TEXT_FIXES.applied, 'Korrektur', 'Korrekturen') + ' angewendet, ' + TEXT_FIXES.ignored.length + ' ignoriert (unbekannte Sprache oder Schlüssel, falscher Platzhalter, kein Text oder zu lang): ' + TEXT_FIXES.ignored.slice(0, 6).join(', ') + (TEXT_FIXES.ignored.length > 6 ? ' …' : '')];
          return ['ok', plural(TEXT_FIXES.applied, 'Korrektur', 'Korrekturen') + ' angewendet'];
        });
      }

      banner.replaceChildren(checkBanner(rows, true));
      reportBox.textContent = report();
      btns.replaceChildren(...reportButtons(report, 'Leistungsnachweis – Gerätetest'));
      again.disabled = false;
      again.textContent = 'Test noch einmal starten';
      running = false;
    };

    setTimeout(run, 0);
    return h('section', { class: 'screen', lang: 'de', dir: 'ltr' },
      h('h1', { class: 'title' }, 'Gerätetest'),
      h('p', { class: 'lead' }, 'Prüft dieses Handy und die Verbindung zum Server. Dauert etwa 15 Sekunden. Es wird nichts gesendet und nichts gespeichert.'),
      banner, list,
      h('div', { class: 'sample', 'aria-label': 'Sichtprüfung der Schrift' },
        h('p', { lang: 'ar', dir: 'rtl' }, 'تركيب ألواح الجبس بورد في الطابق الثاني، ٤٠ م²'),
        h('p', { lang: 'ku', dir: 'ltr' }, 'Boyaxkirina dîwaran, çêkirina şapê û îzolasyonê'),
        h('p', { lang: 'de', dir: 'ltr' }, 'Trockenbau im 2. OG, Fliesenarbeiten, Außenputz')),
      h('p', { class: 'fine' }, 'Sichtprüfung: Das Arabische muss verbunden von rechts nach links stehen, das Kurdische mit ê î û ç ş – und nirgends ein Kästchen (▯).'),
      btns,
      h('details', { class: 'report-details' }, h('summary', null, 'Bericht anzeigen'), reportBox),
      again,
      h('a', { href: '#/', class: 'link' }, 'Zurück zur App')
    );
  }

  function viewCheck() {
    const list = h('ol', { class: 'check-list' });
    const banner = h('div');
    const meta = h('p', { class: 'check-meta' });
    const reportBox = h('pre', { class: 'report-pre' });
    const btns = h('div', { class: 'btn-row' });
    let checks = [];
    let stamp = '';
    const btn = h('button', { type: 'button', class: 'btn btn-primary btn-big', onclick: () => load() }, icon('check'), 'Jetzt prüfen');
    const text = () => ['Leistungsnachweis – Systemcheck', stamp, '', ...checks.map((c) => (LEVEL[c.level] || LEVEL.info).mark + ' ' + c.label + ': ' + c.detail)].join('\n');
    const load = async () => {
      btn.disabled = true;
      banner.replaceChildren();
      meta.textContent = '';
      btns.replaceChildren();
      list.replaceChildren(checkRow({ level: 'run', label: 'Wird geprüft …', detail: 'Das dauert ein paar Sekunden.' }));
      try {
        const res = await api('health', {}, { timeout: 60000 });
        checks = Array.isArray(res.checks) ? res.checks : [];
        stamp = 'Stand ' + res.generated + ' · Server ' + res.version + ' · App ' + APP_VERSION;
        list.replaceChildren(...checks.map(checkRow));
        banner.replaceChildren(checkBanner(checks, false));
        meta.textContent = stamp;
        reportBox.textContent = text();
        btns.replaceChildren(...reportButtons(text, 'Leistungsnachweis – Systemcheck'));
      } catch (e) {
        if (e.code === 'auth') { logout(); toast(t('errAuth')); return; }
        checks = [];
        list.replaceChildren();
        banner.replaceChildren(h('div', { class: 'note error', role: 'alert' }, icon('alert'), h('p', null,
          e.code === 'unknown_action' ? 'Der Server ist älter als die App und kennt den Systemcheck noch nicht. Bitte den neuen Code in Apps Script einfügen und neu bereitstellen.'
            : e.code === 'forbidden' ? 'Der Systemcheck ist nur für das Büro.'
              : 'Der Systemcheck konnte nicht geladen werden (' + (e.network ? 'keine Verbindung' : e.code) + '). Der Gerätetest zeigt, woran es liegt.')));
      } finally {
        btn.disabled = false;
        btn.replaceChildren(icon('check'), 'Noch einmal prüfen');
      }
    };
    setTimeout(load, 0);
    return h('section', { class: 'screen', lang: 'de', dir: 'ltr' },
      h('h1', { class: 'title' }, 'Systemcheck'),
      h('p', { class: 'lead' }, 'Zeigt, ob auf dem Server alles läuft: Automatik, Sicherung, E-Mail, Speicher, Geschwindigkeit.'),
      banner, list, meta, btns,
      h('details', { class: 'report-details' }, h('summary', null, 'Bericht anzeigen'), reportBox),
      btn,
      h('a', { href: '#/test', class: 'link', onclick: navClick }, 'Gerätetest für dieses Handy')
    );
  }

  // ===================================================================
  //  Demo-Modus (ohne Server): gleiche Abläufe, Daten nur im Browser
  // ===================================================================
  const DEMO_STAFF = [
    { id: 'D1', name: 'Ahmad (Demo)', pin: '111111', lang: 'ar', isOffice: false },
    { id: 'D2', name: 'Rojhat (Demo)', pin: '222222', lang: 'ku', isOffice: false },
    { id: 'D9', name: 'Büro (Demo)', pin: '99999999', lang: 'de', isOffice: true }
  ];
  const DEMO_PROJECTS = [
    { id: 'B01', name: 'Wohnhaus Bergstraße 12', info: 'Neubau' },
    { id: 'B02', name: 'Kita Sonnenblume', info: 'Anbau' },
    { id: 'B03', name: 'Bürohaus Hafenstraße', info: 'Innenausbau' }
  ];
  const DEMO_ACTIVITIES = [
    ['T01', 'Abbrucharbeiten', 'أعمال هدم', 'Karên hilweşandinê'], ['T02', 'Erdarbeiten / Aushub', 'أعمال حفر وتراب', 'Karên axê / kolandin'],
    ['T03', 'Mauerarbeiten', 'أعمال بناء (بلوك / طوب)', 'Dîwarçêkirin'], ['T04', 'Betonarbeiten', 'صب الباطون', 'Karên betonê'],
    ['T05', 'Schalung', 'أعمال الطوبار', 'Qalib (kalıp)'], ['T06', 'Bewehrung / Eisen', 'أعمال التسليح (الحديد)', 'Hesin / armatur'],
    ['T07', 'Putzarbeiten', 'أعمال الزريقة (اللياسة)', 'Sîvaxkirin'], ['T08', 'Trockenbau', 'أعمال الجبس بورد', 'Alçîpan'],
    ['T09', 'Estrich', 'صبة أرضية (ستريش)', 'Şapa erdê'], ['T10', 'Fliesenarbeiten', 'أعمال التبليط (سيراميك)', 'Seramîk / kaşî'],
    ['T11', 'Malerarbeiten', 'أعمال الدهان', 'Boyaxkirin'], ['T12', 'Dämmung', 'أعمال العزل', 'Îzolasyon'],
    ['T13', 'Gerüstbau', 'تركيب السقالات', 'Îskele'], ['T14', 'Material transportieren', 'نقل المواد', 'Veguhastina malzemeyan'],
    ['T15', 'Aufräumen / Reinigung', 'تنظيف وترتيب الموقع', 'Paqijkirin'], ['T16', 'Entsorgung / Bauschutt', 'ترحيل الأنقاض', 'Avêtina bermayiyan'],
    ['T17', 'Sonstiges', 'أعمال أخرى', 'Karên din']
  ].map((a) => ({ id: a[0], de: a[1], ar: a[2], ku: a[3] }));

  function demoApi(action, p) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try { resolve(demoHandle(action, p)); } catch (e) { reject(e); }
      }, action === 'submit' ? 700 : 150);
    });
  }
  function demoSeed(db) {
    // Drei Beispiel-Nachweise, damit die Demo nicht leer startet (klar als Beispiel markiert)
    const mk = (days, emp, lang, proj, start, end, pause, acts, orig, de, status, version) => {
      const d = todayIso(-days);
      const s = DEMO_STAFF.find((x) => x.id === emp);
      const p = DEMO_PROJECTS.find((x) => x.id === proj);
      const lab = (id, l) => { const a = DEMO_ACTIVITIES.find((x) => x.id === id); return (l === 'ar' && a.ar) || (l === 'ku' && a.ku) || a.de; };
      db.counter += 1;
      return {
        id: d.slice(0, 4) + '-' + String(db.counter).padStart(4, '0'), version, status, lang, employeeId: emp, employeeName: s.name,
        date: d, start, end, pauseMin: pause, hours: Math.round((toMin(end) - toMin(start) - pause) / 60 * 100) / 100,
        projectId: proj, projectOrig: p.name, projectDe: p.name, activityIds: acts,
        activitiesDe: acts.map((id) => lab(id, 'de')).join('; '), activitiesOrig: acts.map((id) => lab(id, lang)).join('; '),
        descriptionOrig: orig, descriptionDe: de, materialOrig: '', materialDe: '', clientName: '',
        sigEmployee: { version: 1 }, sigClient: null, clientId: 'seed-' + db.counter, lastEditId: '',
        createdAt: d + ' 16:40', updatedAt: d + ' 16:40', updatedBy: s.name
      };
    };
    db.reports.push(
      mk(2, 'D1', 'ar', 'B01', '07:00', '16:00', 30, ['T08', 'T15'], 'مثال: تركيب ألواح الجبس بورد في الطابق الأول.', 'Beispiel: Gipskartonplatten im 1. OG montiert.', 'freigegeben', 1),
      mk(1, 'D1', 'ar', 'B02', '06:30', '15:30', 45, ['T03', 'T14'], 'مثال: بناء جدار بلوك في الطابق الأرضي، 12 م².', 'Beispiel: Blockwand im EG gemauert, 12 m².', 'eingereicht', 1),
      mk(1, 'D2', 'ku', 'B03', '07:00', '17:00', 60, ['T11', 'T07'], 'Mînak: Dîwarên odeyên civînê hatin boyaxkirin.', 'Beispiel: Wände der Besprechungsräume gestrichen.', 'korrigiert', 2)
    );
    db.seeded = true;
  }
  function demoHandle(action, p) {
    const db = store.get('demo.db', { reports: [], counter: 0 });
    const save = () => store.set('demo.db', db);
    if (!db.seeded) { demoSeed(db); save(); }
    const err = (code, details) => new ApiError(code, '', details, false);
    if (action === 'login') {
      const s = DEMO_STAFF.find((x) => x.pin === String(p.pin));
      if (!s) throw err('wrong_pin');
      return { ok: true, token: 'demo.' + s.id, user: { id: s.id, name: s.name, isOffice: s.isOffice, lang: s.lang } };
    }
    const s = DEMO_STAFF.find((x) => S.auth && S.auth.token === 'demo.' + x.id);
    if (!s) throw err('auth');
    const user = { id: s.id, name: s.name, isOffice: s.isOffice, lang: s.lang };
    const actLabel = (id, l) => { const a = DEMO_ACTIVITIES.find((x) => x.id === id); return a ? ((l === 'ar' && a.ar) || (l === 'ku' && a.ku) || a.de) : ''; };
    const summary = (r) => ({ id: r.id, date: r.date, start: r.start, end: r.end, pauseMin: r.pauseMin, hours: r.hours, status: r.status, version: r.version, employeeId: r.employeeId, employeeName: r.employeeName, project: user.isOffice ? r.projectDe : r.projectOrig, lang: r.lang, photoCount: (r.photos || []).length, mailStatus: 'Demo – keine E-Mail' });
    switch (action) {
      case 'bootstrap':
        return { ok: true, user, firma: 'Demo GmbH', projects: DEMO_PROJECTS, activities: DEMO_ACTIVITIES, staff: user.isOffice ? DEMO_STAFF.map((x) => ({ id: x.id, name: x.name })) : undefined };
      case 'submit': {
        const r = p.report;
        const dupe = db.reports.find((x) => x.clientId === r.clientId || x.lastEditId === r.clientId);
        if (dupe) return { ok: true, id: dupe.id, version: dupe.version, status: dupe.status, mailSent: true, duplicate: true, warnings: [] };
        const prev = r.id ? db.reports.find((x) => x.id === r.id) : null;
        if (r.id && (!prev || (!user.isOffice && prev.employeeId !== user.id))) throw err('not_found');
        if (prev && !user.isOffice && prev.status === 'freigegeben') throw err('locked');
        if (prev && Number(r.baseVersion) !== prev.version) throw err('conflict');
        const lang = prev ? prev.lang : r.lang;
        const proj = DEMO_PROJECTS.find((x) => x.id === r.projectId);
        const net = toMin(r.end) - toMin(r.start) - r.pauseMin;
        const fake = (txt) => (lang === 'de' || !txt ? txt : '[Demo – nicht übersetzt] ' + txt);
        const rec = {
          id: prev ? prev.id : new Date().getFullYear() + '-' + String(++db.counter).padStart(4, '0'),
          version: prev ? prev.version + 1 : 1, status: prev ? (user.isOffice ? prev.status : 'korrigiert') : 'eingereicht',
          lang, employeeId: prev ? prev.employeeId : user.id, employeeName: prev ? prev.employeeName : user.name,
          date: r.date, start: r.start, end: r.end, pauseMin: r.pauseMin, hours: Math.round(net / 60 * 100) / 100,
          projectId: r.projectId || '', projectOrig: proj ? proj.name : r.projectText, projectDe: proj ? proj.name : (user.isOffice && r.projectDe ? r.projectDe : fake(r.projectText)),
          activityIds: r.activityIds, activitiesDe: r.activityIds.map((id) => actLabel(id, 'de')).join('; '), activitiesOrig: r.activityIds.map((id) => actLabel(id, lang)).join('; '),
          descriptionOrig: r.description, descriptionDe: user.isOffice && r.descriptionDe ? r.descriptionDe : fake(r.description),
          materialOrig: r.material, materialDe: user.isOffice && r.materialDe ? r.materialDe : fake(r.material),
          clientName: r.clientName,
          sigEmployee: r.sigEmployee === 'keep' && prev ? prev.sigEmployee : (r.sigEmployee ? { version: prev ? prev.version + 1 : 1 } : null),
          sigClient: r.sigClient === 'keep' && prev ? prev.sigClient : (r.sigClient ? { version: prev ? prev.version + 1 : 1 } : null),
          // Demo: Fotos werden nicht gespeichert, nur gezählt – behaltene bleiben, neue bekommen eine Schein-Kennung
          photos: (r.photos || []).map((p, i) => (String(p).slice(0, 5) === 'data:'
            ? { id: 'demo-foto-' + (++db.counter) + '-' + i, at: new Date().toISOString().slice(0, 16).replace('T', ' ') }
            : ((prev && (prev.photos || []).find((x) => x.id === p)) || null))).filter(Boolean),
          clientId: prev ? prev.clientId : r.clientId, lastEditId: prev ? r.clientId : '',
          createdAt: prev ? prev.createdAt : new Date().toISOString().slice(0, 16).replace('T', ' '),
          updatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '), updatedBy: user.name
        };
        if (prev) db.reports = db.reports.map((x) => (x.id === prev.id ? rec : x)); else db.reports.push(rec);
        save();
        return { ok: true, id: rec.id, version: rec.version, status: rec.status, mailSent: true, warnings: [] };
      }
      case 'list': {
        const all = user.isOffice && p.scope === 'all';
        const items = db.reports.filter((r) => (all || r.employeeId === user.id) &&
          (!all || ((!p.from || r.date >= p.from) && (!p.to || r.date <= p.to) && (!p.employeeId || r.employeeId === p.employeeId) && (!p.status || r.status === p.status))))
          .sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start)).map(summary);
        return { ok: true, items, total: items.length };
      }
      case 'get': {
        const r = db.reports.find((x) => x.id === p.id);
        if (!r || (!user.isOffice && r.employeeId !== user.id)) throw err('not_found');
        return { ok: true, report: Object.assign({}, r, { locked: r.status === 'freigegeben', mailStatus: 'Demo – keine E-Mail', docs: {} }) };
      }
      case 'approve': {
        if (!user.isOffice) throw err('forbidden');
        const r = db.reports.find((x) => x.id === p.id);
        if (!r) throw err('not_found');
        r.status = p.approve === false ? (r.version > 1 ? 'korrigiert' : 'eingereicht') : 'freigegeben';
        save();
        return { ok: true, id: r.id, status: r.status };
      }
      case 'resend': return { ok: true, mailSent: true };
      case 'health': {
        if (!user.isOffice) throw err('forbidden');
        const row = (level, label, detail) => ({ id: label, label, level, detail });
        return { ok: true, version: APP_VERSION, generated: nowStamp(), checks: [
          row('ok', 'Server', 'Demo-Modus: Es gibt keinen echten Server. Die Zeilen hier sind Beispiele, damit du siehst, wie der Systemcheck später aussieht.'),
          row('ok', 'Mitarbeiter und PINs', 'Beispiel: 10 aktive Benutzer (davon 1 Büro), alle PINs in Ordnung'),
          row('warn', 'Baustellen', 'Beispiel: Die Beispiel-Baustelle ist noch aktiv – bitte durch echte Baustellen ersetzen'),
          row('fail', 'Automatik', 'Beispiel: NICHT eingeschaltet – ohne sie gibt es keine tägliche Sicherung, keine Wochenliste und keinen E-Mail-Nachversand.'),
          row('ok', 'E-Mail', 'Beispiel: heute noch 96 E-Mails frei'),
          row('info', 'Geschwindigkeit des Versands', 'Beispiel: 12 Messungen · Dauer typisch 6,2 s, längste 14,8 s')
        ] };
      }
      case 'exportXlsx': {
        const n = db.reports.filter((r) => r.date >= p.from && r.date <= p.to).length;
        return { ok: true, count: n, sentTo: 'buero@demo.example' };
      }
      default: throw err('unknown_action');
    }
  }

  // ===================================================================
  //  Start
  // ===================================================================
  function registerSW() {
    if (!('serviceWorker' in navigator) || window.LN_NO_SW) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) { S.swUpdate = true; renderBar(); }
        });
      });
    }).catch(() => { /* ohne Offline-Speicher weiter */ });
  }

  function boot() {
    applyLang();
    window.addEventListener('hashchange', () => route());
    if (EMBED) {
      document.addEventListener('click', (e) => {
        const a = e.target && e.target.closest ? e.target.closest('a[href^="#/"]') : null;
        if (a && !e.defaultPrevented) { e.preventDefault(); navTo(a.getAttribute('href'), true); }
      });
    }
    document.addEventListener('securitypolicyviolation', (e) => {
      S.csp.push({ d: String(e.violatedDirective || '?').split(' ')[0], h: hostOf(e.blockedURI) });
      if (S.csp.length > 20) S.csp.shift();
    });
    window.addEventListener('online', () => { renderBar(); sync(); });
    window.addEventListener('offline', () => renderBar());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') sync();
      else if (S.formSave) S.formSave();
    });
    window.addEventListener('pagehide', () => { if (S.formSave) S.formSave(); });
    setInterval(() => { if (S.auth && outboxMine().some((i) => i.state !== 'error')) sync(); }, 60000);
    registerSW();
    route();
    if (S.auth) { refreshMeta().then(() => { if (currentRoute() === '') refreshHomeLists(); }); sync(); }
  }

  // Für automatische Tests: Version und Zustand lesbar machen (keine Geheimnisse)
  window.LN_APP = { version: APP_VERSION, demo: DEMO, outboxSize: () => outbox().length };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
