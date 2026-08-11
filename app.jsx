/* ============================================================
   STRAT DE STOCARE
   - datele comune (shared=true) → Supabase, ca să le vadă toată echipa
   - datele personale (limbă, cine ești) → pe telefonul fiecăruia
   ============================================================ */
const sb = window.supabase.createClient(CONFIG.URL, CONFIG.CHEIE);
const TABEL = "santier_date";

const stocare = {
  async get(cheie, comun) {
    if (!comun) {
      const v = localStorage.getItem(cheie);
      return v === null ? null : { key: cheie, value: v };
    }
    const { data, error } = await sb.from(TABEL).select("valoare").eq("cheie", cheie).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { key: cheie, value: data.valoare } : null;
  },

  async set(cheie, valoare, comun) {
    if (!comun) { localStorage.setItem(cheie, valoare); return { key: cheie, value: valoare }; }
    const { error } = await sb.from(TABEL)
      .upsert({ cheie, valoare, actualizat: new Date().toISOString() }, { onConflict: "cheie" });
    if (error) throw new Error(error.message);
    return { key: cheie, value: valoare };
  },

  async delete(cheie, comun) {
    if (!comun) { localStorage.removeItem(cheie); return { key: cheie, deleted: true }; }
    const { error } = await sb.from(TABEL).delete().eq("cheie", cheie);
    if (error) throw new Error(error.message);
    return { key: cheie, deleted: true };
  },

  async list(prefix, comun) {
    if (!comun) {
      const chei = Object.keys(localStorage).filter((k) => k.startsWith(prefix || ""));
      return { keys: chei };
    }
    const { data, error } = await sb.from(TABEL).select("cheie").like("cheie", `${prefix || ""}%`);
    if (error) throw new Error(error.message);
    return { keys: (data || []).map((r) => r.cheie) };
  },
};

const { useState, useEffect, useCallback, useRef } = React;

/* ============================================================
   ȘANTIER MANAGER v2
   - Rol Admin (PIN) și rol Muncitor
   - Angajați cu fișă individuală, grad, mutare între echipe
   - Camioane + istoric întreținere cu costuri și alerte expirare
   - Prețuri pe materiale și scule, valoare totală inventar
   - Cereri/probleme trimise de muncitori, vizibile doar adminului
   Date: stocare SHARED (toți utilizatorii văd aceleași date)
   Identitate: stocare personal (fiecare telefon își ține rolul)
   ============================================================ */

const DB_KEY = "santier-db-v2";
const LIMBA_KEY = "santier-limba";
const ID_KEY = "santier-identitate";
const PIN_IMPLICIT = "1234";

const gol = {
  materiale: [], scule: [], echipe: [], angajati: [],
  camioane: [], intretinere: [], cereri: [], jurnal: [],
  santiere: [], pontaj: [], consum: [], planificare: [], sarcini: [],
  dotare: [], verificari: [],
  setari: { pin: PIN_IMPLICIT },
};

const aziISO = () => new Date().toISOString().slice(0, 10);

/* luni a săptămânii, cu decalaj în săptămâni */
const luniaSaptamanii = (decalaj = 0) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  const zi = (d.getDay() + 6) % 7; // 0 = luni
  d.setDate(d.getDate() - zi + decalaj * 7);
  return d;
};
const adaugaZile = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const iso = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
/* ------------------------------------------------------------
   LIMBI — ro / fr / en
   Cheia e textul în română; dacă lipsește traducerea, cade pe română.
   ------------------------------------------------------------ */
const ZILE = ["Luni", "Marți", "Miercuri", "Joi", "Vineri", "Sâmbătă", "Duminică"];

const LIMBI = [
  { cod: "ro", nume: "Română", steag: "🇷🇴" },
  { cod: "fr", nume: "Français", steag: "🇫🇷" },
  { cod: "en", nume: "English", steag: "🇬🇧" },
];

const TRAD = {
  fr: {
    /* intrare */
    "Alege limba": "Choisis la langue",
    "Poți schimba oricând, din colțul de sus.": "Tu peux changer à tout moment, en haut à droite.",
    "🔑 Intru ca Admin": "🔑 Entrer comme Admin",
    "👷 Intru ca Muncitor": "👷 Entrer comme Ouvrier",
    "🧪 Vezi un exemplu (demo)": "🧪 Voir un exemple (démo)",
    "sau": "ou",
    "PIN admin": "Code admin",
    "Intră": "Entrer",
    "← Înapoi": "← Retour",
    "PIN greșit.": "Code incorrect.",
    "Cine ești?": "Qui es-tu ?",
    "— alege numele tău —": "— choisis ton nom —",
    "Parola ta": "Ton mot de passe",
    "Alege-ți o parolă (minim 4 cifre)": "Choisis un mot de passe (4 chiffres min.)",
    "E prima ta intrare — parola pe care o scrii acum rămâne a ta.":
      "C'est ta première connexion — le mot de passe que tu écris maintenant sera le tien.",
    "Parolă greșită. Dacă ai uitat-o, cere-i șefului să ți-o reseteze.":
      "Mot de passe incorrect. Si tu l'as oublié, demande au chef de le réinitialiser.",
    "Parola trebuie să aibă minim 4 caractere.": "Le mot de passe doit faire au moins 4 caractères.",
    "Adminul trebuie mai întâi să te adauge la Oameni → Angajați.":
      "L'admin doit d'abord t'ajouter dans Personnel → Employés.",
    /* demo */
    "Ce e modul demo": "C'est quoi le mode démo",
    "MOD DEMO": "MODE DÉMO",
    "Date de exemplu. Nimic nu se salvează și nu-ți atinge datele reale.":
      "Données d'exemple. Rien n'est enregistré, tes vraies données ne sont pas touchées.",
    "🔑 Intră ca Admin": "🔑 Entrer comme Admin",
    "Ieși": "Quitter",
    "DEMO · Ieși": "DÉMO · Quitter",
    "Admin · Ieși": "Admin · Quitter",
    /* muncitor */
    "Cont șters": "Compte supprimé",
    "Fără echipă": "Sans équipe",
    "Sculele echipei tale": "Les outils de ton équipe",
    "La voi": "Chez vous",
    "Cod": "Réf.",
    "din": "depuis",
    "Planingul tău": "Ton planning",
    "Azi": "Aujourd'hui",
    "Șantier șters": "Chantier supprimé",
    "Orele tale": "Tes heures",
    "Total:": "Total :",
    "Probleme și necesar": "Problèmes et besoins",
    "+ Raportează o problemă / cere ceva": "+ Signaler un problème / demander",
    "N-ai trimis nimic încă. Lipsește material, s-a stricat o sculă, ai nevoie de ceva pe șantier — scrie aici și vede doar șeful.":
      "Tu n'as encore rien envoyé. Il manque du matériel, un outil est cassé, tu as besoin de quelque chose — écris ici, seul le chef le voit.",
    "⚠ Problemă": "⚠ Problème",
    "📦 Necesar": "📦 Besoin",
    "Trimisă": "Envoyé",
    "Rezolvată": "Résolu",
    "Raportează": "Signaler",
    "📦 Am nevoie de…": "📦 J'ai besoin de…",
    "Ce s-a întâmplat?": "Qu'est-ce qui s'est passé ?",
    "Ce vă lipsește pe șantier?": "Qu'est-ce qui vous manque sur le chantier ?",
    "Mesajul ajunge doar la admin.": "Le message arrive uniquement à l'admin.",
    "Trimite": "Envoyer",
    /* sarcini */
    "De rezolvat": "À régler",
    "De făcut": "À faire",
    "Rezolvat": "Résolu",
    "Marchează rezolvat": "Marquer comme réglé",
    "Redeschide": "Rouvrir",
    "Rezolvat de": "Réglé par",
    "Poza nu mai e disponibilă": "La photo n'est plus disponible",
    "Se încarcă poza…": "Chargement de la photo…",
    /* navigare */
    "Panou": "Accueil",
    "Șantiere": "Chantiers",
    "Planing": "Planning",
    "Stoc": "Stock",
    "Cereri": "Demandes",
    "Setări": "Réglages",
    /* comune */
    "Salvează": "Enregistrer",
    "Modifică": "Modifier",
    "Șterge": "Supprimer",
    "Adaugă": "Ajouter",
    "Anulează": "Annuler",
    "Se încarcă…": "Chargement…",
    "Se salvează…": "Enregistrement…",
    "om": "personne",
    "oameni": "personnes",
    "zi": "jour",
    "zile": "jours",
    "ore": "heures",
    "Luni": "Lundi", "Marți": "Mardi", "Miercuri": "Mercredi", "Joi": "Jeudi",
    "Vineri": "Vendredi", "Sâmbătă": "Samedi", "Duminică": "Dimanche",
  },
  en: {
    "Alege limba": "Choose your language",
    "Poți schimba oricând, din colțul de sus.": "You can change it anytime, from the top corner.",
    "🔑 Intru ca Admin": "🔑 Sign in as Admin",
    "👷 Intru ca Muncitor": "👷 Sign in as Worker",
    "🧪 Vezi un exemplu (demo)": "🧪 See an example (demo)",
    "sau": "or",
    "PIN admin": "Admin PIN",
    "Intră": "Sign in",
    "← Înapoi": "← Back",
    "PIN greșit.": "Wrong PIN.",
    "Cine ești?": "Who are you?",
    "— alege numele tău —": "— pick your name —",
    "Parola ta": "Your password",
    "Alege-ți o parolă (minim 4 cifre)": "Choose a password (min. 4 digits)",
    "E prima ta intrare — parola pe care o scrii acum rămâne a ta.":
      "This is your first sign-in — the password you type now becomes yours.",
    "Parolă greșită. Dacă ai uitat-o, cere-i șefului să ți-o reseteze.":
      "Wrong password. If you forgot it, ask the boss to reset it.",
    "Parola trebuie să aibă minim 4 caractere.": "Password must be at least 4 characters.",
    "Adminul trebuie mai întâi să te adauge la Oameni → Angajați.":
      "The admin must first add you under People → Employees.",
    "Ce e modul demo": "What demo mode is",
    "MOD DEMO": "DEMO MODE",
    "Date de exemplu. Nimic nu se salvează și nu-ți atinge datele reale.":
      "Sample data. Nothing is saved and your real data isn't touched.",
    "🔑 Intră ca Admin": "🔑 Enter as Admin",
    "Ieși": "Exit",
    "DEMO · Ieși": "DEMO · Exit",
    "Admin · Ieși": "Admin · Exit",
    "Cont șters": "Deleted account",
    "Fără echipă": "No team",
    "Sculele echipei tale": "Your team's tools",
    "La voi": "With you",
    "Cod": "Ref.",
    "din": "since",
    "Planingul tău": "Your schedule",
    "Azi": "Today",
    "Șantier șters": "Deleted site",
    "Orele tale": "Your hours",
    "Total:": "Total:",
    "Probleme și necesar": "Issues and needs",
    "+ Raportează o problemă / cere ceva": "+ Report an issue / request something",
    "N-ai trimis nimic încă. Lipsește material, s-a stricat o sculă, ai nevoie de ceva pe șantier — scrie aici și vede doar șeful.":
      "You haven't sent anything yet. Missing material, a broken tool, something you need on site — write it here, only the boss sees it.",
    "⚠ Problemă": "⚠ Issue",
    "📦 Necesar": "📦 Need",
    "Trimisă": "Sent",
    "Rezolvată": "Resolved",
    "Raportează": "Report",
    "📦 Am nevoie de…": "📦 I need…",
    "Ce s-a întâmplat?": "What happened?",
    "Ce vă lipsește pe șantier?": "What's missing on site?",
    "Mesajul ajunge doar la admin.": "The message goes only to the admin.",
    "Trimite": "Send",
    "De rezolvat": "To fix",
    "De făcut": "To do",
    "Rezolvat": "Done",
    "Marchează rezolvat": "Mark as done",
    "Redeschide": "Reopen",
    "Rezolvat de": "Done by",
    "Poza nu mai e disponibilă": "Photo no longer available",
    "Se încarcă poza…": "Loading photo…",
    "Panou": "Home",
    "Șantiere": "Sites",
    "Planing": "Schedule",
    "Stoc": "Stock",
    "Cereri": "Requests",
    "Setări": "Settings",
    "Salvează": "Save",
    "Modifică": "Edit",
    "Șterge": "Delete",
    "Adaugă": "Add",
    "Anulează": "Cancel",
    "Se încarcă…": "Loading…",
    "Se salvează…": "Saving…",
    "om": "person",
    "oameni": "people",
    "zi": "day",
    "zile": "days",
    "ore": "hours",
    "Luni": "Monday", "Marți": "Tuesday", "Miercuri": "Wednesday", "Joi": "Thursday",
    "Vineri": "Friday", "Sâmbătă": "Saturday", "Duminică": "Sunday",
  },
};

/* traducătorul global: se setează o dată, la alegerea limbii */
let LIMBA = "ro";
const t = (text) => (LIMBA === "ro" ? text : (TRAD[LIMBA] && TRAD[LIMBA][text]) || text);
const zileTrad = () => ZILE.map((z) => t(z));

/* Pozele se micșorează și se comprimă până intră sub bugetul de mărime.
   Se țin în chei separate, nu în baza principală. */
const LIMITA_POZA = 400 * 1024; // ~400 KB de dataURL

const citesteFisier = (file) =>
  new Promise((rezolva, respinge) => {
    const r = new FileReader();
    r.onload = () => rezolva(r.result);
    r.onerror = () => respinge(new Error("Fișierul nu s-a putut citi de pe telefon."));
    r.readAsDataURL(file);
  });

const incarcaImagine = (src) =>
  new Promise((rezolva, respinge) => {
    const img = new Image();
    img.onload = () => rezolva(img);
    img.onerror = () => respinge(new Error("Formatul pozei nu e recunoscut. Încearcă un JPG sau PNG."));
    img.src = src;
  });

const comprimaPoza = async (file) => {
  const brut = await citesteFisier(file);
  const img = await incarcaImagine(brut);
  if (!img.width || !img.height) throw new Error("Poza pare goală.");
  /* încerc din ce în ce mai mic până intru în buget */
  const trepte = [
    [1000, 0.65], [900, 0.6], [800, 0.55], [700, 0.5], [560, 0.45], [440, 0.4],
  ];
  let ultima = null;
  for (const [max, calitate] of trepte) {
    const scara = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.width * scara));
    c.height = Math.max(1, Math.round(img.height * scara));
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    ultima = c.toDataURL("image/jpeg", calitate);
    if (ultima.length <= LIMITA_POZA) return ultima;
  }
  if (!ultima) throw new Error("Poza nu s-a putut procesa.");
  return ultima;
};

/* salvez poza și verific că a ajuns acolo; întorc id-ul sau arunc eroare cu motiv */
/* încearcă întâi cheie separată; dacă nu merge, spune de ce, ca să putem
   pune poza direct în fișa problemei */
const salveazaPoza = async (dataUrl, raport = () => {}) => {
  if (!stocare || typeof stocare.set !== "function") {
    raport("Stocarea nu există în acest mediu — pun poza în fișă.");
    return { fotoId: null, fotoData: dataUrl };
  }
  const id = uid();
  const cheie = `foto:${id}`;
  try {
    const rezultat = await stocare.set(cheie, dataUrl, true);
    if (!rezultat) throw new Error("scrierea a întors gol");
    const verificare = await stocare.get(cheie, true);
    if (!verificare?.value) throw new Error("nu s-a putut reciti");
    raport("Poză salvată separat, OK.");
    return { fotoId: id, fotoData: null };
  } catch (e) {
    raport("Stocarea separată n-a mers (" + (e.message || "necunoscut") + ") — pun poza în fișă.");
    return { fotoId: null, fotoData: dataUrl };
  }
};

function Poza({ fotoId, fotoData, inalt = 240 }) {
  const [src, setSrc] = useState(fotoData || null);
  const [eroare, setEroare] = useState(null);
  useEffect(() => {
    let activ = true;
    if (fotoData) { setSrc(fotoData); return; }
    if (!fotoId) return;
    setSrc(null); setEroare(null);
    (async () => {
      try {
        const r = await stocare.get(`foto:${fotoId}`, true);
        if (!activ) return;
        if (r?.value) setSrc(r.value);
        else setEroare("Poza nu mai e disponibilă");
      } catch (e) { if (activ) setEroare("Poza nu s-a putut încărca"); }
    })();
    return () => { activ = false; };
  }, [fotoId, fotoData]);
  if (!fotoId && !fotoData) return null;
  if (eroare) return <div className="poza-gol">{eroare}</div>;
  if (!src) return <div className="poza-gol">Se încarcă poza…</div>;
  return <img className="poza" src={src} alt="" style={{ maxHeight: inalt }} />;
}

/* "07:30" -> 450 minute */
const minute = (h) => {
  if (!h) return null;
  const [a, b] = h.split(":").map(Number);
  return a * 60 + (b || 0);
};
const catreOra = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const interval = (p) => `${p.oraStart || "—"}–${p.oraFinal || "—"}`;
/* două intervale se suprapun dacă unul începe înainte ca celălalt să se termine */
const seSuprapun = (a, b) => {
  const a1 = minute(a.oraStart), a2 = minute(a.oraFinal);
  const b1 = minute(b.oraStart), b2 = minute(b.oraFinal);
  if (a1 === null || a2 === null || b1 === null || b2 === null) return true; // fără ore = toată ziua
  return a1 < b2 && b1 < a2;
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const azi = () => new Date().toLocaleDateString("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric" });
const bani = (n) => (Number(n) || 0).toLocaleString("ro-RO", { maximumFractionDigits: 0 }) + " €";

const DOMENII = ["Zidărie", "Fundații / terasamente", "Structură / dulgherie", "Acoperiș", "Finisaje", "Instalații", "Izolații", "Amenajări exterioare", "Demolări", "Diverse"];

const GRADE = ["Muncitor", "Muncitor calificat", "Șef de echipă", "Operator utilaj", "Șofer", "Maistru", "Zidar", "Dulgher", "Fierar", "Finisor"];

/* zile rămase până la o dată yyyy-mm-dd; null dacă lipsește */
const zileRamase = (d) => {
  if (!d) return null;
  const diff = Math.ceil((new Date(d) - new Date().setHours(0, 0, 0, 0)) / 86400000);
  return diff;
};
const dataRo = (d) => (d ? new Date(d).toLocaleDateString("ro-RO") : "—");

/* ---------- stiluri ---------- */
const css = `
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&family=Chivo+Mono:wght@400;500;700&display=swap');
:root{
  --asfalt:#17191D; --beton:#22252B; --beton2:#2A2E36; --linie:#343943;
  --text:#ECEDEF; --mut:#8B919C;
  --galben:#F5B301; --galben-int:#3A3010;
  --verde:#4CAF7D; --rosu:#E5564D; --albastru:#5B9BD5; --mov:#B48CD9;
}
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
body{background:var(--asfalt)}
.app{font-family:'Archivo',sans-serif;background:var(--asfalt);color:var(--text);
  min-height:100vh;max-width:560px;margin:0 auto;padding-bottom:88px}
.mono{font-family:'Chivo Mono',monospace}
.antet{padding:16px 16px 10px;position:sticky;top:0;background:var(--asfalt);z-index:10}
.antet-rand{display:flex;justify-content:space-between;align-items:center}
.antet h1{font-size:18px;font-weight:800;letter-spacing:.5px;text-transform:uppercase}
.antet h1 span{color:var(--galben)}
.rol-chip.static{color:var(--galben);border-color:var(--linie);cursor:default;background:none}
.rol-chip{font-size:11px;font-weight:700;color:var(--mut);cursor:pointer;
  border:1px solid var(--linie);border-radius:6px;padding:4px 9px;background:none;font-family:'Archivo',sans-serif}
.hazard{height:5px;margin-top:9px;border-radius:3px;
  background:repeating-linear-gradient(45deg,var(--galben) 0 10px,#1a1a1a 10px 20px)}
.continut{padding:8px 16px}
.card{background:var(--beton);border:1px solid var(--linie);border-radius:12px;padding:14px;margin-bottom:10px}
.card.apasabil{cursor:pointer}
.card-rand{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.titlu{font-weight:700;font-size:15px}
.sub{color:var(--mut);font-size:12.5px;margin-top:3px;line-height:1.55}
.chip{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;
  padding:3px 9px;border-radius:5px;white-space:nowrap}
.chip.ok{background:#1E3328;color:var(--verde)}
.chip.alerta{background:#3A1F1E;color:var(--rosu)}
.chip.alocat{background:var(--galben-int);color:var(--galben)}
.chip.depozit{background:#22303E;color:var(--albastru)}
.chip.service{background:#332B3A;color:var(--mov)}
.chip.gri{background:var(--beton2);color:var(--mut)}
.grila-stat{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px}
.stat{background:var(--beton);border:1px solid var(--linie);border-radius:12px;padding:13px}
.stat .nr{font-size:23px;font-weight:800;font-family:'Chivo Mono',monospace}
.stat .lbl{color:var(--mut);font-size:11.5px;margin-top:2px}
.stat.atentie{border-color:var(--rosu)}
.stat.atentie .nr{color:var(--rosu)}
.stat.bani .nr{color:var(--verde);font-size:19px}
.stat.bani.atentie .nr{color:var(--rosu)}
.sectiune{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--mut);margin:18px 0 8px}
.btn{font-family:'Archivo',sans-serif;font-weight:700;font-size:14px;border:none;border-radius:9px;
  padding:11px 16px;cursor:pointer}
.btn-galben{background:var(--galben);color:#17191D;width:100%}
.btn-mic{font-size:12.5px;padding:7px 12px;background:var(--beton2);color:var(--text);border:1px solid var(--linie)}
.btn-mic.principal{background:var(--galben);color:#17191D;border-color:var(--galben)}
.btn-mic.pericol{color:var(--rosu)}
.actiuni{display:flex;gap:8px;margin-top:11px;flex-wrap:wrap}
.cautare{width:100%;background:var(--beton);border:1px solid var(--linie);color:var(--text);
  border-radius:10px;padding:11px 14px;font-size:14px;font-family:'Archivo',sans-serif;margin-bottom:12px}
.cautare:focus{outline:2px solid var(--galben);outline-offset:-1px}
.btn-mare{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;
  background:var(--beton2);border:1px solid var(--linie);color:var(--text);font-size:15.5px;
  font-weight:600;padding:16px 15px;margin-bottom:9px;text-align:left;border-radius:11px;cursor:pointer;
  font-family:'Archivo',sans-serif}
.bm-stoc{color:var(--mut);font-size:12.5px;font-family:'Chivo Mono',monospace;white-space:nowrap}
.stepper{display:flex;align-items:center;justify-content:center;gap:18px;margin-bottom:16px}
.stepper button{width:64px;height:64px;border-radius:50%;background:var(--beton2);border:1px solid var(--linie);
  color:var(--galben);font-size:32px;font-weight:700;cursor:pointer;line-height:1}
.stepper>div{text-align:center;min-width:96px}
.st-nr{font-size:38px;font-weight:800;line-height:1}
.st-um{color:var(--mut);font-size:13px;margin-top:3px}
.pas-gata{text-align:center;padding:14px 0 22px}
.bifa-mare{width:64px;height:64px;border-radius:50%;background:#1E3328;color:var(--verde);
  font-size:34px;display:flex;align-items:center;justify-content:center;margin:0 auto 12px}
.rezumat{display:flex;justify-content:space-between;align-items:center;gap:10px;
  background:var(--beton);border:1px solid var(--linie);border-radius:12px;padding:13px 14px;margin-bottom:10px}
.rz-nr{font-size:22px;font-weight:800;color:var(--verde)}
.rz-lbl{color:var(--mut);font-size:11.5px;margin-top:2px;line-height:1.4}
.subtab{display:flex;gap:8px;margin-bottom:12px}
.subtab button{flex:1;background:var(--beton);border:1px solid var(--linie);color:var(--mut);
  font-family:'Archivo',sans-serif;font-weight:700;font-size:13px;padding:9px;border-radius:9px;cursor:pointer}
.subtab button.activ{background:var(--galben-int);border-color:var(--galben);color:var(--galben)}
.voal{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:40}
.foaie{position:fixed;left:0;right:0;bottom:0;max-width:560px;margin:0 auto;background:var(--beton);
  border-radius:16px 16px 0 0;border-top:2px solid var(--galben);padding:18px 16px 26px;z-index:50;
  max-height:88vh;overflow-y:auto}
.foaie h2{font-size:16px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;margin-bottom:14px}
.camp{margin-bottom:11px}
.camp label{display:block;font-size:12px;font-weight:600;color:var(--mut);margin-bottom:5px}
.camp input,.camp select,.camp textarea{width:100%;background:var(--asfalt);border:1px solid var(--linie);
  color:var(--text);border-radius:9px;padding:10px 12px;font-size:14.5px;font-family:'Archivo',sans-serif}
.camp input:focus,.camp select:focus,.camp textarea:focus{outline:2px solid var(--galben);outline-offset:-1px}
.rand2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.nav{position:fixed;bottom:0;left:0;right:0;max-width:560px;margin:0 auto;background:var(--beton);
  border-top:1px solid var(--linie);display:flex;z-index:30}
.nav button{flex:1;background:none;border:none;color:var(--mut);font-family:'Archivo',sans-serif;
  font-size:10px;font-weight:600;padding:9px 2px 12px;cursor:pointer;display:flex;flex-direction:column;
  align-items:center;gap:3px;position:relative}
.nav button.activ{color:var(--galben)}
.nav .ico{font-size:18px;line-height:1}
.bulina{position:absolute;top:5px;right:calc(50% - 16px);background:var(--rosu);color:#fff;
  font-size:9px;font-weight:800;min-width:15px;height:15px;border-radius:8px;display:flex;
  align-items:center;justify-content:center;padding:0 3px}
.gol-msg{text-align:center;color:var(--mut);padding:30px 16px;font-size:14px;line-height:1.6}
.jurnal-rand{border-left:2px solid var(--galben);padding:6px 0 6px 12px;margin-bottom:8px}
.jurnal-rand .cand{font-size:11px;color:var(--mut)}
.jurnal-rand .ce{font-size:13.5px;margin-top:2px;line-height:1.45}
.lista-in-card{margin-top:8px;padding-top:8px;border-top:1px dashed var(--linie);font-size:13px;line-height:1.75}
.intrare{padding:16px;display:flex;flex-direction:column;justify-content:center;min-height:100vh;gap:12px}
.intrare h1{font-size:24px;font-weight:800;text-transform:uppercase;text-align:center}
.intrare h1 span{color:var(--galben)}
.fisa-rand{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px dashed var(--linie);font-size:14px}
.fisa-rand .k{color:var(--mut)}
.bara-marja{margin-top:11px;padding:10px 12px;background:var(--asfalt);border-radius:9px}
.bm-rand{display:flex;justify-content:space-between;font-size:13px;color:var(--mut);padding:2px 0}
.bm-rand b{color:var(--text)}
.bm-rand.mare{font-size:14.5px;padding-top:7px;margin-top:5px;border-top:1px solid var(--linie);color:var(--text);font-weight:600}
.plan-real{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:10px}
.pr-col{background:var(--asfalt);border-radius:9px;padding:9px 8px;text-align:center}
.pr-lbl{font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;color:var(--mut);font-weight:700}
.pr-val{font-size:16px;font-weight:700;margin:3px 0 2px}
.pr-prev{font-size:10.5px;color:var(--mut);line-height:1.35}
.rand-dotare{display:grid;grid-template-columns:1fr 62px 46px;gap:6px;align-items:center}
.rand-dotare input{padding:10px 10px;font-size:14px}
.rand-prev{display:grid;grid-template-columns:1fr 62px 52px 62px 34px;gap:5px;margin-bottom:6px;align-items:center}
.rand-prev input{padding:8px 7px;font-size:13px}
.rand-prev button{padding:8px 0}
.rand-bifa{display:flex;align-items:center;gap:11px;padding:9px 2px;border-bottom:1px dashed var(--linie);
  font-size:14.5px;font-weight:500;cursor:pointer}
.rand-bifa input{width:20px;height:20px;accent-color:var(--galben);flex:none}
.rb-sub{display:block;font-size:11.5px;color:var(--mut);font-weight:400;margin-top:1px}
.nav-sapt{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;text-align:center}
.ns-titlu{font-size:15px;font-weight:700}
.ns-sub{font-size:11.5px;color:var(--mut)}
.zi-plan{background:var(--beton);border:1px solid var(--linie);border-radius:11px;padding:10px 12px;margin-bottom:8px}
.zi-antet{display:flex;justify-content:space-between;align-items:center;font-size:14px}
.zi-antet button{padding:4px 12px;font-size:15px;line-height:1}
.zi-gol{color:var(--linie);font-size:13px;padding:5px 0 2px}
.btn-sterge-plan{background:none;border:none;color:var(--mut);font-size:17px;line-height:1;
  padding:4px 8px;cursor:pointer;flex:none}
.plan-item{background:var(--asfalt);border-radius:8px;padding:9px 10px;margin-top:8px;cursor:pointer;
  border-left:3px solid var(--galben)}
.nav button{font-size:9.5px}
.btn-limba{display:flex;align-items:center;justify-content:center;gap:12px;width:100%;
  background:var(--beton);border:1px solid var(--linie);color:var(--text);font-size:16px;padding:15px}
.btn-limba span{font-size:22px}
.chip-limba{position:absolute;top:0;right:0;background:none;border:1px solid var(--linie);
  border-radius:6px;color:var(--mut);font-size:12px;padding:5px 9px;cursor:pointer;font-family:'Archivo',sans-serif}
.banda-demo{display:flex;align-items:center;justify-content:space-between;gap:10px;
  background:var(--galben-int);border:1px solid var(--galben);border-radius:10px;padding:10px 12px;margin-bottom:12px}
.banda-demo b{display:block;color:var(--galben);font-size:12px;letter-spacing:1px}
.banda-demo span{font-size:11.5px;color:var(--mut);line-height:1.4;display:block;margin-top:2px}
.banda-demo button{flex:none}
.separator{display:flex;align-items:center;gap:10px;color:var(--mut);font-size:12px;margin:2px 0}
.separator::before,.separator::after{content:"";flex:1;height:1px;background:var(--linie)}
.poza{width:100%;border-radius:9px;margin-top:10px;display:block;object-fit:cover}
.pasi-poza{background:var(--asfalt);border:1px solid var(--linie);border-radius:9px;padding:10px 12px;
  margin-bottom:12px;font-size:11.5px;color:var(--mut);line-height:1.6;font-family:'Chivo Mono',monospace}
.poza-gol{background:var(--asfalt);border:1px dashed var(--linie);border-radius:9px;margin-top:10px;
  padding:26px;text-align:center;color:var(--mut);font-size:12.5px}
.buton-poza{position:relative;overflow:hidden;display:block;background:var(--asfalt);border:1px dashed var(--linie);border-radius:9px;
  padding:15px;text-align:center;font-size:14px;font-weight:600;color:var(--galben);cursor:pointer}
.meniu-set{display:flex;flex-direction:column;gap:8px;margin-bottom:14px}
.meniu-set button{display:flex;align-items:center;gap:11px;background:var(--beton);border:1px solid var(--linie);
  color:var(--text);font-family:'Archivo',sans-serif;font-weight:700;font-size:14.5px;padding:14px;
  border-radius:11px;cursor:pointer;text-align:left}
.meniu-set button span{font-size:19px}
.meniu-set button.activ{background:var(--galben-int);border-color:var(--galben);color:var(--galben)}
.alerta-card{cursor:pointer;border-left:3px solid var(--galben)}
.alerta-card.expirat{border-left-color:var(--rosu)}
.bara{height:5px;background:var(--asfalt);border-radius:3px;margin-top:9px;overflow:hidden}
.bara-fill{height:100%;border-radius:3px}
.nav button{font-size:8.5px;padding:8px 1px 11px}
.nav .ico{font-size:16px}
.info-plan{background:#22303E;border:1px solid var(--albastru);border-radius:10px;padding:12px;margin-bottom:12px}
.info-plan b{color:var(--albastru);font-size:13.5px;display:block;margin-bottom:6px}
.conflict{background:#2E1B1A;border:1px solid var(--rosu);border-radius:10px;padding:12px;margin-bottom:12px}
.conflict b{color:var(--rosu);font-size:13.5px;display:block;margin-bottom:6px}
.cf-rand{font-size:13px;line-height:1.55;color:var(--text);margin-bottom:3px}
.cf-sfat{font-size:12px;color:var(--mut);margin-top:7px}
.pi-cap{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:2px}
.pi-cap .chip{font-size:10.5px;padding:2px 7px}
.btn:disabled{opacity:.4;cursor:not-allowed}
@media (prefers-reduced-motion:no-preference){
  .foaie{animation:urca .22s ease}
  @keyframes urca{from{transform:translateY(30px);opacity:0}to{transform:translateY(0);opacity:1}}
}
`;

function Foaie({ titlu, onClose, children }) {
  return (
    <>
      <div className="voal" onClick={onClose} />
      <div className="foaie" role="dialog" aria-label={titlu}>
        <h2>{titlu}</h2>
        {children}
      </div>
    </>
  );
}

/* ============================================================ */
function App() {
  const [db, setDb] = useState(gol);
  const [identitate, setIdentitate] = useState(null); // {rol:'admin'} sau {rol:'muncitor', angajatId}
  const [limba, setLimbaStare] = useState(null); // null = încă nu a ales
  const setLimba = async (cod) => {
    LIMBA = cod;
    setLimbaStare(cod);
    try { await stocare.set(LIMBA_KEY, cod); } catch (e) {}
  };
  const [incarcat, setIncarcat] = useState(false);
  const [tab, setTab] = useState("panou");
  const [subInv, setSubInv] = useState("materiale");
  const [subOam, setSubOam] = useState("angajati");
  const [subSet, setSubSet] = useState("oameni");
  const [tabM, setTabM] = useState("azi");
  const [intrebare, setIntrebare] = useState(null); // {mesaj, onDa, eticheta}
  const cere = (mesaj, onDa, eticheta, onNu) => setIntrebare({ mesaj, onDa, eticheta, onNu });
  const [cauta, setCauta] = useState("");
  const [saptamana, setSaptamana] = useState(0);
  const [foaie, setFoaie] = useState(null);

  /* încărcare: baza de date e comună (shared), identitatea e pe telefonul fiecăruia */
  useEffect(() => {
    (async () => {
      try {
        const r = await stocare.get(DB_KEY, true);
        if (r?.value) {
          const d = JSON.parse(r.value);
          setDb({ ...gol, ...d, setari: { ...gol.setari, ...(d.setari || {}) } });
        }
      } catch (e) {}
      try {
        const r = await stocare.get(ID_KEY);
        if (r?.value) setIdentitate(JSON.parse(r.value));
      } catch (e) {}
      try {
        const r = await stocare.get(LIMBA_KEY);
        if (r?.value) { LIMBA = r.value; setLimbaStare(r.value); }
      } catch (e) {}
      setIncarcat(true);
    })();
  }, []);

  const [eroareSalvare, setEroareSalvare] = useState("");
  const salveaza = useCallback(async (nou) => {
    setDb(nou);
    try {
      const r = await stocare.set(DB_KEY, JSON.stringify(nou), true);
      if (!r) throw new Error("Stocarea a refuzat scrierea.");
      setEroareSalvare("");
      return true;
    } catch (e) {
      console.error("Salvarea a eșuat", e);
      setEroareSalvare("Ultima modificare nu s-a salvat. Verifică conexiunea și încearcă din nou.");
      return false;
    }
  }, []);

  const setIdent = async (id) => {
    setIdentitate(id);
    try {
      if (id) await stocare.set(ID_KEY, JSON.stringify(id));
      else await stocare.delete(ID_KEY);
    } catch (e) {}
  };

  const log = (text) => ({ id: uid(), cand: azi(), text });
  const cuJurnal = (d, text) => ({ ...d, jurnal: [log(text), ...d.jurnal].slice(0, 300) });

  /* ---------- CRUD generic ---------- */
  const salvGen = (cheie) => (item, textJurnal) => {
    const lista = item.id
      ? db[cheie].map((x) => (x.id === item.id ? item : x))
      : [...db[cheie], { ...item, id: uid() }];
    let nou = { ...db, [cheie]: lista };
    if (textJurnal) nou = cuJurnal(nou, textJurnal);
    salveaza(nou);
    setFoaie(null);
  };
  const salvMaterial = salvGen("materiale");
  const salvCamion = salvGen("camioane");

  const stergeGen = (cheie, mesaj) => (id) => cere(mesaj, () => {
    salveaza({ ...db, [cheie]: db[cheie].filter((x) => x.id !== id) });
    setFoaie(null);
  }, "Șterge");

  /* scule */
  const salvScula = (s) => {
    const lista = s.id
      ? db.scule.map((x) => (x.id === s.id ? { ...x, ...s } : x))
      : [...db.scule, { ...s, id: uid(), stare: "depozit", echipaId: null, dataAlocare: null }];
    salveaza({ ...db, scule: lista });
    setFoaie(null);
  };
  const alocaScula = (sculaId, echipaId) => {
    const scula = db.scule.find((x) => x.id === sculaId);
    const echipa = db.echipe.find((x) => x.id === echipaId);
    if (!scula || !echipa) return;
    const lista = db.scule.map((x) => x.id === sculaId ? { ...x, stare: "alocat", echipaId, dataAlocare: azi() } : x);
    salveaza(cuJurnal({ ...db, scule: lista }, `${scula.nume} → alocată echipei ${echipa.nume}`));
    setFoaie(null);
  };
  const returneazaScula = (sculaId) => {
    const scula = db.scule.find((x) => x.id === sculaId);
    const echipa = db.echipe.find((x) => x.id === scula?.echipaId);
    const lista = db.scule.map((x) => x.id === sculaId ? { ...x, stare: "depozit", echipaId: null, dataAlocare: null } : x);
    salveaza(cuJurnal({ ...db, scule: lista }, `${scula.nume} ← returnată în depozit${echipa ? ` de ${echipa.nume}` : ""}`));
  };
  const trimiteService = (sculaId) => {
    const scula = db.scule.find((x) => x.id === sculaId);
    const lista = db.scule.map((x) => x.id === sculaId ? { ...x, stare: "service", echipaId: null, dataAlocare: null } : x);
    salveaza(cuJurnal({ ...db, scule: lista }, `${scula.nume} → trimisă la service`));
  };

  /* angajați */
  const salvAngajat = (a) => {
    const vechi = a.id ? db.angajati.find((x) => x.id === a.id) : null;
    const lista = a.id ? db.angajati.map((x) => (x.id === a.id ? a : x)) : [...db.angajati, { ...a, id: uid() }];
    let nou = { ...db, angajati: lista };
    if (vechi && vechi.echipaId !== a.echipaId) {
      const spre = db.echipe.find((e) => e.id === a.echipaId);
      nou = cuJurnal(nou, `${a.nume} mutat la ${spre ? "echipa " + spre.nume : "fără echipă"}`);
    }
    salveaza(nou);
    setFoaie(null);
  };
  const stergeAngajat = (id) => cere("Ștergi acest angajat din evidență?", () => {
    salveaza({ ...db, angajati: db.angajati.filter((x) => x.id !== id) });
    setFoaie(null);
  }, "Șterge");

  /* echipe */
  const salvEchipa = salvGen("echipe");
  const stergeEchipa = (id) => {
    cere("Ștergi echipa? Sculele revin în depozit, angajații rămân fără echipă.", () => salveaza({
      ...db,
      echipe: db.echipe.filter((x) => x.id !== id),
      scule: db.scule.map((x) => x.echipaId === id ? { ...x, stare: "depozit", echipaId: null, dataAlocare: null } : x),
      angajati: db.angajati.map((a) => (a.echipaId === id ? { ...a, echipaId: null } : a)),
    }), "Șterge");
  };

  /* camioane + întreținere */
  const adaugaIntretinere = (camionId, intr) => {
    const camion = db.camioane.find((c) => c.id === camionId);
    let nou = { ...db, intretinere: [{ ...intr, id: uid(), camionId }, ...db.intretinere] };
    if (intr.km) nou.camioane = nou.camioane.map((c) => (c.id === camionId ? { ...c, km: intr.km } : c));
    salveaza(cuJurnal(nou, `${camion.nume}: ${intr.tip}${intr.cost ? " · " + bani(intr.cost) : ""}`));
    setFoaie(null);
  };

  /* șantiere + pontaj */
  const salvSantier = salvGen("santiere");
  const stergeSantier = (id) => {
    cere("Ștergi șantierul și tot pontajul lui? Istoricul orelor se pierde.", () => {
      salveaza({ ...db, santiere: db.santiere.filter((x) => x.id !== id), pontaj: db.pontaj.filter((p) => p.santierId !== id) });
      setFoaie(null);
    }, "Șterge");
  };
  const adaugaPontaj = (santierId, data, randuri) => {
    const santier = db.santiere.find((s) => s.id === santierId);
    const intrari = randuri.map((r) => ({
      id: uid(), santierId, angajatId: r.angajatId, nume: r.nume,
      ore: Number(r.ore) || 0, tarifOra: Number(r.tarifOra) || 0,
      tipMunca: r.tipMunca || null, data,
    }));
    const totalOre = intrari.reduce((s, i) => s + i.ore, 0);
    salveaza(cuJurnal({ ...db, pontaj: [...intrari, ...db.pontaj] },
      `Pontaj ${santier.nume}: ${intrari.length} ${intrari.length === 1 ? "om" : "oameni"} · ${totalOre}h`));
    setFoaie(null);
  };
  const stergePontaj = (id) => {
    cere("Ștergi această intrare de pontaj?", () =>
      salveaza({ ...db, pontaj: db.pontaj.filter((p) => p.id !== id) }), "Șterge");
  };

  /* consum materiale pe șantier — scade din stoc dacă vine din inventar */
  const adaugaConsum = (santierId, c) => {
    const santier = santierId ? db.santiere.find((s) => s.id === santierId) : null;
    const mat = c.materialId ? db.materiale.find((m) => m.id === c.materialId) : null;
    const intrare = {
      id: uid(), santierId: santierId || null, materialId: c.materialId || null,
      nume: mat ? mat.nume : c.nume,
      cant: Number(c.cant) || 0,
      unitate: mat ? mat.unitate : c.unitate,
      pret: Number(c.pret) || 0,
      motiv: c.motiv || "",
      inregistratDe: c.inregistratDe || null,
      data: c.data || aziISO(),
    };
    let nou = { ...db, consum: [intrare, ...db.consum] };
    if (mat && c.scadeDinStoc !== false)
      nou.materiale = nou.materiale.map((m) =>
        m.id === mat.id ? { ...m, cant: Math.max(0, Number(m.cant) - intrare.cant) } : m);
    salveaza(cuJurnal(nou,
      santier
        ? `${santier.nume}: consum ${intrare.cant} ${intrare.unitate} ${intrare.nume}${intrare.inregistratDe ? ` — notat de ${intrare.inregistratDe}` : ""}`
        : `Ieșire fără șantier: ${intrare.cant} ${intrare.unitate} ${intrare.nume}${intrare.motiv ? ` (${intrare.motiv})` : ""}`));
    setFoaie(null);
  };
  /* ieșire rapidă din stoc, fără șantier — intră la pierderi */
  const iesireRapida = (mat, cant) => {
    const intrare = {
      id: uid(), santierId: null, materialId: mat.id, nume: mat.nume,
      cant: Number(cant) || 0, unitate: mat.unitate, pret: Number(mat.pret) || 0,
      motiv: "ajustare rapidă", data: aziISO(),
    };
    salveaza(cuJurnal({
      ...db,
      consum: [intrare, ...db.consum],
      materiale: db.materiale.map((m) => m.id === mat.id ? { ...m, cant: Math.max(0, Number(m.cant) - intrare.cant) } : m),
    }, `Ieșire fără șantier: ${intrare.cant} ${intrare.unitate} ${intrare.nume}`));
  };

  const stergeConsum = (id) => {
    cere("Ștergi această intrare de consum? Stocul NU se pune la loc automat.", () =>
      salveaza({ ...db, consum: db.consum.filter((c) => c.id !== id) }), "Șterge");
  };

  /* planificare */
  const salvPlan = (p) => {
    const lista = p.id
      ? db.planificare.map((x) => (x.id === p.id ? p : x))
      : [...db.planificare, { ...p, id: uid() }];
    salveaza({ ...db, planificare: lista });
    setFoaie(null);
  };
  /* înlocuiește programul care se calcă: scoate oamenii comuni din intrarea veche,
     iar dacă rămâne goală o șterge de tot */
  const inlocuiestePlan = (c) => {
    const alta = c.alta;
    const santier = db.santiere.find((s) => s.id === alta.santierId);
    if (c.totiOamenii) {
      salveaza(cuJurnal({ ...db, planificare: db.planificare.filter((p) => p.id !== alta.id) },
        `Planing ${dataRo(alta.data)}: scos ${santier?.nume || "un șantier"} (${interval(alta)}) — înlocuit`));
      return;
    }
    /* scot doar oamenii comuni: îi trec din echipă în listă nominală */
    const membriEchipa = alta.echipaId
      ? db.angajati.filter((a) => a.echipaId === alta.echipaId).map((a) => a.id)
      : [];
    const raman = [...new Set([...(alta.angajatIds || []), ...membriEchipa])]
      .filter((id) => !c.comuni.includes(id));
    const noua = { ...alta, echipaId: "", angajatIds: raman };
    const nume = c.comuni.map((id) => db.angajati.find((a) => a.id === id)?.nume).filter(Boolean).join(", ");
    salveaza(cuJurnal({ ...db, planificare: db.planificare.map((p) => (p.id === alta.id ? noua : p)) },
      `Planing ${dataRo(alta.data)}: ${nume} scos de pe ${santier?.nume || "un șantier"} — înlocuit`));
  };

  /* împarte programul vechi în două bucăți, ca oamenii să revină acolo
     înainte și după intervalul nou */
  const imparteplan = (c, start, final) => {
    const alta = c.alta;
    const santier = db.santiere.find((s) => s.id === alta.santierId);
    const bucati = [];
    const inainte = { start: alta.oraStart, final: start };
    const dupa = { start: final, final: alta.oraFinal };

    /* oamenii care se mută: doar ei se împart; ceilalți rămân cu programul întreg */
    const membriEchipa = alta.echipaId
      ? db.angajati.filter((a) => a.echipaId === alta.echipaId).map((a) => a.id) : [];
    const toti = [...new Set([...(alta.angajatIds || []), ...membriEchipa])];
    const raman = toti.filter((id) => !c.comuni.includes(id));

    const faBucata = (b, oameni) => {
      if (minute(b.final) - minute(b.start) < 15) return; // prea scurt, nu are sens
      bucati.push({ ...alta, id: uid(), echipaId: "", angajatIds: oameni,
        oraStart: b.start, oraFinal: b.final });
    };

    let planificare;
    if (c.totiOamenii) {
      faBucata(inainte, toti);
      faBucata(dupa, toti);
      planificare = [...db.planificare.filter((p) => p.id !== alta.id), ...bucati];
    } else {
      faBucata(inainte, c.comuni);
      faBucata(dupa, c.comuni);
      const pastrat = { ...alta, echipaId: "", angajatIds: raman };
      planificare = [...db.planificare.map((p) => (p.id === alta.id ? pastrat : p)), ...bucati];
    }
    const nume = c.comuni.map((id) => db.angajati.find((a) => a.id === id)?.nume).filter(Boolean).join(", ");
    salveaza(cuJurnal({ ...db, planificare },
      `Planing ${dataRo(alta.data)}: ${nume} plecat ${start}–${final} de pe ${santier?.nume || "un șantier"}, revine după`));
  };

  const stergePlan = (id) => {
    cere("Ștergi această zi din planing?", () => {
      salveaza({ ...db, planificare: db.planificare.filter((x) => x.id !== id) });
      setFoaie(null);
    }, "Șterge");
  };
  const copiazaSaptamana = (deLaLuni) => {
    const zileSursa = [...Array(7)].map((_, i) => iso(adaugaZile(deLaLuni, i)));
    const sursa = db.planificare.filter((p) => zileSursa.includes(p.data));
    if (sursa.length === 0) return cere("Săptămâna asta e goală, n-am ce copia.", () => {}, "Am înțeles");
    cere(`Copiez ${sursa.length} intrări în săptămâna următoare?`, () => {
    const copii = sursa.map((p) => ({ ...p, id: uid(), data: iso(adaugaZile(new Date(p.data), 7)) }));
    salveaza({ ...db, planificare: [...db.planificare, ...copii] });
    }, "Copiază");
  };

  /* gestionare rapidă membri echipă */
  const seteazaMembri = (echipaId, ids) => {
    const angajati = db.angajati.map((a) => {
      const trebuie = ids.includes(a.id);
      if (trebuie) return { ...a, echipaId };
      if (a.echipaId === echipaId) return { ...a, echipaId: null };
      return a;
    });
    const echipa = db.echipe.find((e) => e.id === echipaId);
    salveaza(cuJurnal({ ...db, angajati }, `Echipa ${echipa.nume}: ${ids.length} membri actualizați`));
    setFoaie(null);
  };

  /* parolă muncitor */
  const setPinAngajat = (id, pin, inchideFoaia = true) => {
    salveaza({ ...db, angajati: db.angajati.map((a) => (a.id === id ? { ...a, pin } : a)) });
    if (inchideFoaia) setFoaie(null);
  };

  /* sarcini cu poze pe șantier */
  const salvSarcina = async (s, dataUrlPoza, raport) => {
    let fotoId = s.fotoId || null;
    let fotoData = s.fotoData || null;
    if (dataUrlPoza) {
      const r = await salveazaPoza(dataUrlPoza, raport);
      fotoId = r.fotoId; fotoData = r.fotoData;
    }
    const item = { ...s, fotoId, fotoData };
    const lista = s.id
      ? db.sarcini.map((x) => (x.id === s.id ? item : x))
      : [...db.sarcini, { ...item, id: uid(), status: "deschis", cand: azi() }];
    const santier = db.santiere.find((x) => x.id === s.santierId);
    const ok = await salveaza(s.id ? { ...db, sarcini: lista }
      : cuJurnal({ ...db, sarcini: lista }, `${santier?.nume || "Șantier"}: ${item.titlu}`));
    if (!ok) throw new Error("Problema nu s-a putut salva.");
    setFoaie(null);
  };
  const comutaSarcina = (id, cine) => {
    salveaza({
      ...db,
      sarcini: db.sarcini.map((x) =>
        x.id === id
          ? x.status === "deschis"
            ? { ...x, status: "rezolvat", rezolvatDe: cine, dataRezolvare: azi() }
            : { ...x, status: "deschis", rezolvatDe: null, dataRezolvare: null }
          : x),
    });
  };
  const stergeSarcina = async (id) => {
    const s = db.sarcini.find((x) => x.id === id);
    cere("Ștergi această problemă și poza ei?", async () => {
      if (s?.fotoId) { try { await stocare.delete(`foto:${s.fotoId}`, true); } catch (e) {} }
      salveaza({ ...db, sarcini: db.sarcini.filter((x) => x.id !== id) });
      setFoaie(null);
    }, "Șterge");
  };

  /* șeful de echipă raportează starea unei scule */
  const raporteazaScula = (sculaId, tip, note, cine) => {
    const scula = db.scule.find((x) => x.id === sculaId);
    if (!scula) return;
    const problema = { tip, note: note || "", cand: azi(), de: cine || "Muncitor" };
    const stareNoua = tip === "La service" ? "service" : "problema";
    const scule = db.scule.map((x) =>
      x.id === sculaId
        ? { ...x, stare: stareNoua, problema, ...(tip === "La service" ? { echipaId: null, dataAlocare: null } : {}) }
        : x);
    const cerere = {
      id: uid(), tip: "problema",
      text: `${scula.nume}: ${tip}${note ? ` — ${note}` : ""}`,
      autorId: identitate.angajatId || null, autorNume: cine || "Muncitor",
      cand: azi(), status: "nou",
    };
    salveaza(cuJurnal({ ...db, scule, cereri: [cerere, ...db.cereri] },
      `${scula.nume}: ${tip} — raportat de ${cine}`));
    setFoaie(null);
  };

  /* adminul rezolvă problema unei scule */
  const rezolvaScula = (sculaId, actiune) => {
    const scula = db.scule.find((x) => x.id === sculaId);
    if (!scula) return;
    if (actiune === "sterge") {
      cere(`Scoți definitiv „${scula.nume}" din inventar?`, () =>
        salveaza(cuJurnal({ ...db, scule: db.scule.filter((x) => x.id !== sculaId) },
          `${scula.nume}: scoasă din inventar`)), "Scoate");
      return;
    }
    const scule = db.scule.map((x) =>
      x.id === sculaId
        ? { ...x, stare: actiune, problema: null,
            ...(actiune !== "alocat" ? { echipaId: null, dataAlocare: null } : {}) }
        : x);
    salveaza(cuJurnal({ ...db, scule },
      `${scula.nume}: ${actiune === "service" ? "trimisă la service" : actiune === "depozit" ? "revenită în depozit" : "rămâne la echipă"}`));
  };

  /* cereri */
  const trimiteCerere = (c) => {
    salveaza({ ...db, cereri: [{ ...c, id: uid(), cand: azi(), status: "nou" }, ...db.cereri] });
    setFoaie(null);
  };
  const marcheazaCerere = (id, status) =>
    salveaza({ ...db, cereri: db.cereri.map((c) => (c.id === id ? { ...c, status } : c)) });
  const stergeCerere = stergeGen("cereri", "Ștergi această cerere?");

  /* ---------- derivate ---------- */
  const q = cauta.trim().toLowerCase();
  const filtrat = (lista, campuri) =>
    !q ? lista : lista.filter((x) => campuri.some((c) => (x[c] || "").toLowerCase().includes(q)));
  const numeEchipa = (id) => db.echipe.find((e) => e.id === id)?.nume || "Fără echipă";
  const stocScazut = db.materiale.filter((m) => Number(m.cant) <= Number(m.minim || 0));
  const cereriNoi = db.cereri.filter((c) => c.status === "nou");
  const valMateriale = db.materiale.reduce((s, m) => s + (Number(m.cant) || 0) * (Number(m.pret) || 0), 0);
  const valScule = db.scule.reduce((s, x) => s + (Number(x.pret) || 0), 0);
  const pontajSantier = (sid) => db.pontaj.filter((p) => p.santierId === sid);
  const oreSantier = (sid) => pontajSantier(sid).reduce((s, p) => s + (Number(p.ore) || 0), 0);
  const costSantier = (sid) => pontajSantier(sid).reduce((s, p) => s + (Number(p.ore) || 0) * (Number(p.tarifOra) || 0), 0);
  const consumSantier = (sid) => db.consum.filter((c) => c.santierId === sid);
  const costMaterialeSantier = (sid) =>
    consumSantier(sid).reduce((s, c) => s + (Number(c.cant) || 0) * (Number(c.pret) || 0), 0);
  const prevMateriale = (s) =>
    (s.materialePrev || []).reduce((t, m) => t + (Number(m.cant) || 0) * (Number(m.pret) || 0), 0);
  const bilant = (s) => {
    const manopera = costSantier(s.id);
    const materiale = costMaterialeSantier(s.id);
    const cost = manopera + materiale;
    const incasat = Number(s.valoare) || 0;
    return { manopera, materiale, cost, incasat, marja: incasat - cost,
      procent: incasat > 0 ? Math.round(((incasat - cost) / incasat) * 100) : null };
  };
  const consumNealocat = db.consum.filter((c) => !c.santierId);
  const pierderiTotal = consumNealocat.reduce((s, c) => s + (Number(c.cant) || 0) * (Number(c.pret) || 0), 0);
  const santiereActive = db.santiere.filter((s) => s.status !== "finalizat");
  const costManoperaTotal = db.santiere.reduce((s, x) => s + costSantier(x.id), 0);
  const cifratTotal = db.santiere.reduce((s, x) => s + (Number(x.valoare) || 0), 0);
  const materialeAlocateTotal = db.santiere.reduce((s, x) => s + costMaterialeSantier(x.id), 0);
  const marjaBruta = cifratTotal - costManoperaTotal - materialeAlocateTotal;
  const marjaTotala = marjaBruta - pierderiTotal;
  const alerteCamioane = db.camioane
    .flatMap((c) =>
      [["ITP", c.itp], ["Asigurare", c.asigurare], ["Revizie", c.revizie]]
        .map(([tip, d]) => ({ tip, d, z: zileRamase(d), camion: c }))
        .filter((a) => a.z !== null && a.z <= (a.tip === "Revizie" ? 14 : 30))
    )
    .sort((a, b) => a.z - b.z);

  if (!incarcat)
    return (<div className="app"><style>{css}</style><div className="gol-msg">Se încarcă…</div></div>);

  /* ==================== ALEGEREA LIMBII ==================== */
  if (!limba)
    return (
      <div className="app"><style>{css}</style>
        <div className="intrare">
          <h1>Șantier <span>Manager</span></h1>
          <div className="hazard" />
          <div style={{ height: 6 }} />
          {LIMBI.map((l) => (
            <button key={l.cod} className="btn btn-limba" onClick={() => setLimba(l.cod)}>
              <span>{l.steag}</span>{l.nume}
            </button>
          ))}
          <div className="sub" style={{ textAlign: "center", marginTop: 10, lineHeight: 1.6 }}>
            Choose your language · Choisis ta langue
            <br />
            <span style={{ fontSize: 11 }}>O poți schimba oricând din Setări.</span>
          </div>
        </div>
      </div>
    );

  /* ==================== ECRAN DE INTRARE ==================== */
  if (!identitate)
    return (
      <div className="app"><style>{css}</style>
        <EcranIntrare db={db} onIntra={setIdent}
          onSeteazaPin={(id, pin) => {
            const nou = { ...db, angajati: db.angajati.map((a) => (a.id === id ? { ...a, pin } : a)) };
            salveaza(nou);
          }} />
      </div>
    );

  const esteAdmin = identitate.rol === "admin";
  const eu = db.angajati.find((a) => a.id === identitate.angajatId);

  /* ==================== VEDEREA MUNCITORULUI ==================== */
  if (!esteAdmin) {
    const echipaMea = db.echipe.find((e) => e.id === eu?.echipaId);
    const sculeEchipa = db.scule.filter((s) => s.echipaId === eu?.echipaId);
    const cererileMele = db.cereri.filter((c) => c.autorId === identitate.angajatId);
    const aziI = iso(new Date());
    const maineI = iso(adaugaZile(new Date(), 1));
    const azi7 = [...Array(7)].map((_, i) => iso(adaugaZile(new Date(), i)));

    const alLui = (p) =>
      p.angajatIds?.includes(identitate.angajatId) || (p.echipaId && p.echipaId === eu?.echipaId);
    const dupaOra = (a, b) => a.data.localeCompare(b.data) || (minute(a.oraStart) || 0) - (minute(b.oraStart) || 0);

    /* muncitorul vede doar azi și mâine */
    const planLui = db.planificare
      .filter((p) => alLui(p) && (p.data === aziI || p.data === maineI))
      .sort(dupaOra);
    const planAzi = planLui.filter((p) => p.data === aziI);
    const planMaine = planLui.filter((p) => p.data === maineI);

    /* pentru sarcini și consum folosesc tot ce are pe 7 zile, nu doar ce vede */
    const idsLui = new Set(
      db.planificare.filter((p) => alLui(p) && azi7.includes(p.data)).map((p) => p.santierId));
    db.pontaj.forEach((p) => { if (p.angajatId === identitate.angajatId) idsLui.add(p.santierId); });
    const santiereLui = db.santiere.filter((x) => x.status !== "finalizat" && idsLui.has(x.id));
    const pentruConsum = santiereLui.length > 0 ? santiereLui : db.santiere.filter((x) => x.status !== "finalizat");

    /* sarcinile de pe șantierele lui */
    const sarciniLui = db.sarcini
      .filter((x) => idsLui.has(x.santierId))
      .sort((a, b) => (a.status === "deschis" ? 0 : 1) - (b.status === "deschis" ? 0 : 1));
    const sarciniDeschise = sarciniLui.filter((x) => x.status === "deschis");

    const cereriDeschise = cererileMele.filter((c) => c.status === "nou");

    const cardPlan = (p, mic) => {
      const s = db.santiere.find((x) => x.id === p.santierId);
      const d = new Date(p.data);
      const eAzi = p.data === aziI;
      return (
        <div className="card" key={p.id} style={eAzi ? { borderColor: "var(--galben)" } : null}>
          <div className="card-rand">
            <div>
              <div className="titlu">🏗 {s ? s.nume : t("Șantier șters")}</div>
              <div className="sub">
                {!mic && <>{zileTrad()[(d.getDay() + 6) % 7]} · </>}
                <b className="mono">{interval(p)}</b>
                {s?.adresa && <> · {s.adresa}</>}
                {p.note && <><br />{p.note}</>}
              </div>
            </div>
            {eAzi && <span className="chip alocat">{t("Azi")}</span>}
          </div>
        </div>
      );
    };

    const cardSarcina = (x) => {
      const s = db.santiere.find((y) => y.id === x.santierId);
      const gata = x.status === "rezolvat";
      return (
        <div className="card" key={x.id} style={gata ? { opacity: .6 } : null}>
          <div className="card-rand">
            <div>
              <div className="titlu">{x.titlu}</div>
              <div className="sub">{s?.nume}{x.descriere && <><br />{x.descriere}</>}</div>
            </div>
            <span className={"chip " + (gata ? "ok" : "alerta")}>{t(gata ? "Rezolvat" : "De făcut")}</span>
          </div>
          {(x.fotoId || x.fotoData) && <Poza fotoId={x.fotoId} fotoData={x.fotoData} />}
          <div className="actiuni">
            <button className={"btn btn-mic" + (gata ? "" : " principal")}
              onClick={() => comutaSarcina(x.id, eu?.nume || "Muncitor")}>
              {t(gata ? "Redeschide" : "Marchează rezolvat")}
            </button>
          </div>
          {gata && x.rezolvatDe && (
            <div className="sub" style={{ marginTop: 7 }}>{t("Rezolvat de")} {x.rezolvatDe} · {x.dataRezolvare}</div>
          )}
        </div>
      );
    };

    return (
      <div className="app"><style>{css}</style>
        <div className="antet">
          <div className="antet-rand">
            <h1>Șantier <span>Manager</span></h1>
            <span className="rol-chip static">{eu?.nume?.split(" ")[0] || "👷"}</span>
          </div>
          <div className="hazard" />
        </div>

        <div className="continut">

          {/* ---------- AZI ---------- */}
          {tabM === "azi" && (
            <>
              <div className="card">
                <div className="titlu">👷 {eu ? eu.nume : t("Cont șters")}</div>
                <div className="sub">
                  {eu?.grad || "—"} · {echipaMea ? echipaMea.nume : t("Fără echipă")}
                </div>
              </div>

              <div className="sectiune">{t("Azi")}</div>
              {planAzi.length === 0 ? (
                <div className="gol-msg">Azi n-ai nimic în planing. Întreabă șeful dacă nu ești sigur.</div>
              ) : planAzi.map((p) => cardPlan(p, true))}

              {sarciniDeschise.length > 0 && (
                <>
                  <div className="sectiune">📷 {t("De rezolvat")} ({sarciniDeschise.length})</div>
                  {sarciniDeschise.map(cardSarcina)}
                </>
              )}

              <div className="sectiune">Mâine</div>
              {planMaine.length === 0 ? (
                <div className="gol-msg">Mâine nu e nimic pus încă. Verifică diseară — șeful mai schimbă.</div>
              ) : planMaine.map((p) => cardPlan(p, false))}

              {sarciniLui.filter((x) => x.status === "rezolvat").length > 0 && (
                <>
                  <div className="sectiune">{t("Rezolvat")}</div>
                  {sarciniLui.filter((x) => x.status === "rezolvat").slice(0, 3).map(cardSarcina)}
                </>
              )}
            </>
          )}

          {/* ---------- SCULE ---------- */}
          {tabM === "scule" && (
            <>
              <div className="card">
                <div className="titlu">🔧 {t("Sculele echipei tale")}</div>
                <div className="sub">
                  {echipaMea ? echipaMea.nume : t("Fără echipă")} · {sculeEchipa.length}{" "}
                  {sculeEchipa.length === 1 ? "sculă" : "scule"}. Dacă una s-a stricat sau lipsește,
                  scrie la Cereri.
                </div>
              </div>
              {sculeEchipa.length === 0 ? (
                <div className="gol-msg">Echipa ta n-are nicio sculă alocată acum.</div>
              ) : sculeEchipa.map((s) => (
                <div className="card" key={s.id}>
                  <div className="card-rand">
                    <div>
                      <div className="titlu">
                        {s.nume} {s.bucati > 1 && <span className="mono" style={{ color: "var(--galben)" }}>×{s.bucati}</span>}
                      </div>
                      <div className="sub">
                        {s.cod && <>{t("Cod")} <span className="mono">{s.cod}</span> · </>}
                        {t("din")} {s.dataAlocare}
                        {s.problema && (
                          <><br /><span style={{ color: "var(--rosu)" }}>
                            {s.problema.tip}{s.problema.note && ` — ${s.problema.note}`} · {s.problema.cand}
                          </span></>
                        )}
                      </div>
                    </div>
                    <span className={"chip " + (s.problema ? "alerta" : "alocat")}>
                      {s.problema ? s.problema.tip : t("La voi")}
                    </span>
                  </div>
                  {eu?.poateStoc && !s.problema && (
                    <div className="actiuni">
                      <button className="btn btn-mic" onClick={() => setFoaie({ tip: "raportScula", item: s })}>
                        Raportează o problemă
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </>
          )}

          {/* ---------- MATERIALE ---------- */}
          {tabM === "materiale" && eu?.poateStoc && (() => {
            const aleMele = db.consum.filter((c) => c.inregistratDe === eu?.nume);
            return (
              <>
                <div className="card">
                  <div className="titlu">📦 Materiale folosite</div>
                  <div className="sub">
                    Notează ce ați consumat pe șantier. Se scade singur din depozit, ca șeful să știe
                    ce mai e pe stoc și cât a costat lucrarea.
                  </div>
                </div>
                <button className="btn btn-galben"
                  onClick={() => setFoaie({ tip: "consumMuncitor", santiere: pentruConsum })}>
                  + Am folosit materiale
                </button>

                <div className="sectiune">Notate de tine</div>
                {aleMele.length === 0 ? (
                  <div className="gol-msg">Încă nimic. Apasă butonul galben după ce ați folosit ceva.</div>
                ) : aleMele.map((c) => {
                  const s = db.santiere.find((x) => x.id === c.santierId);
                  return (
                    <div className="card" key={c.id}>
                      <div className="card-rand">
                        <div>
                          <div className="titlu">{c.nume}</div>
                          <div className="sub">{s?.nume || "—"} · {dataRo(c.data)}</div>
                        </div>
                        <span className="chip gri mono">{c.cant} {c.unitate}</span>
                      </div>
                    </div>
                  );
                })}
              </>
            );
          })()}

          {/* ---------- ORE ---------- */}
          {/* ---------- CERERI ---------- */}
          {tabM === "cereri" && (
            <>
              <div className="card">
                <div className="titlu">✉ {t("Probleme și necesar")}</div>
                <div className="sub">{t("Mesajul ajunge doar la admin.")}</div>
              </div>
              <button className="btn btn-galben" onClick={() => setFoaie({ tip: "cerere" })}>
                {t("+ Raportează o problemă / cere ceva")}
              </button>
              <div className="card" style={{ marginTop: 12 }}>
                <div className="titlu" style={{ fontSize: 14 }}>🌐 {t("Alege limba")}</div>
                <div className="actiuni">
                  {LIMBI.map((l) => (
                    <button key={l.cod}
                      className={"btn btn-mic" + (limba === l.cod ? " principal" : "")}
                      onClick={() => setLimba(l.cod)}>
                      {l.steag} {l.nume}
                    </button>
                  ))}
                </div>
              </div>
              <button className="btn btn-mic" style={{ width: "100%", marginTop: 9 }}
                onClick={() => setIdent(null)}>
                {t("Ieși")} din cont
              </button>
              <div style={{ height: 12 }} />
              {cererileMele.length === 0 ? (
                <div className="gol-msg">
                  {t("N-ai trimis nimic încă. Lipsește material, s-a stricat o sculă, ai nevoie de ceva pe șantier — scrie aici și vede doar șeful.")}
                </div>
              ) : cererileMele.map((c) => (
                <div className="card" key={c.id}>
                  <div className="card-rand">
                    <div>
                      <div className="titlu">{t(c.tip === "problema" ? "⚠ Problemă" : "📦 Necesar")}</div>
                      <div className="sub">{c.text}<br /><span className="mono">{c.cand}</span></div>
                    </div>
                    <span className={"chip " + (c.status === "nou" ? "alocat" : "ok")}>
                      {t(c.status === "nou" ? "Trimisă" : "Rezolvată")}
                    </span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        {foaie?.tip === "consumMuncitor" && (
          <ConsumSimplu
            santiere={foaie.santiere}
            materiale={db.materiale}
            numeleMeu={eu?.nume}
            onSalveaza={(santierId, c) => adaugaConsum(santierId, c)}
            onClose={() => setFoaie(null)} />
        )}
        {foaie?.tip === "raportScula" && (
          <RaportScula scula={foaie.item} numeleMeu={eu?.nume}
            onSalveaza={(tip, note) => raporteazaScula(foaie.item.id, tip, note, eu?.nume)}
            onClose={() => setFoaie(null)} />
        )}
        {foaie?.tip === "cerere" && (
          <FormCerere eu={eu} onTrimite={trimiteCerere} onClose={() => setFoaie(null)} />
        )}

        <Confirmare intrebare={intrebare} onInchide={() => setIntrebare(null)} />

        <nav className="nav">
          {[
            ["azi", "🗓", t("Azi"), sarciniDeschise.length],
            ["scule", "🔧", "Scule", 0],
            ...(eu?.poateStoc ? [["materiale", "📦", "Materiale", 0]] : []),
            ["cereri", "✉", t("Cereri"), cereriDeschise.length],
          ].map(([id, ico, lbl, badge]) => (
            <button key={id} className={tabM === id ? "activ" : ""} onClick={() => setTabM(id)}>
              {badge > 0 && <span className="bulina">{badge}</span>}
              <span className="ico">{ico}</span>{lbl}
            </button>
          ))}
        </nav>
      </div>
    );
  }

  /* ==================== VEDEREA ADMINULUI ==================== */
  return (
    <div className="app"><style>{css}</style>
      <div className="antet">
        <div className="antet-rand">
          <h1>Șantier <span>Manager</span></h1>
          <span className="rol-chip static">Admin</span>
        </div>
        <div className="hazard" />
      </div>

      <div className="continut">
        {eroareSalvare && <div className="conflict" style={{ marginBottom: 12 }}><b>⚠ {eroareSalvare}</b></div>}

        {/* ---------- PANOU ---------- */}
        {tab === "panou" && (
          <>
            <div className="grila-stat">
              <div className="stat bani"><div className="nr">{bani(cifratTotal)}</div><div className="lbl">Cifrat pe lucrări</div></div>
              <div className={"stat bani" + (marjaTotala < 0 ? " atentie" : "")}>
                <div className="nr">{marjaTotala < 0 ? "−" : ""}{bani(Math.abs(marjaTotala))}</div>
                <div className="lbl">{marjaTotala < 0 ? "⚠ Pierdere (cu materialele pierdute)" : "Marjă netă (cu pierderi)"}</div>
              </div>
              <div className={"stat" + (stocScazut.length ? " atentie" : "")}>
                <div className="nr">{stocScazut.length}</div><div className="lbl">Stoc scăzut</div>
              </div>
              <div className={"stat" + (cereriNoi.length ? " atentie" : "")}>
                <div className="nr">{cereriNoi.length}</div><div className="lbl">Cereri noi de pe teren</div>
              </div>
              <div className="stat"><div className="nr">{santiereActive.length}</div><div className="lbl">Șantiere active</div></div>
              <div className="stat bani"><div className="nr">{bani(costManoperaTotal)}</div><div className="lbl">Manoperă pontată (total)</div></div>
            </div>

            {alerteCamioane.length > 0 && (
              <>
                <div className="sectiune">🚛 De rezolvat la mașini</div>
                {alerteCamioane.map((a, i) => (
                  <div className={"card alerta-card" + (a.z < 0 ? " expirat" : "")} key={i}
                    onClick={() => { setTab("setari"); setSubSet("auto"); }}>
                    <div className="card-rand">
                      <div>
                        <div className="titlu">{a.z < 0 ? "🔴" : "🟠"} {a.camion.nume}</div>
                        <div className="sub">
                          {a.tip === "Revizie" ? "Revizie programată" : a.tip} · {dataRo(a.d)}
                          {a.camion.numar && <> · <span className="mono">{a.camion.numar}</span></>}
                        </div>
                      </div>
                      <span className="chip alerta">
                        {a.z < 0 ? `Depășit ${-a.z} z` : a.z === 0 ? "Azi" : `${a.z} zile`}
                      </span>
                    </div>
                  </div>
                ))}
              </>
            )}

            {db.scule.filter((x) => x.stare === "problema").length > 0 && (
              <>
                <div className="sectiune">🔧 Scule raportate cu probleme</div>
                {db.scule.filter((x) => x.stare === "problema").map((s) => (
                  <div className="card alerta-card expirat" key={s.id}
                    onClick={() => { setTab("inventar"); setSubInv("scule"); }}>
                    <div className="card-rand">
                      <div>
                        <div className="titlu">{s.nume}</div>
                        <div className="sub">
                          {s.problema?.note || s.problema?.tip} · {numeEchipa(s.echipaId)}
                          <br /><span className="mono">{s.problema?.de}, {s.problema?.cand}</span>
                        </div>
                      </div>
                      <span className="chip alerta">{s.problema?.tip}</span>
                    </div>
                  </div>
                ))}
              </>
            )}

            {cereriNoi.length > 0 && (
              <>
                <div className="sectiune">✉ Cereri noi de pe teren</div>
                {cereriNoi.slice(0, 5).map((c) => (
                  <div className="card alerta-card" key={c.id} onClick={() => setTab("cereri")}>
                    <div className="card-rand">
                      <div>
                        <div className="titlu">{t(c.tip === "problema" ? "⚠ Problemă" : "📦 Necesar")} · {c.autorNume}</div>
                        <div className="sub">{c.text}</div>
                      </div>
                      <span className="chip alocat mono">{c.cand}</span>
                    </div>
                  </div>
                ))}
              </>
            )}

            {stocScazut.length > 0 && (
              <>
                <div className="sectiune">⚠ Necesită aprovizionare</div>
                {stocScazut.map((m) => (
                  <div className="card" key={m.id}>
                    <div className="card-rand">
                      <div>
                        <div className="titlu">{m.nume}</div>
                        <div className="sub">Stoc: <b className="mono">{m.cant} {m.unitate}</b> · minim {m.minim}</div>
                      </div>
                      <span className="chip alerta">Stoc scăzut</span>
                    </div>
                  </div>
                ))}
              </>
            )}

            <div className="sectiune">Ultimele mișcări</div>
            {db.jurnal.length === 0 ? (
              <div className="gol-msg">Nicio mișcare încă.</div>
            ) : db.jurnal.slice(0, 12).map((j) => (
              <div className="jurnal-rand" key={j.id}>
                <div className="cand mono">{j.cand}</div><div className="ce">{j.text}</div>
              </div>
            ))}

          </>
        )}

        {/* ---------- INVENTAR ---------- */}
        {tab === "inventar" && (
          <>
            <div className="subtab">
              <button className={subInv === "materiale" ? "activ" : ""} onClick={() => setSubInv("materiale")}>Materiale</button>
              <button className={subInv === "scule" ? "activ" : ""} onClick={() => setSubInv("scule")}>Scule</button>
            </div>
            <input className="cautare" placeholder="Caută…" value={cauta} onChange={(e) => setCauta(e.target.value)} />

            {subInv === "materiale" && (
              <>
                <div className="rezumat">
                  <div>
                    <div className="rz-nr mono">{bani(valMateriale)}</div>
                    <div className="rz-lbl">Valoare stoc · {db.materiale.length} poziții</div>
                  </div>
                  {stocScazut.length > 0 && (
                    <span className="chip alerta">{stocScazut.length} sub prag</span>
                  )}
                </div>
                <button className="btn btn-galben" onClick={() => setFoaie({ tip: "material" })}>+ Adaugă material</button>
                <div style={{ height: 12 }} />
                {filtrat(db.materiale, ["nume", "categorie", "locatie"]).map((m) => {
                  const scazut = Number(m.cant) <= Number(m.minim || 0);
                  return (
                    <div className="card" key={m.id}>
                      <div className="card-rand">
                        <div>
                          <div className="titlu">{m.nume}</div>
                          <div className="sub">
                            <b className="mono">{m.cant} {m.unitate}</b>
                            {m.pret > 0 && <> · {bani(m.pret)}/{m.unitate} · total <b>{bani(m.cant * m.pret)}</b></>}
                            {m.locatie && <> · {m.locatie}</>}
                          </div>
                        </div>
                        <span className={"chip " + (scazut ? "alerta" : "ok")}>{scazut ? "Stoc scăzut" : "În stoc"}</span>
                      </div>
                      <div className="actiuni">
                        <button className="btn btn-mic" onClick={() => Number(m.cant) > 0 && iesireRapida(m, 1)}>−1</button>
                        <button className="btn btn-mic" onClick={() => salvMaterial({ ...m, cant: Number(m.cant) + 1 })}>+1</button>
                        <button className="btn btn-mic" onClick={() => setFoaie({ tip: "iesire", item: m })}>Scoate</button>
                        <button className="btn btn-mic" onClick={() => setFoaie({ tip: "material", item: m })}>Modifică</button>
                        <button className="btn btn-mic pericol" onClick={() => stergeGen("materiale", "Ștergi acest material?")(m.id)}>Șterge</button>
                      </div>
                    </div>
                  );
                })}
                {db.materiale.length === 0 && <div className="gol-msg">Inventar gol. Adaugă materialele cu preț ca să vezi valoarea stocului.</div>}
              </>
            )}

            {subInv === "scule" && (
              <>
                <div className="rezumat">
                  <div>
                    <div className="rz-nr mono">{bani(valScule)}</div>
                    <div className="rz-lbl">
                      Valoare parc scule · {db.scule.filter((x) => x.stare === "alocat").length} pe teren,{" "}
                      {db.scule.filter((x) => x.stare === "depozit").length} în depozit
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {db.scule.filter((x) => x.stare === "problema").length > 0 && (
                      <span className="chip alerta">{db.scule.filter((x) => x.stare === "problema").length} cu probleme</span>
                    )}
                    {db.scule.filter((x) => x.stare === "service").length > 0 && (
                      <span className="chip service">{db.scule.filter((x) => x.stare === "service").length} service</span>
                    )}
                  </div>
                </div>
                <button className="btn btn-galben" onClick={() => setFoaie({ tip: "scula" })}>+ Adaugă sculă</button>
                <div style={{ height: 12 }} />
                {filtrat(db.scule, ["nume", "cod"]).map((s) => (
                  <div className="card" key={s.id}>
                    <div className="card-rand">
                      <div>
                        <div className="titlu">
                          {s.nume} {s.bucati > 1 && <span className="mono" style={{ color: "var(--galben)" }}>×{s.bucati}</span>}
                        </div>
                        <div className="sub">
                          {s.cod && <>Cod <span className="mono">{s.cod}</span> · </>}
                          {s.pret > 0 && <>{bani(s.pret)} · </>}
                          {s.stare === "problema" ? <>La <b>{numeEchipa(s.echipaId)}</b></>
                            : s.stare === "alocat" ? <>La <b>{numeEchipa(s.echipaId)}</b> din {s.dataAlocare}</>
                            : s.stare === "service" ? "În service" : "În depozit"}
                          {s.problema && (
                            <><br /><span style={{ color: "var(--rosu)" }}>
                              ⚠ {s.problema.tip}{s.problema.note && ` — ${s.problema.note}`}
                              <span style={{ color: "var(--mut)" }}> · {s.problema.de}, {s.problema.cand}</span>
                            </span></>
                          )}
                        </div>
                      </div>
                      <span className={"chip " + (s.stare === "problema" ? "alerta" : s.stare)}>
                        {s.stare === "problema" ? s.problema?.tip || "Problemă"
                          : s.stare === "alocat" ? "Alocată" : s.stare === "service" ? "Service" : "Depozit"}
                      </span>
                    </div>
                    <div className="actiuni">
                      {s.stare === "problema" && (
                        <>
                          <button className="btn btn-mic principal" onClick={() => rezolvaScula(s.id, "alocat")}>
                            S-a rezolvat, rămâne la echipă
                          </button>
                          <button className="btn btn-mic" onClick={() => rezolvaScula(s.id, "service")}>La service</button>
                          <button className="btn btn-mic" onClick={() => rezolvaScula(s.id, "depozit")}>Revenită în depozit</button>
                          <button className="btn btn-mic pericol" onClick={() => rezolvaScula(s.id, "sterge")}>
                            Scoate din inventar
                          </button>
                        </>
                      )}
                      {s.stare === "depozit" && db.echipe.length > 0 && (
                        <button className="btn btn-mic principal" onClick={() => setFoaie({ tip: "aloca", item: s })}>Alocă</button>
                      )}
                      {s.stare === "alocat" && (
                        <button className="btn btn-mic principal" onClick={() => returneazaScula(s.id)}>Returnează</button>
                      )}
                      {s.stare !== "service" && s.stare !== "problema"
                        ? <button className="btn btn-mic" onClick={() => trimiteService(s.id)}>Service</button>
                        : <button className="btn btn-mic" onClick={() => returneazaScula(s.id)}>Înapoi în depozit</button>}
                      <button className="btn btn-mic" onClick={() => setFoaie({ tip: "scula", item: s })}>Modifică</button>
                      <button className="btn btn-mic pericol" onClick={() => stergeGen("scule", "Ștergi această sculă?")(s.id)}>Șterge</button>
                    </div>
                  </div>
                ))}
                {db.scule.length === 0 && <div className="gol-msg">Nicio sculă. Adaugă-le cu preț ca să știi valoarea parcului de scule.</div>}
              </>
            )}
          </>
        )}

        {/* ---------- OAMENI ---------- */}
        {tab === "setari" && (
          <div className="meniu-set">
            {[["cifre", "📊", "Cifre și rentabilitate"], ["oameni", "👷", "Oameni și echipe"], ["dotare", "🧰", "Dotare echipe"], ["auto", "🚛", "Camioane și utilaje"], ["cont", "🔑", "Cont și acces"], ["invitatii", "📨", "Invită muncitorii"], ["backup", "💾", "Backup și restaurare"]].map(([id, ico, lbl]) => (
              <button key={id} className={subSet === id ? "activ" : ""} onClick={() => { setSubSet(id); setCauta(""); }}>
                <span>{ico}</span>{lbl}
              </button>
            ))}
          </div>
        )}

        {tab === "setari" && subSet === "oameni" && (
          <>
            <div className="subtab">
              <button className={subOam === "angajati" ? "activ" : ""} onClick={() => setSubOam("angajati")}>Angajați</button>
              <button className={subOam === "echipe" ? "activ" : ""} onClick={() => setSubOam("echipe")}>Echipe</button>
            </div>

            {subOam === "angajati" && (
              <>
                <input className="cautare" placeholder="Caută angajat…" value={cauta} onChange={(e) => setCauta(e.target.value)} />
                <button className="btn btn-galben" onClick={() => setFoaie({ tip: "angajat" })}>+ Adaugă angajat</button>
                <div style={{ height: 12 }} />
                {filtrat(db.angajati, ["nume", "grad"]).map((a) => (
                  <div className="card apasabil" key={a.id} onClick={() => setFoaie({ tip: "fisa", item: a })}>
                    <div className="card-rand">
                      <div>
                        <div className="titlu">{a.nume}</div>
                        <div className="sub">{a.grad || "—"} · {numeEchipa(a.echipaId)}</div>
                      </div>
                      <span className="chip gri">Fișă →</span>
                    </div>
                  </div>
                ))}
                {db.angajati.length === 0 && <div className="gol-msg">Niciun angajat. Adaugă oamenii ca să-i poți pune pe echipe și ca ei să poată intra în aplicație.</div>}
              </>
            )}

            {subOam === "echipe" && (
              <>
                <button className="btn btn-galben" onClick={() => setFoaie({ tip: "echipa" })}>+ Adaugă echipă</button>
                <div style={{ height: 12 }} />
                {db.echipe.map((e) => {
                  const membri = db.angajati.filter((a) => a.echipaId === e.id);
                  const sculeleEi = db.scule.filter((s) => s.echipaId === e.id);
                  return (
                    <div className="card" key={e.id}>
                      <div className="card-rand">
                        <div>
                          <div className="titlu">{e.nume}</div>
                          <div className="sub">{e.santier ? `Șantier: ${e.santier}` : "Fără șantier"} · {membri.length} oameni</div>
                        </div>
                        <span className="chip alocat">{sculeleEi.length} scule</span>
                      </div>
                      {(membri.length > 0 || sculeleEi.length > 0) && (
                        <div className="lista-in-card">
                          {membri.map((a) => <div key={a.id}>👷 {a.nume} <span style={{ color: "var(--mut)" }}>· {a.grad || "—"}</span></div>)}
                          {sculeleEi.map((s) => <div key={s.id}>🔧 {s.nume} <span className="mono" style={{ color: "var(--mut)" }}>· din {s.dataAlocare}</span></div>)}
                        </div>
                      )}
                      <div className="actiuni">
                        <button className="btn btn-mic principal" onClick={() => setFoaie({ tip: "membri", item: e })}>Gestionează membri</button>
                        <button className="btn btn-mic" onClick={() => setFoaie({ tip: "echipa", item: e })}>Modifică</button>
                        <button className="btn btn-mic pericol" onClick={() => stergeEchipa(e.id)}>Șterge</button>
                      </div>
                    </div>
                  );
                })}
                {db.echipe.length === 0 && <div className="gol-msg">Nicio echipă încă.</div>}
              </>
            )}
          </>
        )}

        {/* ---------- ȘANTIERE ---------- */}
        {tab === "santiere" && (
          <>
            <button className="btn btn-galben" onClick={() => setFoaie({ tip: "santier" })}>+ Adaugă șantier</button>
            <div style={{ height: 12 }} />
            {db.santiere.map((s) => {
              const ore = oreSantier(s.id);
              const oameni = new Set(pontajSantier(s.id).map((p) => p.angajatId || p.nume)).size;
              const finalizat = s.status === "finalizat";
              const b = bilant(s);
              const orePrev = Number(s.orePrev) || 0;
              const matPrev = prevMateriale(s);
              const procOre = orePrev > 0 ? Math.round((ore / orePrev) * 100) : null;
              const procMat = matPrev > 0 ? Math.round((b.materiale / matPrev) * 100) : null;
              const culoare = (p) => (p === null ? "var(--mut)" : p > 100 ? "var(--rosu)" : p > 85 ? "var(--galben)" : "var(--verde)");
              return (
                <div className="card" key={s.id}>
                  <div className="card-rand">
                    <div>
                      <div className="titlu">{s.nume}</div>
                      <div className="sub">
                        {s.client && <>{s.client} · </>}
                        {s.adresa && <>{s.adresa}</>}
                        {s.dataStart && <> · din {dataRo(s.dataStart)}</>}
                      </div>
                    </div>
                    <span className={"chip " + (finalizat ? "gri" : "ok")}>{finalizat ? "Finalizat" : "Activ"}</span>
                  </div>

                  {b.incasat > 0 && (
                    <div className="bara-marja">
                      <div className="bm-rand">
                        <span>Cifrat</span><b className="mono">{bani(b.incasat)}</b>
                      </div>
                      <div className="bm-rand">
                        <span>Cost real (manoperă + materiale)</span><b className="mono">{bani(b.cost)}</b>
                      </div>
                      <div className="bm-rand mare">
                        <span>Marjă</span>
                        <b className="mono" style={{ color: b.marja >= 0 ? "var(--verde)" : "var(--rosu)" }}>
                          {b.marja < 0 ? "−" : ""}{bani(Math.abs(b.marja))}{b.procent !== null && ` · ${b.procent}%`}
                        </b>
                      </div>
                    </div>
                  )}

                  <div className="plan-real">
                    <div className="pr-col">
                      <div className="pr-lbl">Ore</div>
                      <div className="pr-val mono" style={{ color: culoare(procOre) }}>{ore}h</div>
                      <div className="pr-prev">din {orePrev ? `${orePrev}h prevăzute` : "—"}{procOre !== null && ` · ${procOre}%`}</div>
                    </div>
                    <div className="pr-col">
                      <div className="pr-lbl">Materiale</div>
                      <div className="pr-val mono" style={{ color: culoare(procMat) }}>{bani(b.materiale)}</div>
                      <div className="pr-prev">din {matPrev ? bani(matPrev) + " prevăzut" : "—"}{procMat !== null && ` · ${procMat}%`}</div>
                    </div>
                    <div className="pr-col">
                      <div className="pr-lbl">Manoperă</div>
                      <div className="pr-val mono">{bani(b.manopera)}</div>
                      <div className="pr-prev">{oameni} {oameni === 1 ? "om" : "oameni"}</div>
                    </div>
                  </div>
                  <div className="actiuni">
                    {!finalizat && db.angajati.length > 0 && (
                      <button className="btn btn-mic principal" onClick={() => setFoaie({ tip: "pontaj", item: s })}>+ Pontaj</button>
                    )}
                    {!finalizat && (
                      <button className="btn btn-mic principal" onClick={() => setFoaie({ tip: "consum", item: s })}>+ Material</button>
                    )}
                    <button className="btn btn-mic" onClick={() => setFoaie({ tip: "sarcini", item: s })}>
                      📷 De rezolvat{db.sarcini.filter((x) => x.santierId === s.id && x.status === "deschis").length > 0
                        ? ` (${db.sarcini.filter((x) => x.santierId === s.id && x.status === "deschis").length})` : ""}
                    </button>
                    <button className="btn btn-mic" onClick={() => setFoaie({ tip: "detaliiSantier", item: s })}>Detalii</button>
                    <button className="btn btn-mic" onClick={() => setFoaie({ tip: "santier", item: s })}>Modifică</button>
                    <button className="btn btn-mic" onClick={() => salvSantier({ ...s, status: finalizat ? "activ" : "finalizat" })}>
                      {finalizat ? "Redeschide" : "Finalizează"}
                    </button>
                    <button className="btn btn-mic pericol" onClick={() => stergeSantier(s.id)}>Șterge</button>
                  </div>
                </div>
              );
            })}
            {db.santiere.length === 0 && (
              <div className="gol-msg">Niciun șantier. Adaugă-le, apoi pontezi zilnic cine a lucrat și câte ore — aplicația calculează singură costul manoperei pe fiecare șantier.</div>
            )}
          </>
        )}

        {/* ---------- PLANING ---------- */}
        {tab === "planing" && (() => {
          const luni = luniaSaptamanii(saptamana);
          const zile = [...Array(7)].map((_, i) => adaugaZile(luni, i));
          const eticheta = `${luni.getDate()} ${luni.toLocaleDateString("ro-RO", { month: "short" })} – ${adaugaZile(luni, 6).getDate()} ${adaugaZile(luni, 6).toLocaleDateString("ro-RO", { month: "short" })}`;
          return (
            <>
              <div className="nav-sapt">
                <button className="btn btn-mic" onClick={() => setSaptamana(saptamana - 1)}>‹</button>
                <div>
                  <div className="ns-titlu">{saptamana === 0 ? "Săptămâna asta" : saptamana === 1 ? "Săptămâna viitoare" : eticheta}</div>
                  <div className="ns-sub mono">{eticheta}</div>
                </div>
                <button className="btn btn-mic" onClick={() => setSaptamana(saptamana + 1)}>›</button>
              </div>
              <div className="actiuni" style={{ marginTop: 0, marginBottom: 12 }}>
                {saptamana !== 0 && <button className="btn btn-mic" onClick={() => setSaptamana(0)}>Azi</button>}
                <button className="btn btn-mic" onClick={() => copiazaSaptamana(luni)}>Copiază în săptămâna următoare</button>
                {(() => {
                  const zileSapt = [...Array(7)].map((_, k) => iso(adaugaZile(luni, k)));
                  const cate = db.planificare.filter((p) => zileSapt.includes(p.data)).length;
                  if (cate === 0) return null;
                  return (
                    <button className="btn btn-mic pericol"
                      onClick={() => cere(`Golești toată săptămâna? Se șterg ${cate} intrări.`,
                        () => salveaza({ ...db, planificare: db.planificare.filter((p) => !zileSapt.includes(p.data)) }),
                        "Golește săptămâna")}>
                      Golește săptămâna ({cate})
                    </button>
                  );
                })()}
              </div>

              {zile.map((d, i) => {
                const zi = iso(d);
                const intrari = db.planificare
                  .filter((p) => p.data === zi)
                  .sort((a, b) => (minute(a.oraStart) || 0) - (minute(b.oraStart) || 0));
                const eAzi = zi === iso(new Date());
                const weekend = i >= 5;
                return (
                  <div className="zi-plan" key={zi}>
                    <div className="zi-antet">
                      <div>
                        <b style={{ color: eAzi ? "var(--galben)" : weekend ? "var(--mut)" : "var(--text)" }}>{zileTrad()[i]}</b>
                        <span className="mono" style={{ color: "var(--mut)", fontSize: 12, marginLeft: 7 }}>{d.getDate()}.{String(d.getMonth() + 1).padStart(2, "0")}</span>
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        {intrari.length > 0 && (
                          <button className="btn btn-mic pericol"
                            onClick={() => cere(
                              `Golești ziua de ${ZILE[i]} ${dataRo(zi)}? Se șterg ${intrari.length} ${intrari.length === 1 ? "intrare" : "intrări"}.`,
                              () => salveaza({ ...db, planificare: db.planificare.filter((p) => p.data !== zi) }),
                              "Golește ziua")}>
                            Golește
                          </button>
                        )}
                        <button className="btn btn-mic" onClick={() => setFoaie({ tip: "plan", data: zi })}>+</button>
                      </div>
                    </div>
                    {intrari.length === 0 ? (
                      <div className="zi-gol">—</div>
                    ) : intrari.map((p) => {
                      const s = db.santiere.find((x) => x.id === p.santierId);
                      const ech = db.echipe.find((x) => x.id === p.echipaId);
                      const oameni = (p.angajatIds || []).map((id) => db.angajati.find((a) => a.id === id)?.nume).filter(Boolean);
                      return (
                        <div className="plan-item" key={p.id} onClick={() => setFoaie({ tip: "plan", item: p, data: zi })}>
                          <div className="pi-cap">
                            <div className="titlu" style={{ fontSize: 14 }}>🏗 {s ? s.nume : "Șantier șters"}</div>
                            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                              <span className="chip alocat mono">{interval(p)}</span>
                              <button className="btn-sterge-plan"
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  cere(`Ștergi ${s ? s.nume : "intrarea"} de ${interval(p)} din ${dataRo(zi)}?`,
                                    () => salveaza({ ...db, planificare: db.planificare.filter((x) => x.id !== p.id) }),
                                    "Șterge");
                                }}>✕</button>
                            </div>
                          </div>
                          <div className="sub">
                            {ech && <>Echipa {ech.nume}</>}
                            {oameni.length > 0 && <>{ech ? " + " : ""}{oameni.join(", ")}</>}
                            {!ech && oameni.length === 0 && "Fără oameni alocați"}
                            {p.note && <><br />{p.note}</>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              {db.santiere.length === 0 && (
                <div className="gol-msg">Adaugă întâi un șantier ca să poți planifica pe el.</div>
              )}
            </>
          );
        })()}

        {/* ---------- STATISTICI ---------- */}
        {tab === "setari" && subSet === "cifre" && (() => {
          /* ---- pe șantier ---- */
          const peSantier = db.santiere.map((s) => {
            const b = bilant(s);
            return { ...s, ...b, ore: oreSantier(s.id) };
          }).sort((a, b) => b.marja - a.marja);

          /* ---- pe muncitor ---- */
          const peOm = db.angajati.map((a) => {
            const ale = db.pontaj.filter((p) => p.angajatId === a.id);
            const ore = ale.reduce((s, p) => s + (Number(p.ore) || 0), 0);
            const cost = ale.reduce((s, p) => s + (Number(p.ore) || 0) * (Number(p.tarifOra) || 0), 0);
            /* venitul din manoperă atribuit proporțional cu orele lui pe fiecare șantier */
            let venit = 0;
            const oreDomeniu = {};
            const santiereLui = new Set();
            ale.forEach((p) => {
              const s = db.santiere.find((x) => x.id === p.santierId);
              if (!s) return;
              santiereLui.add(s.id);
              const dom = p.tipMunca || s.domeniu || "Diverse";
              oreDomeniu[dom] = (oreDomeniu[dom] || 0) + (Number(p.ore) || 0);
              const oreTot = oreSantier(s.id);
              if (oreTot > 0) {
                const manoperaVanduta = (Number(s.valoare) || 0) - costMaterialeSantier(s.id);
                venit += manoperaVanduta * ((Number(p.ore) || 0) / oreTot);
              }
            });
            const domenii = Object.entries(oreDomeniu).sort((x, y) => y[1] - x[1]);
            return { ...a, ore, cost, venit, aport: venit - cost,
              perOra: ore > 0 ? (venit - cost) / ore : 0,
              domenii, nrSantiere: santiereLui.size };
          }).filter((a) => a.ore > 0).sort((x, y) => y.aport - x.aport);

          /* ---- pierderi grupate ---- */
          const pierderiGrup = {};
          consumNealocat.forEach((c) => {
            const k = (c.nume || "").trim().toLowerCase();
            if (!pierderiGrup[k]) pierderiGrup[k] = { nume: c.nume, cant: 0, unitate: c.unitate, valoare: 0, ori: 0 };
            pierderiGrup[k].cant += Number(c.cant) || 0;
            pierderiGrup[k].valoare += (Number(c.cant) || 0) * (Number(c.pret) || 0);
            pierderiGrup[k].ori += 1;
          });
          const pierderiSortate = Object.values(pierderiGrup).sort((a, b) => b.valoare - a.valoare);
          const procPierderi = materialeAlocateTotal + pierderiTotal > 0
            ? Math.round((pierderiTotal / (materialeAlocateTotal + pierderiTotal)) * 100) : 0;

          /* ---- pe domeniu ---- */
          const peDomeniu = {};
          db.santiere.forEach((s) => {
            const d = s.domeniu || "Diverse";
            const b = bilant(s);
            if (!peDomeniu[d]) peDomeniu[d] = { cifrat: 0, marja: 0, nr: 0, ore: 0 };
            peDomeniu[d].cifrat += b.incasat;
            peDomeniu[d].marja += b.marja;
            peDomeniu[d].nr += 1;
            peDomeniu[d].ore += oreSantier(s.id);
          });
          const domeniiSortate = Object.entries(peDomeniu)
            .map(([d, v]) => ({ d, ...v, proc: v.cifrat > 0 ? Math.round((v.marja / v.cifrat) * 100) : null }))
            .sort((a, b) => b.marja - a.marja);

          const maxAbs = (lista, camp) => Math.max(1, ...lista.map((x) => Math.abs(x[camp])));

          return (
            <>
              <div className="sectiune">Bilanț general</div>
              <div className="card">
                <div className="fisa-rand"><span className="k">Cifrat pe lucrări</span><b className="mono">{bani(cifratTotal)}</b></div>
                <div className="fisa-rand"><span className="k">Manoperă pontată</span><b className="mono">−{bani(costManoperaTotal)}</b></div>
                <div className="fisa-rand"><span className="k">Materiale pe șantiere</span><b className="mono">−{bani(materialeAlocateTotal)}</b></div>
                <div className="fisa-rand">
                  <span className="k">Materiale fără destinație</span>
                  <b className="mono" style={{ color: pierderiTotal > 0 ? "var(--rosu)" : "var(--mut)" }}>−{bani(pierderiTotal)}</b>
                </div>
                <div className="fisa-rand" style={{ borderBottom: "none", paddingTop: 12 }}>
                  <span className="k"><b>Marjă netă</b></span>
                  <b className="mono" style={{ fontSize: 18, color: marjaTotala >= 0 ? "var(--verde)" : "var(--rosu)" }}>
                    {marjaTotala < 0 ? "−" : ""}{bani(Math.abs(marjaTotala))}
                  </b>
                </div>
              </div>

              <div className="sectiune">Materiale consumate fără șantier</div>
              {consumNealocat.length === 0 ? (
                <div className="gol-msg">Nimic nealocat — tot ce a ieșit din depozit are un șantier în spate.</div>
              ) : (
                <>
                  <div className="card">
                    <div className="card-rand">
                      <div>
                        <div className="titlu" style={{ color: "var(--rosu)" }}>{bani(pierderiTotal)} scurgere</div>
                        <div className="sub">{procPierderi}% din tot materialul ieșit din depozit · {consumNealocat.length} ieșiri</div>
                      </div>
                      <span className="chip alerta">Pierdut</span>
                    </div>
                    <div className="lista-in-card">
                      {pierderiSortate.slice(0, 10).map((p, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between" }}>
                          <span>📦 {p.nume} <span style={{ color: "var(--mut)" }}>· {p.cant} {p.unitate} în {p.ori} ieșiri</span></span>
                          <b className="mono">{bani(p.valoare)}</b>
                        </div>
                      ))}
                    </div>
                  </div>
                  <button className="btn btn-mic" onClick={() => setFoaie({ tip: "pierderi" })}>Vezi toate ieșirile</button>
                  <div style={{ height: 6 }} />
                </>
              )}

              <div className="sectiune">Marjă pe șantier</div>
              {peSantier.length === 0 ? (
                <div className="gol-msg">Niciun șantier de analizat.</div>
              ) : peSantier.map((s) => {
                const max = maxAbs(peSantier, "marja");
                return (
                  <div className="card" key={s.id} style={{ padding: "12px 14px" }}>
                    <div className="card-rand">
                      <div>
                        <div className="titlu" style={{ fontSize: 14 }}>{s.nume}</div>
                        <div className="sub">{s.domeniu || "Diverse"} · <span className="mono">{s.ore}h</span> · cifrat {bani(s.incasat)}</div>
                      </div>
                      <b className="mono" style={{ color: s.marja >= 0 ? "var(--verde)" : "var(--rosu)", whiteSpace: "nowrap" }}>
                        {s.marja < 0 ? "−" : ""}{bani(Math.abs(s.marja))}{s.procent !== null && <span style={{ fontSize: 11, color: "var(--mut)" }}> · {s.procent}%</span>}
                      </b>
                    </div>
                    <div className="bara"><div className="bara-fill" style={{
                      width: `${Math.min(100, (Math.abs(s.marja) / max) * 100)}%`,
                      background: s.marja >= 0 ? "var(--verde)" : "var(--rosu)" }} /></div>
                  </div>
                );
              })}

              <div className="sectiune">Muncitori — cine aduce mai mult</div>
              <div className="sub" style={{ marginBottom: 10 }}>
                Aport = partea din valoarea lucrării care revine orelor lui, minus cât l-ai plătit pe orele alea.
              </div>
              {peOm.length === 0 ? (
                <div className="gol-msg">Niciun pontaj înregistrat încă.</div>
              ) : peOm.map((a) => {
                const max = maxAbs(peOm, "aport");
                return (
                  <div className="card" key={a.id} style={{ padding: "12px 14px" }}>
                    <div className="card-rand">
                      <div>
                        <div className="titlu" style={{ fontSize: 14 }}>{a.nume}</div>
                        <div className="sub">
                          <span className="mono">{a.ore}h</span> pe {a.nrSantiere} {a.nrSantiere === 1 ? "șantier" : "șantiere"} · costat {bani(a.cost)}
                        </div>
                      </div>
                      <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <b className="mono" style={{ color: a.aport >= 0 ? "var(--verde)" : "var(--rosu)" }}>{a.aport < 0 ? "−" : ""}{bani(Math.abs(a.aport))}</b>
                        <div className="sub" style={{ marginTop: 0 }}>{a.perOra < 0 ? "−" : ""}{bani(Math.abs(a.perOra))}/h</div>
                      </div>
                    </div>
                    <div className="bara"><div className="bara-fill" style={{
                      width: `${Math.min(100, (Math.abs(a.aport) / max) * 100)}%`,
                      background: a.aport >= 0 ? "var(--verde)" : "var(--rosu)" }} /></div>
                    {a.domenii.length > 0 && (
                      <div className="lista-in-card" style={{ fontSize: 12.5 }}>
                        <b style={{ color: "var(--galben)" }}>{a.domenii[0][0]}</b> — {a.domenii[0][1]}h
                        {a.domenii.length > 1 && (
                          <span style={{ color: "var(--mut)" }}>
                            {" · "}{a.domenii.slice(1, 3).map(([d, o]) => `${d} ${o}h`).join(" · ")}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="sectiune">Ce tip de lucrare îți iese mai bine</div>
              {domeniiSortate.length === 0 ? (
                <div className="gol-msg">Adaugă șantiere cu tip de lucrare ca să vezi comparația.</div>
              ) : domeniiSortate.map((d) => (
                <div className="card" key={d.d} style={{ padding: "12px 14px" }}>
                  <div className="card-rand">
                    <div>
                      <div className="titlu" style={{ fontSize: 14 }}>{d.d}</div>
                      <div className="sub">{d.nr} {d.nr === 1 ? "lucrare" : "lucrări"} · <span className="mono">{d.ore}h</span> · cifrat {bani(d.cifrat)}</div>
                    </div>
                    <b className="mono" style={{ color: d.marja >= 0 ? "var(--verde)" : "var(--rosu)", whiteSpace: "nowrap" }}>
                      {d.marja < 0 ? "−" : ""}{bani(Math.abs(d.marja))}{d.proc !== null && <span style={{ fontSize: 11, color: "var(--mut)" }}> · {d.proc}%</span>}
                    </b>
                  </div>
                </div>
              ))}

              <div className="sub" style={{ margin: "16px 0 8px", lineHeight: 1.6 }}>
                Cifrele astea sunt cât de bune sunt datele pe care le bagi: orele pontate, prețurile materialelor și costul orar al fiecărui om. Domeniul fiecărui om vine din tipul de muncă bifat la pontaj — arată unde a strâns cele mai multe ore, nu neapărat unde e cel mai priceput.
              </div>
            </>
          );
        })()}

        {/* ---------- CAMIOANE ---------- */}
        {tab === "setari" && subSet === "auto" && (
          <>
            <button className="btn btn-galben" onClick={() => setFoaie({ tip: "camion" })}>+ Adaugă camion / utilaj</button>
            <div style={{ height: 12 }} />
            {db.camioane.map((c) => {
              const istoric = db.intretinere.filter((i) => i.camionId === c.id);
              const costTotal = istoric.reduce((s, i) => s + (Number(i.cost) || 0), 0);
              const expirari = [["ITP", c.itp], ["Asig.", c.asigurare], ["Revizie", c.revizie]]
                .filter(([, d]) => d)
                .map(([t, d]) => ({ t, d, z: zileRamase(d) }));
              return (
                <div className="card" key={c.id}>
                  <div className="card-rand">
                    <div>
                      <div className="titlu">{c.nume}</div>
                      <div className="sub">
                        {c.numar && <><span className="mono">{c.numar}</span> · </>}
                        {c.km && <><b className="mono">{Number(c.km).toLocaleString("ro-RO")} km</b> · </>}
                        întreținere totală: <b>{bani(costTotal)}</b>
                      </div>
                    </div>
                    {expirari.some((e) => e.z <= 30)
                      ? <span className="chip alerta">Verifică acte</span>
                      : <span className="chip ok">În regulă</span>}
                  </div>
                  {expirari.length > 0 && (
                    <div className="lista-in-card">
                      {expirari.map((e, i) => (
                        <div key={i}>
                          {e.z <= 30 ? "🔴" : "🟢"} {e.t}: {dataRo(e.d)}
                          {e.z !== null && <span style={{ color: e.z <= 30 ? "var(--rosu)" : "var(--mut)" }}> · {e.z < 0 ? `expirat de ${-e.z} zile` : `${e.z} zile`}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="actiuni">
                    <button className="btn btn-mic principal" onClick={() => setFoaie({ tip: "intretinere", item: c })}>+ Întreținere</button>
                    <button className="btn btn-mic" onClick={() => setFoaie({ tip: "istoricCamion", item: c })}>Istoric ({istoric.length})</button>
                    <button className="btn btn-mic" onClick={() => setFoaie({ tip: "camion", item: c })}>Modifică</button>
                    <button className="btn btn-mic pericol" onClick={() => stergeGen("camioane", "Ștergi acest vehicul?")(c.id)}>Șterge</button>
                  </div>
                </div>
              );
            })}
            {db.camioane.length === 0 && <div className="gol-msg">Niciun vehicul. Adaugă camioanele și utilajele ca să urmărești ITP, asigurări, revizii și costurile de întreținere.</div>}
          </>
        )}

        {tab === "setari" && subSet === "cont" && (
          <>
            <div className="card">
              <div className="titlu">PIN admin</div>
              <div className="sub">Cu el intri în panoul ăsta. Nu-l da mai departe — de aici se văd prețurile, marjele și salariile.</div>
              <div className="actiuni">
                <button className="btn btn-mic principal" onClick={() => setFoaie({ tip: "pin" })}>Schimbă PIN</button>
              </div>
            </div>
            <div className="card">
              <div className="titlu">Parolele muncitorilor</div>
              <div className="sub">
                {db.angajati.filter((a) => a.pin).length} din {db.angajati.length} și-au setat parola.
                Le resetezi individual din fișa fiecăruia, la Oameni.
              </div>
            </div>
            <div className="card">
              <div className="titlu">Limba aplicației</div>
              <div className="sub">
                Se aplică doar pe telefonul ăsta. Fiecare om își alege limba lui.
              </div>
              <div className="actiuni">
                {LIMBI.map((l) => (
                  <button key={l.cod}
                    className={"btn btn-mic" + (limba === l.cod ? " principal" : "")}
                    onClick={() => setLimba(l.cod)}>
                    {l.steag} {l.nume}
                  </button>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="titlu">Ieșire din cont</div>
              <div className="sub">Te întorci la ecranul de intrare. Datele rămân salvate.</div>
              <div className="actiuni">
                <button className="btn btn-mic pericol" onClick={() => setIdent(null)}>Ieși din contul de admin</button>
              </div>
            </div>

            <div className="card">
              <div className="titlu">Date în aplicație</div>
              <div className="sub">
                {db.santiere.length} șantiere · {db.materiale.length} materiale · {db.scule.length} scule ·{" "}
                {db.angajati.length} angajați · {db.camioane.length} vehicule · {db.pontaj.length} pontaje
              </div>
            </div>
          </>
        )}

        {tab === "setari" && subSet === "dotare" && (
          <Dotare db={db} onSalveaza={salveaza} setFoaie={setFoaie} cere={cere} />
        )}

        {tab === "setari" && subSet === "invitatii" && (
          <Invitatii db={db} onSeteazaPin={(id, pin) => setPinAngajat(id, pin, false)} />
        )}

        {tab === "setari" && subSet === "backup" && (
          <>
            {lucruBackup && (
              <div className="card" style={{ borderColor: "var(--galben)" }}>
                <div className="titlu" style={{ fontSize: 14 }}>{lucruBackup}</div>
              </div>
            )}

            <div className="card">
              <div className="titlu">Salvează pe telefon</div>
              <div className="sub">
                Descarcă un fișier cu tot ce e în aplicație. Ține-l undeva sigur — pe Drive, pe mail, pe calculator.
                <br />Acum: {rezumatDate(db)}.
              </div>
              <div className="actiuni">
                <button className="btn btn-mic principal" onClick={() => exporta(true)}>Backup complet (cu poze)</button>
                <button className="btn btn-mic" onClick={() => exporta(false)}>Doar datele (fișier mic)</button>
              </div>
            </div>

            <div className="card">
              <div className="titlu">Copie rapidă în aplicație</div>
              <div className="sub">
                Un punct de întoarcere, ținut chiar aici. Se păstrează ultimele {MAX_COPII}, fără poze.
                Bună înainte de o modificare mare — dar nu înlocuiește fișierul descărcat.
              </div>
              <div className="actiuni">
                <button className="btn btn-mic principal" onClick={faCopieRapida}>Fă o copie acum</button>
                <button className="btn btn-mic" onClick={incarcaCopii}>Reîmprospătează lista</button>
              </div>
            </div>

            {copiiSalvate.length > 0 && (
              <>
                <div className="sectiune">Copii disponibile</div>
                {copiiSalvate.map((c) => (
                  <div className="card" key={c.cheie}>
                    <div className="card-rand">
                      <div>
                        <div className="titlu" style={{ fontSize: 14 }}>
                          {new Date(c.cand).toLocaleString("ro-RO")}
                        </div>
                        <div className="sub">{c.rezumat}</div>
                      </div>
                    </div>
                    <div className="actiuni">
                      <button className="btn btn-mic principal" onClick={() => restaureazaCopie(c.cheie)}>Restaurează</button>
                      <button className="btn btn-mic pericol" onClick={() => stergeCopie(c.cheie)}>Șterge</button>
                    </div>
                  </div>
                ))}
              </>
            )}

            <div className="sectiune">Restaurare din fișier</div>
            <div className="card">
              <div className="sub" style={{ marginBottom: 11, color: "var(--rosu)" }}>
                ⚠ Importul înlocuiește TOT ce e acum în aplicație. Fă întâi o copie rapidă, ca să ai unde te întoarce.
              </div>
              <label className="buton-poza">
                <input type="file" accept="application/json,.json"
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) importa(f); }}
                  style={{ position: "absolute", opacity: 0, width: 0, height: 0 }} />
                📂 Alege fișierul de backup
              </label>
            </div>

            <div className="sub" style={{ margin: "14px 0 8px", lineHeight: 1.6 }}>
              Sfat practic: fă un backup complet o dată pe lună și înainte de orice curățenie mare (ștergeri de șantiere,
              de angajați). Fișierul e text simplu — îl poți deschide și citi oricând, chiar și fără aplicație.
            </div>
          </>
        )}

        {/* ---------- CERERI ---------- */}
        {tab === "cereri" && (
          <>
            <div className="sectiune">Probleme și necesar raportate de pe teren</div>
            {db.cereri.length === 0 ? (
              <div className="gol-msg">Nimic raportat. Muncitorii intră cu contul lor și trimit probleme sau ce le lipsește — apare doar aici, la tine.</div>
            ) : db.cereri.map((c) => (
              <div className="card" key={c.id}>
                <div className="card-rand">
                  <div>
                    <div className="titlu">{t(c.tip === "problema" ? "⚠ Problemă" : "📦 Necesar")} · {c.autorNume}</div>
                    <div className="sub">{c.text}<br /><span className="mono">{c.cand}</span></div>
                  </div>
                  <span className={"chip " + (c.status === "nou" ? "alocat" : "ok")}>
                    {c.status === "nou" ? "Nouă" : "Rezolvată"}
                  </span>
                </div>
                <div className="actiuni">
                  {c.status === "nou"
                    ? <button className="btn btn-mic principal" onClick={() => marcheazaCerere(c.id, "rezolvat")}>Marchează rezolvată</button>
                    : <button className="btn btn-mic" onClick={() => marcheazaCerere(c.id, "nou")}>Redeschide</button>}
                  <button className="btn btn-mic pericol" onClick={() => stergeCerere(c.id)}>Șterge</button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* ---------- FORMULARE ADMIN ---------- */}
      {foaie?.tip === "material" && <FormMaterial item={foaie.item} onSalveaza={salvMaterial} onClose={() => setFoaie(null)} />}
      {foaie?.tip === "scula" && <FormScula item={foaie.item} onSalveaza={salvScula} onClose={() => setFoaie(null)} />}
      {foaie?.tip === "echipa" && <FormEchipa item={foaie.item} onSalveaza={salvEchipa} onClose={() => setFoaie(null)} />}
      {foaie?.tip === "angajat" && <FormAngajat item={foaie.item} echipe={db.echipe} onSalveaza={salvAngajat} onClose={() => setFoaie(null)} />}
      {foaie?.tip === "fisa" && (
        <FisaAngajat
          angajat={db.angajati.find((a) => a.id === foaie.item.id)}
          echipe={db.echipe}
          numeEchipa={numeEchipa}
          pontaj={db.pontaj}
          santiere={db.santiere}
          onEdit={() => setFoaie({ tip: "angajat", item: foaie.item })}
          onMuta={(echipaId) => salvAngajat({ ...db.angajati.find((a) => a.id === foaie.item.id), echipaId })}
          onSterge={() => stergeAngajat(foaie.item.id)}
          onParola={() => setFoaie({ tip: "parola", item: db.angajati.find((a) => a.id === foaie.item.id) })}
          onClose={() => setFoaie(null)}
        />
      )}
      {foaie?.tip === "santier" && <FormSantier item={foaie.item} onSalveaza={salvSantier} onClose={() => setFoaie(null)} />}
      {foaie?.tip === "pontaj" && (
        <FormPontaj santier={foaie.item} angajati={db.angajati} echipe={db.echipe}
          onSalveaza={(data, randuri) => adaugaPontaj(foaie.item.id, data, randuri)} onClose={() => setFoaie(null)} />
      )}
      {foaie?.tip === "membri" && (
        <GestioneazaMembri echipa={foaie.item} angajati={db.angajati} echipe={db.echipe}
          onSalveaza={(ids) => seteazaMembri(foaie.item.id, ids)} onClose={() => setFoaie(null)} />
      )}
      {foaie?.tip === "plan" && (
        <FormPlan
          key={foaie.item?.id || foaie.data}
          item={foaie.item} data={foaie.data} santiere={db.santiere} echipe={db.echipe}
          angajati={db.angajati} planificare={db.planificare}
          onSalveaza={salvPlan} onSterge={stergePlan}
          onModificaAlta={(p) => setFoaie({ tip: "plan", item: p, data: p.data })}
          onSalveazaAlta={(p) => salveaza({
            ...db, planificare: db.planificare.map((x) => (x.id === p.id ? p : x)),
          })}
          onInlocuieste={inlocuiestePlan}
          onImparte={imparteplan}
          onCere={cere}
          onClose={() => setFoaie(null)} />
      )}
      {foaie?.tip === "parola" && (
        <FormParolaAngajat angajat={foaie.item} onSalveaza={(pin) => setPinAngajat(foaie.item.id, pin)} onClose={() => setFoaie(null)} />
      )}
      {foaie?.tip === "sarcini" && (
        <ListaSarcini
          santier={foaie.item}
          sarcini={db.sarcini.filter((x) => x.santierId === foaie.item.id)}
          esteAdmin
          onAdauga={() => setFoaie({ tip: "sarcinaNoua", santierId: foaie.item.id, inapoi: foaie.item })}
          onComuta={(id) => comutaSarcina(id, "Admin")}
          onSterge={stergeSarcina}
          onClose={() => setFoaie(null)} />
      )}
      {foaie?.tip === "sarcinaNoua" && (
        <FormSarcina santierId={foaie.santierId} onSalveaza={salvSarcina}
          onClose={() => setFoaie(foaie.inapoi ? { tip: "sarcini", item: foaie.inapoi } : null)} />
      )}
      {foaie?.tip === "verificare" && (
        <FormVerificare echipa={foaie.item} dotare={db.dotare} scule={db.scule}
          onSalveaza={(v) => {
            const echipa = db.echipe.find((e) => e.id === v.echipaId);
            const lipsa = v.randuri.filter((r) => !r.ok).length;
            /* ce a bifat și nu exista în inventar devine sculă alocată echipei */
            const noi = v.randuri
              .filter((r) => r.ok && !r.gasitId)
              .map((r) => ({
                id: uid(), nume: r.nume, cod: "", pret: 0, bucati: r.cant || 1,
                stare: "alocat", echipaId: v.echipaId, dataAlocare: azi(), dinDotare: true,
              }));
            salveaza(cuJurnal(
              { ...db, verificari: [v, ...db.verificari], scule: [...db.scule, ...noi] },
              `Verificare dotare ${echipa?.nume}: ${lipsa === 0 ? "complet" : `${lipsa} lipsă`}` +
              (noi.length ? ` · ${noi.length} scule trecute în inventarul echipei` : "")));
            setFoaie(null);
          }}
          onClose={() => setFoaie(null)} />
      )}
      {foaie?.tip === "istoricVerificari" && (
        <IstoricVerificari echipa={foaie.item}
          verificari={db.verificari.filter((v) => v.echipaId === foaie.item.id).sort((a, b) => b.cand.localeCompare(a.cand))}
          onSterge={(id) => {
            cere("Ștergi această verificare din istoric?", () =>
              salveaza({ ...db, verificari: db.verificari.filter((v) => v.id !== id) }), "Șterge");
          }}
          onClose={() => setFoaie(null)} />
      )}
      {foaie?.tip === "iesire" && (
        <FormIesire material={foaie.item} santiere={db.santiere}
          onSalveaza={(sid, c) => adaugaConsum(sid, c)} onClose={() => setFoaie(null)} />
      )}
      {foaie?.tip === "pierderi" && (
        <Foaie titlu="Ieșiri fără șantier" onClose={() => setFoaie(null)}>
          {consumNealocat.map((c) => (
            <div className="jurnal-rand" key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div className="cand mono">{dataRo(c.data)}{c.motiv && ` · ${c.motiv}`}</div>
                <div className="ce">{c.nume} · <b className="mono">{c.cant} {c.unitate}</b>{c.pret > 0 && <> · {bani(c.cant * c.pret)}</>}</div>
              </div>
              <button className="btn btn-mic pericol" onClick={() => stergeConsum(c.id)}>✕</button>
            </div>
          ))}
        </Foaie>
      )}
      {foaie?.tip === "consum" && (
        <FormConsum santier={foaie.item} materiale={db.materiale}
          onSalveaza={(c) => adaugaConsum(foaie.item.id, c)} onClose={() => setFoaie(null)} />
      )}
      {foaie?.tip === "detaliiSantier" && (
        <DetaliiSantier
          santier={db.santiere.find((x) => x.id === foaie.item.id)}
          pontaj={pontajSantier(foaie.item.id)}
          consum={consumSantier(foaie.item.id)}
          bilant={bilant(db.santiere.find((x) => x.id === foaie.item.id) || foaie.item)}
          matPrev={prevMateriale(db.santiere.find((x) => x.id === foaie.item.id) || foaie.item)}
          onStergePontaj={stergePontaj} onStergeConsum={stergeConsum} onClose={() => setFoaie(null)} />
      )}
      {foaie?.tip === "camion" && <FormCamion item={foaie.item} onSalveaza={salvCamion} onClose={() => setFoaie(null)} />}
      {foaie?.tip === "intretinere" && (
        <FormIntretinere camion={foaie.item} onSalveaza={(i) => adaugaIntretinere(foaie.item.id, i)} onClose={() => setFoaie(null)} />
      )}
      {foaie?.tip === "istoricCamion" && (
        <Foaie titlu={`Istoric: ${foaie.item.nume}`} onClose={() => setFoaie(null)}>
          {db.intretinere.filter((i) => i.camionId === foaie.item.id).length === 0 ? (
            <div className="gol-msg">Nicio intervenție notată.</div>
          ) : db.intretinere.filter((i) => i.camionId === foaie.item.id).map((i) => (
            <div className="jurnal-rand" key={i.id}>
              <div className="cand mono">{i.data}{i.km ? ` · ${Number(i.km).toLocaleString("ro-RO")} km` : ""}</div>
              <div className="ce">{i.tip}{i.cost ? <> · <b>{bani(i.cost)}</b></> : ""}{i.note ? <><br />{i.note}</> : ""}</div>
            </div>
          ))}
        </Foaie>
      )}
      {foaie?.tip === "aloca" && (
        <Foaie titlu={`Alocă: ${foaie.item.nume}`} onClose={() => setFoaie(null)}>
          {db.echipe.map((e) => (
            <button key={e.id} className="btn btn-galben" style={{ marginBottom: 9 }} onClick={() => alocaScula(foaie.item.id, e.id)}>
              {e.nume} {e.santier ? `· ${e.santier}` : ""}
            </button>
          ))}
        </Foaie>
      )}
      {foaie?.tip === "pin" && (
        <FormPin actual={db.setari.pin} onSalveaza={(pin) => { salveaza({ ...db, setari: { ...db.setari, pin } }); setFoaie(null); }} onClose={() => setFoaie(null)} />
      )}

      <Confirmare intrebare={intrebare} onInchide={() => setIntrebare(null)} />

      {/* ---------- NAVIGARE ADMIN ---------- */}
      <nav className="nav">
        {[
          ["panou", "▦", t("Panou"), alerteCamioane.length + cereriNoi.length],
          ["santiere", "🏗", t("Șantiere"), 0],
          ["planing", "🗓", t("Planing"), 0],
          ["inventar", "▤", t("Stoc"), stocScazut.length + db.scule.filter((x) => x.stare === "problema").length],
          ["cereri", "✉", t("Cereri"), cereriNoi.length],
          ["setari", "⚙", t("Setări"), 0],
        ].map(([id, ico, lbl, badge]) => (
          <button key={id} className={tab === id ? "activ" : ""} onClick={() => { setTab(id); setCauta(""); }}>
            {badge > 0 && <span className="bulina">{badge}</span>}
            <span className="ico">{ico}</span>{lbl}
          </button>
        ))}
      </nav>
    </div>
  );
}

/* ==================== ECRAN DE INTRARE ==================== */
/* ------------------------------------------------------------
   BACKUP — export/import fișier + copii rapide în stocare
   ------------------------------------------------------------ */
const VERSIUNE_BACKUP = 1;
const MAX_COPII = 5;

const numeFisier = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `santier-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
};

/* strânge toate pozele din stocare */
const adunaPoze = async () => {
  const poze = {};
  const r = await stocare.list("foto:", true);
  for (const cheie of r?.keys || []) {
    try {
      const v = await stocare.get(cheie, true);
      if (v?.value) poze[cheie.replace("foto:", "")] = v.value;
    } catch (e) {}
  }
  return poze;
};

const descarca = (text, nume) => {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nume;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};

/* Consum pentru șefii de echipă: trei pași mari, fără cifre inutile.
   1. pe ce șantier  2. ce material  3. cât — și gata. */
/* ------------------------------------------------------------
   DOTARE ECHIPE — lista de scule pe care trebuie să le aibă
   fiecare echipă, plus verificări periodice.
   ------------------------------------------------------------ */
const normalizeaza = (x) =>
  (x || "").toLowerCase()
    .replace(/[ăâ]/g, "a").replace(/[îi]/g, "i").replace(/[șş]/g, "s").replace(/[țţ]/g, "t");

/* ghicește dacă echipa are deja sculă potrivită, după cuvintele din denumire */
const ghiceste = (numeDotare, sculeleEchipei) => {
  const cuvinte = normalizeaza(numeDotare).split(/[^a-z0-9]+/).filter((c) => c.length > 3);
  if (cuvinte.length === 0) return null;
  return sculeleEchipei.find((s) => {
    const n = normalizeaza(s.nume);
    return cuvinte.some((c) => n.includes(c));
  }) || null;
};

const zileDeLa = (dataISO) => {
  if (!dataISO) return null;
  return Math.floor((Date.now() - new Date(dataISO).getTime()) / 86400000);
};

function Dotare({ db, onSalveaza, setFoaie, cere }) {
  const [nume, setNume] = useState("");
  const [cant, setCant] = useState("1");

  const adauga = () => {
    if (!nume.trim()) return;
    onSalveaza({ ...db, dotare: [...db.dotare, { id: uid(), nume: nume.trim(), cant: Number(cant) || 1 }] });
    setNume(""); setCant("1");
  };
  const sterge = (id) => {
    cere("Scoți sculă asta din dotarea standard?", () =>
      onSalveaza({ ...db, dotare: db.dotare.filter((x) => x.id !== id) }), "Scoate");
  };

  const ultimaVerificare = (echipaId) =>
    db.verificari.filter((v) => v.echipaId === echipaId).sort((a, b) => b.cand.localeCompare(a.cand))[0] || null;

  return (
    <>
      <div className="card">
        <div className="titlu">🧰 Dotarea standard</div>
        <div className="sub">
          Sculele pe care trebuie să le aibă orice echipă, indiferent de șantier. După ce o scrii o dată,
          verifici din când în când fiecare echipă și rămâne notat ce lipsea și când.
        </div>
      </div>

      <div className="camp">
        <label>Adaugă în listă</label>
        <div className="rand-dotare">
          <input value={nume} onChange={(e) => setNume(e.target.value)}
            placeholder="ex. Flex 230mm" onKeyDown={(e) => e.key === "Enter" && adauga()} />
          <input type="number" value={cant} onChange={(e) => setCant(e.target.value)} placeholder="1" />
          <button className="btn btn-mic principal" onClick={adauga}>+</button>
        </div>
      </div>

      {db.dotare.length === 0 ? (
        <div className="gol-msg">
          Lista e goală. Scrie ce nu trebuie să lipsească din nicio dubă: flex, bormașină, nivelă,
          prelungitor, trusă de chei, cască și vestă.
        </div>
      ) : (
        db.dotare.map((d) => (
          <div className="card" key={d.id} style={{ padding: "11px 14px" }}>
            <div className="card-rand">
              <div className="titlu" style={{ fontSize: 14.5 }}>
                {d.nume} {d.cant > 1 && <span className="mono" style={{ color: "var(--galben)" }}>×{d.cant}</span>}
              </div>
              <button className="btn btn-mic pericol" onClick={() => sterge(d.id)}>✕</button>
            </div>
          </div>
        ))
      )}

      <div className="sectiune">Verificare pe echipe</div>
      {db.echipe.length === 0 ? (
        <div className="gol-msg">Nicio echipă de verificat.</div>
      ) : db.dotare.length === 0 ? (
        <div className="gol-msg">Scrie întâi lista de mai sus.</div>
      ) : (
        db.echipe.map((e) => {
          const v = ultimaVerificare(e.id);
          const zile = v ? zileDeLa(v.cand) : null;
          const lipsa = v ? v.randuri.filter((r) => !r.ok).length : 0;
          const vechi = zile === null || zile > 30;
          return (
            <div className="card" key={e.id}>
              <div className="card-rand">
                <div>
                  <div className="titlu">{e.nume}</div>
                  <div className="sub">
                    {v
                      ? <>Verificată acum {zile === 0 ? "azi" : `${zile} ${zile === 1 ? "zi" : "zile"}`}
                          {zile > 0 && " în urmă"} · de {v.de}</>
                      : "Niciodată verificată"}
                  </div>
                </div>
                {v
                  ? <span className={"chip " + (lipsa > 0 ? "alerta" : "ok")}>
                      {lipsa > 0 ? `${lipsa} lipsă` : "Complet"}
                    </span>
                  : <span className="chip gri">Neverificată</span>}
              </div>

              {v && lipsa > 0 && (
                <div className="lista-in-card">
                  {v.randuri.filter((r) => !r.ok).map((r, i) => (
                    <div key={i} style={{ color: "var(--rosu)" }}>
                      ✗ {r.nume}{r.note && <span style={{ color: "var(--mut)" }}> · {r.note}</span>}
                    </div>
                  ))}
                </div>
              )}

              <div className="actiuni">
                <button className={"btn btn-mic" + (vechi ? " principal" : "")}
                  onClick={() => setFoaie({ tip: "verificare", item: e })}>
                  {v ? "Verifică din nou" : "Verifică acum"}
                </button>
                {db.verificari.filter((x) => x.echipaId === e.id).length > 0 && (
                  <button className="btn btn-mic" onClick={() => setFoaie({ tip: "istoricVerificari", item: e })}>
                    Istoric ({db.verificari.filter((x) => x.echipaId === e.id).length})
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}
    </>
  );
}

function FormVerificare({ echipa, dotare, scule, onSalveaza, onClose }) {
  const sculeleEchipei = scule.filter((s) => s.echipaId === echipa.id);
  /* pornesc cu ghicitul: dacă găsesc o sculă potrivită, o bifez */
  const [randuri, setRanduri] = useState(
    dotare.map((d) => {
      const gasit = ghiceste(d.nume, sculeleEchipei);
      return { dotareId: d.id, nume: d.nume, cant: d.cant, ok: !!gasit,
        sugestie: gasit?.nume || null, gasitId: gasit?.id || null, note: "" };
    })
  );
  const [de, setDe] = useState("");

  const comuta = (i) => setRanduri(randuri.map((r, j) => (j === i ? { ...r, ok: !r.ok } : r)));
  const setNota = (i, val) => setRanduri(randuri.map((r, j) => (j === i ? { ...r, note: val } : r)));
  const lipsa = randuri.filter((r) => !r.ok).length;

  return (
    <Foaie titlu={`Verificare: ${echipa.nume}`} onClose={onClose}>
      <div className="sub" style={{ marginBottom: 12 }}>
        Bifat = are. Am pornit cu ce am găsit alocat echipei, dar verifică pe teren — bifa e a ta, nu a aplicației.
        Ce bifezi și nu e încă în inventar intră automat în inventarul echipei.
      </div>

      {randuri.map((r, i) => (
        <div key={r.dotareId} style={{ borderBottom: "1px dashed var(--linie)", padding: "9px 2px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 11, fontSize: 14.5, fontWeight: 500, cursor: "pointer" }}>
            <input type="checkbox" checked={r.ok} onChange={() => comuta(i)}
              style={{ width: 21, height: 21, accentColor: "var(--verde)", flex: "none" }} />
            <span style={{ textDecoration: r.ok ? "none" : "none", color: r.ok ? "var(--text)" : "var(--rosu)" }}>
              {r.nume} {r.cant > 1 && <span className="mono">×{r.cant}</span>}
              {r.sugestie && <span className="rb-sub">găsit în inventar: {r.sugestie}</span>}
              {!r.sugestie && <span className="rb-sub">nu apare nimic alocat echipei</span>}
            </span>
          </label>
          {!r.ok && (
            <input value={r.note} onChange={(e) => setNota(i, e.target.value)}
              placeholder="ce s-a întâmplat? (pierdut, stricat, la altă echipă…)"
              style={{ marginTop: 7, padding: "8px 10px", fontSize: 13, width: "100%",
                background: "var(--asfalt)", border: "1px solid var(--linie)", borderRadius: 8,
                color: "var(--text)", fontFamily: "'Archivo',sans-serif" }} />
          )}
        </div>
      ))}

      <div className="camp" style={{ marginTop: 14 }}>
        <label>Cine a verificat</label>
        <input value={de} onChange={(e) => setDe(e.target.value)} placeholder="ex. eu, sau numele șefului de echipă" />
      </div>

      <div className={lipsa > 0 ? "conflict" : ""} style={{ marginBottom: 12 }}>
        <b style={{ color: lipsa > 0 ? "var(--rosu)" : "var(--verde)" }}>
          {lipsa === 0 ? "✓ Dotare completă" : `${lipsa} ${lipsa === 1 ? "sculă lipsește" : "scule lipsesc"}`}
        </b>
      </div>

      <button className="btn btn-galben"
        onClick={() => onSalveaza({
          id: uid(), echipaId: echipa.id, cand: new Date().toISOString(),
          de: de.trim() || "Admin",
          randuri: randuri.map(({ dotareId, nume, cant, ok, note, gasitId }) => ({ dotareId, nume, cant, ok, note, gasitId })),
        })}>
        Salvează verificarea
      </button>
    </Foaie>
  );
}

function IstoricVerificari({ echipa, verificari, onSterge, onClose }) {
  return (
    <Foaie titlu={`Istoric: ${echipa.nume}`} onClose={onClose}>
      {verificari.length === 0 ? (
        <div className="gol-msg">Nicio verificare încă.</div>
      ) : verificari.map((v) => {
        const lipsa = v.randuri.filter((r) => !r.ok);
        return (
          <div className="card" key={v.id}>
            <div className="card-rand">
              <div>
                <div className="titlu" style={{ fontSize: 14 }}>
                  {new Date(v.cand).toLocaleDateString("ro-RO")}
                </div>
                <div className="sub">de {v.de} · {v.randuri.length} poziții verificate</div>
              </div>
              <span className={"chip " + (lipsa.length > 0 ? "alerta" : "ok")}>
                {lipsa.length > 0 ? `${lipsa.length} lipsă` : "Complet"}
              </span>
            </div>
            {lipsa.length > 0 && (
              <div className="lista-in-card">
                {lipsa.map((r, i) => (
                  <div key={i} style={{ color: "var(--rosu)" }}>
                    ✗ {r.nume}{r.note && <span style={{ color: "var(--mut)" }}> · {r.note}</span>}
                  </div>
                ))}
              </div>
            )}
            <div className="actiuni">
              <button className="btn btn-mic pericol" onClick={() => onSterge(v.id)}>Șterge</button>
            </div>
          </div>
        );
      })}
    </Foaie>
  );
}

const PROBLEME_SCULA = [
  { tip: "Stricată", ico: "🔧", desc: "Nu mai merge sau merge prost" },
  { tip: "Pierdută", ico: "❓", desc: "Nu o mai găsim pe șantier" },
  { tip: "Furată", ico: "🚨", desc: "A dispărut, bănuim furt" },
  { tip: "La altă echipă", ico: "↔️", desc: "A luat-o altcineva" },
  { tip: "La service", ico: "🛠", desc: "Am dus-o la reparat" },
];

function RaportScula({ scula, onSalveaza, onClose }) {
  const [tip, setTip] = useState(null);
  const [note, setNote] = useState("");

  if (!tip)
    return (
      <Foaie titlu={scula.nume} onClose={onClose}>
        <div className="sub" style={{ marginBottom: 12 }}>Ce s-a întâmplat cu ea?</div>
        {PROBLEME_SCULA.map((p) => (
          <button key={p.tip} className="btn btn-mare" onClick={() => setTip(p.tip)}>
            <span>{p.ico} {p.tip}</span>
            <span className="bm-stoc">{p.desc}</span>
          </button>
        ))}
      </Foaie>
    );

  return (
    <Foaie titlu={`${scula.nume}: ${tip}`} onClose={onClose}>
      <div className="camp">
        <label>Spune pe scurt ce s-a întâmplat</label>
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder={
            tip === "Stricată" ? "ex. nu mai pornește, a scos fum" :
            tip === "Pierdută" ? "ex. am căutat peste tot, ultima dată era marți" :
            tip === "Furată" ? "ex. a dispărut peste noapte din baracă" :
            tip === "La altă echipă" ? "ex. a luat-o Radu pentru apartament" :
            "ex. dusă la garajul din Angers, gata săptămâna viitoare"} />
      </div>
      <div className="sub" style={{ marginBottom: 12 }}>Șeful primește imediat mesajul.</div>
      <button className="btn btn-galben" onClick={() => onSalveaza(tip, note.trim())}>Trimite</button>
      <button className="btn btn-mic" style={{ width: "100%", marginTop: 9 }} onClick={() => setTip(null)}>
        ← Altceva
      </button>
    </Foaie>
  );
}

function ConsumSimplu({ santiere, materiale, numeleMeu, onSalveaza, onClose }) {
  const [pas, setPas] = useState(santiere.length === 1 ? 2 : 1);
  const [santierId, setSantierId] = useState(santiere.length === 1 ? santiere[0].id : "");
  const [mat, setMat] = useState(null);
  const [cant, setCant] = useState(1);
  const [cauta, setCauta] = useState("");
  const [gata, setGata] = useState(false);

  const santier = santiere.find((s) => s.id === santierId);
  const lista = cauta.trim()
    ? materiale.filter((m) => m.nume.toLowerCase().includes(cauta.trim().toLowerCase()))
    : materiale;

  const trimite = () => {
    onSalveaza(santierId, {
      materialId: mat.id, cant, pret: mat.pret, unitate: mat.unitate,
      data: aziISO(), scadeDinStoc: true, inregistratDe: numeleMeu,
    });
    setGata(true);
  };

  if (gata)
    return (
      <Foaie titlu="Gata" onClose={onClose}>
        <div className="pas-gata">
          <div className="bifa-mare">✓</div>
          <div className="titlu" style={{ fontSize: 17 }}>Am notat</div>
          <div className="sub">
            {cant} {mat.unitate} {mat.nume}<br />pe {santier?.nume}
          </div>
        </div>
        <button className="btn btn-galben" onClick={() => {
          setGata(false); setMat(null); setCant(1); setCauta("");
          setPas(santiere.length === 1 ? 2 : 1);
        }}>
          Mai adaug ceva
        </button>
        <button className="btn btn-mic" style={{ width: "100%", marginTop: 9 }} onClick={onClose}>Am terminat</button>
      </Foaie>
    );

  /* pasul 1 — unde */
  if (pas === 1)
    return (
      <Foaie titlu="Unde ai lucrat?" onClose={onClose}>
        {santiere.length === 0 ? (
          <div className="gol-msg">Nu ești pe niciun șantier activ. Vorbește cu șeful.</div>
        ) : (
          santiere.map((s) => (
            <button key={s.id} className="btn btn-mare"
              onClick={() => { setSantierId(s.id); setPas(2); }}>
              🏗 {s.nume}
            </button>
          ))
        )}
      </Foaie>
    );

  /* pasul 2 — ce */
  if (pas === 2)
    return (
      <Foaie titlu="Ce ai folosit?" onClose={onClose}>
        <div className="sub" style={{ marginBottom: 10 }}>
          Pe {santier?.nume}
          {santiere.length > 1 && (
            <button className="btn btn-mic" style={{ marginLeft: 8 }} onClick={() => setPas(1)}>schimbă</button>
          )}
        </div>
        <input className="cautare" placeholder="Caută materialul…" value={cauta}
          onChange={(e) => setCauta(e.target.value)} />
        {lista.length === 0 ? (
          <div className="gol-msg">Nu găsesc materialul. Cere-i șefului să-l adauge în stoc.</div>
        ) : (
          lista.map((m) => (
            <button key={m.id} className="btn btn-mare"
              onClick={() => { setMat(m); setCant(1); setPas(3); }}>
              <span>📦 {m.nume}</span>
              <span className="bm-stoc">{m.cant} {m.unitate}</span>
            </button>
          ))
        )}
      </Foaie>
    );

  /* pasul 3 — cât */
  const ramane = Number(mat.cant) - cant;
  return (
    <Foaie titlu={mat.nume} onClose={onClose}>
      <div className="sub" style={{ marginBottom: 14 }}>
        Pe {santier?.nume} · în depozit: <b className="mono">{mat.cant} {mat.unitate}</b>
      </div>

      <div className="stepper">
        <button onClick={() => setCant(Math.max(0.5, +(cant - 1).toFixed(2)))}>−</button>
        <div>
          <div className="st-nr mono">{cant}</div>
          <div className="st-um">{mat.unitate}</div>
        </div>
        <button onClick={() => setCant(+(cant + 1).toFixed(2))}>+</button>
      </div>

      <div className="actiuni" style={{ justifyContent: "center", marginBottom: 14 }}>
        {[5, 10, 20, 50].map((n) => (
          <button key={n} className="btn btn-mic" onClick={() => setCant(n)}>{n}</button>
        ))}
      </div>

      {ramane < 0 && (
        <div className="conflict"><b>⚠ În depozit sunt doar {mat.cant} {mat.unitate}</b>
          <div className="cf-sfat">Poți nota oricum — stocul ajunge la 0 și șeful vede că nu se potrivește.</div>
        </div>
      )}

      <button className="btn btn-galben" onClick={trimite}>
        Am folosit {cant} {mat.unitate}
      </button>
      <button className="btn btn-mic" style={{ width: "100%", marginTop: 9 }} onClick={() => setPas(2)}>
        ← Alt material
      </button>
    </Foaie>
  );
}

function Invitatii({ db, onSeteazaPin }) {
  const [link, setLink] = useState("");
  const [copiat, setCopiat] = useState("");

  /* încerc să iau linkul curent; dacă aplicația rulează într-un cadru, îl completează el */
  useEffect(() => {
    try {
      const l = window.location?.href || "";
      if (l && !l.startsWith("about:")) setLink(l);
    } catch (e) {}
  }, []);

  const codNou = () => String(Math.floor(1000 + Math.random() * 9000));

  const mesaj = (a, cod) =>
    `Salut ${a.nume.split(" ")[0]},\n\n` +
    `Am pus la punct o aplicație pentru șantiere — de acolo vezi unde lucrezi în fiecare zi, ` +
    `orele tale și ce e de rezolvat. Tot de acolo îmi scrii dacă lipsește ceva sau s-a stricat ceva.\n\n` +
    `1. Deschide linkul: ${link || "[pune aici linkul aplicației]"}\n` +
    `2. Alege limba\n` +
    `3. Apasă „Intru ca Muncitor" și caută-te în listă: ${a.nume}\n` +
    (cod
      ? `4. Parola ta: ${cod}\n\nPoți s-o schimbi când vrei — cere-mi mie.`
      : `4. Îți alegi singur o parolă (minim 4 cifre). Ține-o minte, e a ta.`);

  const copiaza = async (text, id) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiat(id);
      setTimeout(() => setCopiat(""), 2500);
    } catch (e) {
      /* dacă browserul refuză, las textul selectabil în pagină */
      setCopiat("manual-" + id);
    }
  };

  const daCod = (a) => {
    const cod = codNou();
    onSeteazaPin(a.id, cod);
    copiaza(mesaj(a, cod), a.id);
  };

  return (
    <>
      <div className="card">
        <div className="titlu">Cum ajung oamenii în aplicație</div>
        <div className="sub">
          Nu există conturi pe server, deci „invitația" e linkul aplicației. Cine îl are, intră.
          Fiecare își găsește numele în listă și își pune o parolă — sau îi dai tu una de la început.
        </div>
      </div>

      <div className="camp">
        <label>Linkul aplicației</label>
        <input value={link} onChange={(e) => setLink(e.target.value)}
          placeholder="Lipește aici linkul după ce publici aplicația" />
        <div className="sub" style={{ marginTop: 6 }}>
          Îl iei din butonul de partajare, după ce publici. Se pune automat în fiecare mesaj de mai jos.
        </div>
      </div>

      <div className="sectiune">Mesaj pentru fiecare om</div>
      {db.angajati.length === 0 ? (
        <div className="gol-msg">Niciun angajat. Adaugă-i întâi la Oameni și echipe.</div>
      ) : (
        db.angajati.map((a) => (
          <div className="card" key={a.id}>
            <div className="card-rand">
              <div>
                <div className="titlu">{a.nume}</div>
                <div className="sub">
                  {a.grad || "—"}
                  {a.telefon && <> · <span className="mono">{a.telefon}</span></>}
                </div>
              </div>
              <span className={"chip " + (a.pin ? "ok" : "gri")}>
                {a.pin ? "Are parolă" : "Fără parolă"}
              </span>
            </div>

            {copiat === a.id && (
              <div className="sub" style={{ color: "var(--verde)", marginTop: 8 }}>
                ✓ Mesaj copiat — lipește-l în WhatsApp.
              </div>
            )}
            {copiat === "manual-" + a.id && (
              <textarea readOnly rows={7} value={mesaj(a, null)}
                style={{ width: "100%", marginTop: 9, background: "var(--asfalt)", color: "var(--text)",
                  border: "1px solid var(--linie)", borderRadius: 9, padding: 10, fontSize: 13,
                  fontFamily: "'Archivo',sans-serif" }} />
            )}

            <div className="actiuni">
              <button className="btn btn-mic principal" onClick={() => copiaza(mesaj(a, null), a.id)}>
                Copiază mesajul
              </button>
              <button className="btn btn-mic" onClick={() => daCod(a)}>
                Dă-i o parolă și copiază
              </button>
              {a.telefon && (
                <a className="btn btn-mic" style={{ textDecoration: "none", display: "inline-block" }}
                  href={`https://wa.me/${a.telefon.replace(/[^0-9]/g, "").replace(/^0/, "33")}?text=${encodeURIComponent(mesaj(a, null))}`}
                  target="_blank" rel="noreferrer">
                  WhatsApp
                </a>
              )}
            </div>
          </div>
        ))
      )}

      <div className="card" style={{ borderColor: "var(--galben)", marginTop: 6 }}>
        <div className="titlu" style={{ color: "var(--galben)" }}>De reținut</div>
        <div className="sub">
          Oricine primește linkul poate intra și își poate alege orice nume din listă dacă omul acela
          n-a apucat încă să-și pună parola. Când pleacă cineva din firmă, șterge-l din Oameni —
          altfel linkul rămâne bun la el.
          <br /><br />
          Parolele sunt ca să nu se încurce oamenii între ei, nu ca protecție serioasă.
          Pentru conturi adevărate, cu invitații care expiră, ar trebui un server în spate.
        </div>
      </div>
    </>
  );
}

function Confirmare({ intrebare, onInchide }) {
  if (!intrebare) return null;
  return (
    <>
      <div className="voal" style={{ zIndex: 60 }} onClick={() => { intrebare.onNu?.(); onInchide(); }} />
      <div className="foaie" style={{ zIndex: 61 }} role="alertdialog">
        <div className="sub" style={{ fontSize: 15, color: "var(--text)", lineHeight: 1.55, marginBottom: 18 }}>
          {intrebare.mesaj}
        </div>
        <button className="btn btn-galben"
          onClick={() => { intrebare.onDa?.(); onInchide(); }}>
          {intrebare.eticheta || "Da, continuă"}
        </button>
        <button className="btn btn-mic" style={{ width: "100%", marginTop: 9 }}
          onClick={() => { intrebare.onNu?.(); onInchide(); }}>
          Anulează
        </button>
      </div>
    </>
  );
}

function EcranIntrare({ db, onIntra, onSeteazaPin }) {
  const [mod, setMod] = useState(null); // 'admin' | 'muncitor'
  const [pin, setPin] = useState("");
  const [eroare, setEroare] = useState("");
  const [angajatId, setAngajatId] = useState("");
  const ales = db.angajati.find((a) => a.id === angajatId);

  return (
    <div className="intrare">
      <h1>Șantier <span>Manager</span></h1>
      <div className="hazard" />
      {!mod && (
        <>
          <button className="btn btn-galben" onClick={() => setMod("admin")}>{t("🔑 Intru ca Admin")}</button>
          <button className="btn btn-mic" style={{ padding: "13px" }} onClick={() => setMod("muncitor")}>{t("👷 Intru ca Muncitor")}</button>

        </>
      )}
      {mod === "admin" && (
        <>
          <div className="camp">
            <label>{t("PIN admin")} {db.setari.pin === PIN_IMPLICIT && "(implicit: 1234 — schimbă-l din Panou)"}</label>
            <input type="password" inputMode="numeric" value={pin} onChange={(e) => { setPin(e.target.value); setEroare(""); }} placeholder="••••" />
          </div>
          {eroare && <div style={{ color: "var(--rosu)", fontSize: 13 }}>{eroare}</div>}
          <button className="btn btn-galben" onClick={() => pin === db.setari.pin ? onIntra({ rol: "admin" }) : setEroare(t("PIN greșit."))}>
            {t("Intră")}
          </button>
          <button className="btn btn-mic" onClick={() => { setMod(null); setEroare(""); }}>{t("← Înapoi")}</button>
        </>
      )}
      {mod === "muncitor" && (
        <>
          {db.angajati.length === 0 ? (
            <div className="gol-msg">{t("Adminul trebuie mai întâi să te adauge la Oameni → Angajați.")}</div>
          ) : (
            <>
              <div className="camp">
                <label>{t("Cine ești?")}</label>
                <select value={angajatId} onChange={(e) => { setAngajatId(e.target.value); setPin(""); setEroare(""); }}>
                  <option value="">{t("— alege numele tău —")}</option>
                  {db.angajati.map((a) => <option key={a.id} value={a.id}>{a.nume}</option>)}
                </select>
              </div>
              {angajatId && (
                <div className="camp">
                  <label>{t(ales?.pin ? "Parola ta" : "Alege-ți o parolă (minim 4 cifre)")}</label>
                  <input type="password" inputMode="numeric" value={pin}
                    onChange={(e) => { setPin(e.target.value); setEroare(""); }} placeholder="••••" />
                  {!ales?.pin && <div className="sub" style={{ marginTop: 6 }}>{t("E prima ta intrare — parola pe care o scrii acum rămâne a ta.")}</div>}
                </div>
              )}
              {eroare && <div style={{ color: "var(--rosu)", fontSize: 13 }}>{eroare}</div>}
              <button className="btn btn-galben" disabled={!angajatId}
                onClick={() => {
                  if (!ales) return;
                  if (ales.pin) {
                    if (pin === ales.pin) onIntra({ rol: "muncitor", angajatId });
                    else setEroare(t("Parolă greșită. Dacă ai uitat-o, cere-i șefului să ți-o reseteze."));
                  } else {
                    if (pin.length < 4) return setEroare(t("Parola trebuie să aibă minim 4 caractere."));
                    onSeteazaPin(angajatId, pin);
                    onIntra({ rol: "muncitor", angajatId });
                  }
                }}>
                {t("Intră")}
              </button>
            </>
          )}
          <button className="btn btn-mic" onClick={() => { setMod(null); setPin(""); setEroare(""); }}>{t("← Înapoi")}</button>
        </>
      )}
    </div>
  );
}

/* ==================== FORMULARE ==================== */
function FormMaterial({ item, onSalveaza, onClose }) {
  const [f, setF] = useState(item || { nume: "", categorie: "", cant: "", unitate: "buc", minim: "", pret: "", locatie: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Foaie titlu={item ? "Modifică material" : "Material nou"} onClose={onClose}>
      <div className="camp"><label>Denumire *</label>
        <input value={f.nume} onChange={set("nume")} placeholder="ex. Ciment CEM II 42,5" /></div>
      <div className="rand2">
        <div className="camp"><label>Cantitate *</label>
          <input type="number" value={f.cant} onChange={set("cant")} placeholder="0" /></div>
        <div className="camp"><label>Unitate</label>
          <select value={f.unitate} onChange={set("unitate")}>
            {["buc", "saci", "kg", "t", "m", "m²", "m³", "l", "palet", "rolă", "cutie"].map((u) => <option key={u}>{u}</option>)}
          </select></div>
      </div>
      <div className="rand2">
        <div className="camp"><label>Preț / unitate (€)</label>
          <input type="number" step="0.01" value={f.pret} onChange={set("pret")} placeholder="ex. 8.50" /></div>
        <div className="camp"><label>Prag minim (alertă)</label>
          <input type="number" value={f.minim} onChange={set("minim")} placeholder="ex. 10" /></div>
      </div>
      <div className="rand2">
        <div className="camp"><label>Categorie</label>
          <input value={f.categorie} onChange={set("categorie")} placeholder="ex. Zidărie" /></div>
        <div className="camp"><label>Locație</label>
          <input value={f.locatie} onChange={set("locatie")} placeholder="ex. Depozit" /></div>
      </div>
      <button className="btn btn-galben" onClick={() => f.nume.trim() && onSalveaza({ ...f, cant: Number(f.cant) || 0, pret: Number(f.pret) || 0 })}>
        Salvează
      </button>
    </Foaie>
  );
}

function FormScula({ item, onSalveaza, onClose }) {
  const [f, setF] = useState(item || { nume: "", cod: "", pret: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Foaie titlu={item ? "Modifică sculă" : "Sculă nouă"} onClose={onClose}>
      <div className="camp"><label>Denumire *</label>
        <input value={f.nume} onChange={set("nume")} placeholder="ex. Flex Makita 230mm" /></div>
      <div className="rand2">
        <div className="camp"><label>Cod / serie</label>
          <input value={f.cod} onChange={set("cod")} placeholder="ex. SC-014" /></div>
        <div className="camp"><label>Preț achiziție (€)</label>
          <input type="number" step="0.01" value={f.pret} onChange={set("pret")} placeholder="ex. 220" /></div>
      </div>
      <button className="btn btn-galben" onClick={() => f.nume.trim() && onSalveaza({ ...f, pret: Number(f.pret) || 0 })}>Salvează</button>
    </Foaie>
  );
}

function FormEchipa({ item, onSalveaza, onClose }) {
  const [f, setF] = useState(item || { nume: "", santier: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Foaie titlu={item ? "Modifică echipă" : "Echipă nouă"} onClose={onClose}>
      <div className="camp"><label>Nume echipă *</label>
        <input value={f.nume} onChange={set("nume")} placeholder="ex. Echipa 1 — Zidărie" /></div>
      <div className="camp"><label>Șantier</label>
        <input value={f.santier} onChange={set("santier")} placeholder="ex. Casa Beaucouzé" /></div>
      <button className="btn btn-galben" onClick={() => f.nume.trim() && onSalveaza(f)}>Salvează</button>
    </Foaie>
  );
}

function FormAngajat({ item, echipe, onSalveaza, onClose }) {
  const [f, setF] = useState(item || { nume: "", telefon: "", grad: "Muncitor", echipaId: "", dataAngajare: "", tarifOra: "", tarif: "", note: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Foaie titlu={item ? "Modifică angajat" : "Angajat nou"} onClose={onClose}>
      <div className="camp"><label>Nume complet *</label>
        <input value={f.nume} onChange={set("nume")} placeholder="ex. Ionuț Popescu" /></div>
      <div className="rand2">
        <div className="camp"><label>Grad / funcție</label>
          <select value={f.grad} onChange={set("grad")}>
            {GRADE.map((g) => <option key={g}>{g}</option>)}
          </select></div>
        <div className="camp"><label>Echipă</label>
          <select value={f.echipaId || ""} onChange={set("echipaId")}>
            <option value="">Fără echipă</option>
            {echipe.map((e) => <option key={e.id} value={e.id}>{e.nume}</option>)}
          </select></div>
      </div>
      <div className="rand2">
        <div className="camp"><label>Telefon</label>
          <input value={f.telefon} onChange={set("telefon")} placeholder="06…" /></div>
        <div className="camp"><label>Data angajării</label>
          <input type="date" value={f.dataAngajare} onChange={set("dataAngajare")} /></div>
      </div>
      <div className="rand2">
        <div className="camp"><label>Cost orar (€/h) *pentru calcul</label>
          <input type="number" step="0.5" value={f.tarifOra} onChange={set("tarifOra")} placeholder="ex. 22" /></div>
        <div className="camp"><label>Salariu / detalii plată</label>
          <input value={f.tarif} onChange={set("tarif")} placeholder="ex. 2400 €/lună net" /></div>
      </div>
      <label className="rand-bifa" style={{ marginBottom: 11 }}>
        <input type="checkbox" checked={f.poateStoc ?? f.grad === "Șef de echipă"}
          onChange={(e) => setF({ ...f, poateStoc: e.target.checked })} />
        <span>Poate scădea materiale din stoc
          <span className="rb-sub">Notează de pe telefonul lui ce s-a consumat pe șantier</span>
        </span>
      </label>

      <div className="camp"><label>Note (calificări, permis, observații)</label>
        <textarea rows={2} value={f.note} onChange={set("note")} placeholder="ex. Permis C, CACES nacelă, bun pe finisaje" /></div>
      <button className="btn btn-galben"
        onClick={() => f.nume.trim() && onSalveaza({ ...f, poateStoc: f.poateStoc ?? f.grad === "Șef de echipă" })}>
        Salvează
      </button>
    </Foaie>
  );
}

function FisaAngajat({ angajat, echipe, numeEchipa, pontaj, santiere, onEdit, onMuta, onSterge, onParola, onClose }) {
  if (!angajat) return null;
  const aleLui = pontaj.filter((p) => p.angajatId === angajat.id);
  const peSantier = {};
  aleLui.forEach((p) => {
    const nume = santiere.find((s) => s.id === p.santierId)?.nume || "Șantier șters";
    if (!peSantier[nume]) peSantier[nume] = { ore: 0, cost: 0 };
    peSantier[nume].ore += Number(p.ore) || 0;
    peSantier[nume].cost += (Number(p.ore) || 0) * (Number(p.tarifOra) || 0);
  });
  const totalOre = aleLui.reduce((s, p) => s + (Number(p.ore) || 0), 0);
  const totalCost = aleLui.reduce((s, p) => s + (Number(p.ore) || 0) * (Number(p.tarifOra) || 0), 0);
  return (
    <Foaie titlu={`Fișă: ${angajat.nume}`} onClose={onClose}>
      <div className="fisa-rand"><span className="k">Grad</span><b>{angajat.grad || "—"}</b></div>
      <div className="fisa-rand"><span className="k">Echipă</span><b>{numeEchipa(angajat.echipaId)}</b></div>
      <div className="fisa-rand"><span className="k">Telefon</span><b className="mono">{angajat.telefon || "—"}</b></div>
      <div className="fisa-rand"><span className="k">Angajat din</span><b>{dataRo(angajat.dataAngajare)}</b></div>
      <div className="fisa-rand"><span className="k">Cost orar</span><b>{angajat.tarifOra ? bani(angajat.tarifOra) + "/h" : "—"}</b></div>
      <div className="fisa-rand"><span className="k">Plată</span><b>{angajat.tarif || "—"}</b></div>
      <div className="fisa-rand">
        <span className="k">Poate scădea din stoc</span>
        <b style={{ color: angajat.poateStoc ? "var(--verde)" : "var(--mut)" }}>{angajat.poateStoc ? "Da" : "Nu"}</b>
      </div>
      <div className="fisa-rand"><span className="k">Cont aplicație</span><b style={{ color: angajat.pin ? "var(--verde)" : "var(--mut)" }}>{angajat.pin ? "Parolă setată" : "Fără parolă"}</b></div>
      <div className="fisa-rand"><span className="k">Total pontat</span><b className="mono">{totalOre}h · {bani(totalCost)}</b></div>
      {Object.keys(peSantier).length > 0 && (
        <div className="lista-in-card">
          {Object.entries(peSantier).map(([nume, v]) => (
            <div key={nume}>🏗 {nume} · <b className="mono">{v.ore}h</b> · {bani(v.cost)}</div>
          ))}
        </div>
      )}
      {(() => {
        const peTip = {};
        aleLui.forEach((p) => {
          const t = p.tipMunca || santiere.find((s) => s.id === p.santierId)?.domeniu || "Diverse";
          peTip[t] = (peTip[t] || 0) + (Number(p.ore) || 0);
        });
        const lista = Object.entries(peTip).sort((a, b) => b[1] - a[1]);
        if (lista.length === 0) return null;
        return (
          <>
            <div className="sectiune">Ce a lucrat</div>
            {lista.map(([t, ore]) => (
              <div className="fisa-rand" key={t}>
                <span>{t}</span>
                <b className="mono">{ore}h · {Math.round((ore / totalOre) * 100)}%</b>
              </div>
            ))}
          </>
        );
      })()}
      {angajat.note && <div className="sub" style={{ margin: "10px 0" }}>{angajat.note}</div>}
      <div className="camp" style={{ marginTop: 14 }}>
        <label>Mută rapid în altă echipă</label>
        <select value={angajat.echipaId || ""} onChange={(e) => onMuta(e.target.value || null)}>
          <option value="">Fără echipă</option>
          {echipe.map((e) => <option key={e.id} value={e.id}>{e.nume}</option>)}
        </select>
      </div>
      <div className="actiuni">
        <button className="btn btn-mic principal" onClick={onEdit}>Modifică fișa</button>
        <button className="btn btn-mic" onClick={onParola}>{angajat.pin ? "Resetează parola" : "Setează parola"}</button>
        <button className="btn btn-mic pericol" onClick={onSterge}>Șterge angajatul</button>
      </div>
    </Foaie>
  );
}

function FormCamion({ item, onSalveaza, onClose }) {
  const [f, setF] = useState(item || { nume: "", numar: "", km: "", itp: "", asigurare: "", revizie: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Foaie titlu={item ? "Modifică vehicul" : "Vehicul nou"} onClose={onClose}>
      <div className="camp"><label>Denumire *</label>
        <input value={f.nume} onChange={set("nume")} placeholder="ex. Iveco Daily basculabil" /></div>
      <div className="rand2">
        <div className="camp"><label>Număr înmatriculare</label>
          <input value={f.numar} onChange={set("numar")} placeholder="ex. GA-123-BC" /></div>
        <div className="camp"><label>Kilometraj</label>
          <input type="number" value={f.km} onChange={set("km")} placeholder="ex. 184000" /></div>
      </div>
      <div className="camp"><label>ITP / Contrôle technique valabil până la</label>
        <input type="date" value={f.itp} onChange={set("itp")} /></div>
      <div className="rand2">
        <div className="camp"><label>Asigurare până la</label>
          <input type="date" value={f.asigurare} onChange={set("asigurare")} /></div>
        <div className="camp"><label>Următoarea revizie</label>
          <input type="date" value={f.revizie} onChange={set("revizie")} /></div>
      </div>
      <button className="btn btn-galben" onClick={() => f.nume.trim() && onSalveaza(f)}>Salvează</button>
    </Foaie>
  );
}

function FormIntretinere({ camion, onSalveaza, onClose }) {
  const [f, setF] = useState({ data: azi(), tip: "", cost: "", km: "", note: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Foaie titlu={`Întreținere: ${camion.nume}`} onClose={onClose}>
      <div className="camp"><label>Ce s-a făcut *</label>
        <input value={f.tip} onChange={set("tip")} placeholder="ex. Schimb ulei + filtre, plăcuțe frână" /></div>
      <div className="rand2">
        <div className="camp"><label>Cost (€)</label>
          <input type="number" step="0.01" value={f.cost} onChange={set("cost")} placeholder="ex. 320" /></div>
        <div className="camp"><label>Km la intervenție</label>
          <input type="number" value={f.km} onChange={set("km")} placeholder="ex. 185200" /></div>
      </div>
      <div className="camp"><label>Note</label>
        <textarea rows={2} value={f.note} onChange={set("note")} placeholder="ex. Garaj Renault Angers, garanție 1 an" /></div>
      <button className="btn btn-galben" onClick={() => f.tip.trim() && onSalveaza(f)}>Salvează</button>
    </Foaie>
  );
}

function FormCerere({ eu, onTrimite, onClose }) {
  const [f, setF] = useState({ tip: "problema", text: "" });
  return (
    <Foaie titlu="Raportează" onClose={onClose}>
      <div className="subtab">
        <button className={f.tip === "problema" ? "activ" : ""} onClick={() => setF({ ...f, tip: "problema" })}>⚠ Problemă</button>
        <button className={f.tip === "necesar" ? "activ" : ""} onClick={() => setF({ ...f, tip: "necesar" })}>📦 Am nevoie de…</button>
      </div>
      <div className="camp">
        <label>{f.tip === "problema" ? "Ce s-a întâmplat?" : "Ce vă lipsește pe șantier?"}</label>
        <textarea rows={4} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })}
          placeholder={f.tip === "problema" ? "ex. S-a stricat flexul mare, nu mai pornește" : "ex. Ne trebuie 20 saci ciment și discuri de 230"} />
      </div>
      <div className="sub" style={{ marginBottom: 12 }}>Mesajul ajunge doar la admin.</div>
      <button className="btn btn-galben" disabled={!f.text.trim()}
        onClick={() => f.text.trim() && onTrimite({ tip: f.tip, text: f.text.trim(), autorId: eu?.id || null, autorNume: eu?.nume || "Necunoscut" })}>
        Trimite
      </button>
    </Foaie>
  );
}

function FormSantier({ item, onSalveaza, onClose }) {
  const [f, setF] = useState(
    item || { nume: "", client: "", adresa: "", dataStart: "", status: "activ",
      domeniu: DOMENII[0], valoare: "", orePrev: "", materialePrev: [] }
  );
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const prev = f.materialePrev || [];
  const setRand = (i, k, v) => {
    const l = [...prev]; l[i] = { ...l[i], [k]: v }; setF({ ...f, materialePrev: l });
  };
  const adaugaRand = () => setF({ ...f, materialePrev: [...prev, { nume: "", cant: "", unitate: "buc", pret: "" }] });
  const scoateRand = (i) => setF({ ...f, materialePrev: prev.filter((_, j) => j !== i) });
  const totalPrev = prev.reduce((s, m) => s + (Number(m.cant) || 0) * (Number(m.pret) || 0), 0);

  return (
    <Foaie titlu={item ? "Modifică șantier" : "Șantier nou"} onClose={onClose}>
      <div className="camp"><label>Denumire *</label>
        <input value={f.nume} onChange={set("nume")} placeholder="ex. Casă P+1 Beaucouzé" /></div>
      <div className="rand2">
        <div className="camp"><label>Client / beneficiar</label>
          <input value={f.client} onChange={set("client")} placeholder="ex. Fam. Martin" /></div>
        <div className="camp"><label>Tip de lucrare</label>
          <select value={f.domeniu || DOMENII[0]} onChange={set("domeniu")}>
            {DOMENII.map((d) => <option key={d}>{d}</option>)}
          </select></div>
      </div>
      <div className="rand2">
        <div className="camp"><label>Adresă / localitate</label>
          <input value={f.adresa} onChange={set("adresa")} placeholder="ex. Beaucouzé" /></div>
        <div className="camp"><label>Data începerii</label>
          <input type="date" value={f.dataStart} onChange={set("dataStart")} /></div>
      </div>

      <div className="sectiune">Devizul — ce ai prevăzut</div>
      <div className="rand2">
        <div className="camp"><label>La cât ai cifrat lucrarea (€)</label>
          <input type="number" step="0.01" value={f.valoare} onChange={set("valoare")} placeholder="ex. 18500" /></div>
        <div className="camp"><label>Ore prevăzute</label>
          <input type="number" value={f.orePrev} onChange={set("orePrev")} placeholder="ex. 320" /></div>
      </div>

      <div className="camp">
        <label>Materiale prevăzute {totalPrev > 0 && <span style={{ color: "var(--galben)" }}>· total {bani(totalPrev)}</span>}</label>
        {prev.map((m, i) => (
          <div key={i} className="rand-prev">
            <input value={m.nume} onChange={(e) => setRand(i, "nume", e.target.value)} placeholder="Material" />
            <input type="number" value={m.cant} onChange={(e) => setRand(i, "cant", e.target.value)} placeholder="Cant." />
            <input value={m.unitate} onChange={(e) => setRand(i, "unitate", e.target.value)} placeholder="u.m." />
            <input type="number" step="0.01" value={m.pret} onChange={(e) => setRand(i, "pret", e.target.value)} placeholder="€/u" />
            <button className="btn btn-mic pericol" onClick={() => scoateRand(i)}>✕</button>
          </div>
        ))}
        <button className="btn btn-mic" style={{ marginTop: 8 }} onClick={adaugaRand}>+ Adaugă linie</button>
      </div>

      <button className="btn btn-galben" style={{ marginTop: 8 }}
        onClick={() => f.nume.trim() && onSalveaza({ ...f, valoare: Number(f.valoare) || 0, orePrev: Number(f.orePrev) || 0 })}>
        Salvează
      </button>
    </Foaie>
  );
}

function FormConsum({ santier, materiale, onSalveaza, onClose }) {
  const [f, setF] = useState({ materialId: "", nume: "", cant: "", unitate: "buc", pret: "", data: aziISO(), scadeDinStoc: true });
  const mat = materiale.find((m) => m.id === f.materialId);
  const alegeMaterial = (id) => {
    const m = materiale.find((x) => x.id === id);
    setF({ ...f, materialId: id, pret: m ? m.pret : f.pret, unitate: m ? m.unitate : f.unitate });
  };
  const total = (Number(f.cant) || 0) * (Number(f.pret) || 0);
  const valid = (f.materialId || f.nume.trim()) && Number(f.cant) > 0;
  return (
    <Foaie titlu={`Material folosit: ${santier.nume}`} onClose={onClose}>
      <div className="camp">
        <label>Din inventar</label>
        <select value={f.materialId} onChange={(e) => alegeMaterial(e.target.value)}>
          <option value="">— altul, îl scriu eu —</option>
          {materiale.map((m) => (
            <option key={m.id} value={m.id}>{m.nume} (stoc {m.cant} {m.unitate})</option>
          ))}
        </select>
      </div>
      {!f.materialId && (
        <div className="rand2">
          <div className="camp"><label>Denumire *</label>
            <input value={f.nume} onChange={(e) => setF({ ...f, nume: e.target.value })} placeholder="ex. Beton C25/30" /></div>
          <div className="camp"><label>Unitate</label>
            <input value={f.unitate} onChange={(e) => setF({ ...f, unitate: e.target.value })} placeholder="m³" /></div>
        </div>
      )}
      <div className="rand2">
        <div className="camp"><label>Cantitate * {mat && <span style={{ color: "var(--mut)" }}>({mat.unitate})</span>}</label>
          <input type="number" step="0.01" value={f.cant} onChange={(e) => setF({ ...f, cant: e.target.value })} placeholder="0" /></div>
        <div className="camp"><label>Preț / unitate (€)</label>
          <input type="number" step="0.01" value={f.pret} onChange={(e) => setF({ ...f, pret: e.target.value })} placeholder="0" /></div>
      </div>
      <div className="camp"><label>Data</label>
        <input type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} /></div>
      {mat && (
        <label style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, fontSize: 14 }}>
          <input type="checkbox" checked={f.scadeDinStoc} onChange={(e) => setF({ ...f, scadeDinStoc: e.target.checked })}
            style={{ width: 19, height: 19, accentColor: "var(--galben)" }} />
          Scade din stocul din depozit
        </label>
      )}
      {total > 0 && <div className="sub" style={{ marginBottom: 12 }}>Valoare: <b style={{ color: "var(--galben)" }}>{bani(total)}</b></div>}
      {mat && f.scadeDinStoc && Number(f.cant) > Number(mat.cant) && (
        <div className="sub" style={{ color: "var(--rosu)", marginBottom: 10 }}>
          ⚠ Ceri mai mult decât ai în stoc ({mat.cant} {mat.unitate}). Stocul va ajunge la 0.
        </div>
      )}
      <button className="btn btn-galben" disabled={!valid} onClick={() => valid && onSalveaza(f)}>Salvează consumul</button>
    </Foaie>
  );
}

function FormPontaj({ santier, angajati, echipe, onSalveaza, onClose }) {
  const [data, setData] = useState(aziISO());
  const [ore, setOre] = useState("8");
  const [tip, setTip] = useState(santier.domeniu || DOMENII[0]);
  const [separat, setSeparat] = useState(false);
  const [tipuri, setTipuri] = useState({}); // pe om, când fac lucruri diferite
  const [sel, setSel] = useState({});
  const comuta = (id) => setSel({ ...sel, [id]: !sel[id] });
  const bifeazaEchipa = (eid) => {
    const nou = { ...sel };
    angajati.filter((a) => a.echipaId === eid).forEach((a) => (nou[a.id] = true));
    setSel(nou);
  };
  const alesi = angajati.filter((a) => sel[a.id]);
  const faraTarif = alesi.filter((a) => !Number(a.tarifOra));
  const tipulLui = (id) => (separat ? tipuri[id] || tip : tip);

  return (
    <Foaie titlu={`Pontaj: ${santier.nume}`} onClose={onClose}>
      <div className="rand2">
        <div className="camp"><label>Data</label>
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} /></div>
        <div className="camp"><label>Ore lucrate (fiecare)</label>
          <input type="number" step="0.5" value={ore} onChange={(e) => setOre(e.target.value)} /></div>
      </div>

      <div className="camp">
        <label>Ce fel de muncă {separat && <span style={{ color: "var(--mut)" }}>(pentru toți, dacă nu schimbi mai jos)</span>}</label>
        <select value={tip} onChange={(e) => setTip(e.target.value)}>
          {DOMENII.map((d) => <option key={d}>{d}</option>)}
        </select>
      </div>
      <label className="rand-bifa" style={{ borderBottom: "none", paddingTop: 0 }}>
        <input type="checkbox" checked={separat} onChange={(e) => setSeparat(e.target.checked)} />
        <span>Au făcut lucruri diferite<span className="rb-sub">Alegi separat pentru fiecare om</span></span>
      </label>

      {echipe.length > 0 && (
        <div className="actiuni" style={{ marginTop: 4, marginBottom: 11 }}>
          {echipe.map((e) => (
            <button key={e.id} className="btn btn-mic" onClick={() => bifeazaEchipa(e.id)}>
              + Toată {e.nume}
            </button>
          ))}
        </div>
      )}

      <div className="camp"><label>Cine a lucrat</label>
        {angajati.map((a) => (
          <div key={a.id} style={{ borderBottom: "1px dashed var(--linie)", padding: "8px 2px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14.5, fontWeight: 500 }}>
              <input type="checkbox" checked={!!sel[a.id]} onChange={() => comuta(a.id)}
                style={{ width: 19, height: 19, accentColor: "var(--galben)", flex: "none" }} />
              {a.nume}
              <span style={{ color: "var(--mut)", fontSize: 12, marginLeft: "auto" }}>
                {Number(a.tarifOra) ? bani(a.tarifOra) + "/h" : "fără cost orar"}
              </span>
            </label>
            {separat && sel[a.id] && (
              <select value={tipuri[a.id] || tip} onChange={(e) => setTipuri({ ...tipuri, [a.id]: e.target.value })}
                style={{ marginTop: 7, padding: "7px 9px", fontSize: 13 }}>
                {DOMENII.map((d) => <option key={d}>{d}</option>)}
              </select>
            )}
          </div>
        ))}
      </div>

      {faraTarif.length > 0 && (
        <div className="sub" style={{ color: "var(--rosu)", marginBottom: 10 }}>
          ⚠ {faraTarif.map((a) => a.nume).join(", ")} nu are cost orar setat — orele se pontează, dar costul iese 0. Completează-l din fișă.
        </div>
      )}
      <button className="btn btn-galben" disabled={alesi.length === 0 || !Number(ore)}
        onClick={() => alesi.length && Number(ore) &&
          onSalveaza(data, alesi.map((a) => ({
            angajatId: a.id, nume: a.nume, ore, tarifOra: a.tarifOra, tipMunca: tipulLui(a.id),
          })))}>
        Pontează {alesi.length > 0 ? `${alesi.length} × ${ore}h` : ""}
      </button>
    </Foaie>
  );
}

function DetaliiSantier({ santier, pontaj, consum, bilant, matPrev, onStergePontaj, onStergeConsum, onClose }) {
  if (!santier) return null;
  const peOm = {};
  pontaj.forEach((p) => {
    if (!peOm[p.nume]) peOm[p.nume] = { ore: 0, cost: 0, zile: new Set() };
    peOm[p.nume].ore += Number(p.ore) || 0;
    peOm[p.nume].cost += (Number(p.ore) || 0) * (Number(p.tarifOra) || 0);
    peOm[p.nume].zile.add(p.data);
  });
  const totalOre = pontaj.reduce((s, p) => s + (Number(p.ore) || 0), 0);
  const totalCost = pontaj.reduce((s, p) => s + (Number(p.ore) || 0) * (Number(p.tarifOra) || 0), 0);
  const orePrev = Number(santier.orePrev) || 0;
  const prev = santier.materialePrev || [];
  /* grupez consumul pe denumire ca să pot compara cu devizul */
  const consumPeNume = {};
  consum.forEach((c) => {
    const k = (c.nume || "").trim().toLowerCase();
    if (!consumPeNume[k]) consumPeNume[k] = { nume: c.nume, cant: 0, unitate: c.unitate, valoare: 0 };
    consumPeNume[k].cant += Number(c.cant) || 0;
    consumPeNume[k].valoare += (Number(c.cant) || 0) * (Number(c.pret) || 0);
  });

  return (
    <Foaie titlu={`Detalii: ${santier.nume}`} onClose={onClose}>
      <div className="fisa-rand"><span className="k">Cifrat</span><b className="mono">{bani(bilant.incasat)}</b></div>
      <div className="fisa-rand"><span className="k">Manoperă</span><b className="mono">−{bani(bilant.manopera)}</b></div>
      <div className="fisa-rand"><span className="k">Materiale</span><b className="mono">−{bani(bilant.materiale)}</b></div>
      <div className="fisa-rand" style={{ borderBottom: "none", paddingTop: 12 }}>
        <span className="k"><b>Marjă</b></span>
        <b className="mono" style={{ fontSize: 17, color: bilant.marja >= 0 ? "var(--verde)" : "var(--rosu)" }}>
          {bani(bilant.marja)}{bilant.procent !== null && ` · ${bilant.procent}%`}
        </b>
      </div>

      <div className="sectiune">Prevăzut vs realizat</div>
      <div className="fisa-rand">
        <span className="k">Ore</span>
        <b className="mono">{totalOre}h {orePrev > 0 && <span style={{ color: totalOre > orePrev ? "var(--rosu)" : "var(--verde)" }}>/ {orePrev}h</span>}</b>
      </div>
      <div className="fisa-rand">
        <span className="k">Materiale</span>
        <b className="mono">{bani(bilant.materiale)} {matPrev > 0 && <span style={{ color: bilant.materiale > matPrev ? "var(--rosu)" : "var(--verde)" }}>/ {bani(matPrev)}</span>}</b>
      </div>

      {prev.length > 0 && (
        <>
          <div className="sectiune">Deviz materiale</div>
          {prev.map((m, i) => {
            const real = consumPeNume[(m.nume || "").trim().toLowerCase()];
            const depasit = real && real.cant > (Number(m.cant) || 0);
            return (
              <div className="fisa-rand" key={i}>
                <span>{m.nume} <span className="k">· prevăzut {m.cant} {m.unitate}</span></span>
                <b className="mono" style={{ color: real ? (depasit ? "var(--rosu)" : "var(--verde)") : "var(--mut)" }}>
                  {real ? `folosit ${real.cant} ${real.unitate}` : "nefolosit"}
                </b>
              </div>
            );
          })}
        </>
      )}

      <div className="sectiune">Materiale consumate</div>
      {consum.length === 0 ? (
        <div className="gol-msg">Niciun material notat pe acest șantier.</div>
      ) : (
        <>
          {Object.values(consumPeNume).map((v, i) => (
            <div className="fisa-rand" key={i}>
              <span>📦 {v.nume}</span>
              <b className="mono">{v.cant} {v.unitate} · {bani(v.valoare)}</b>
            </div>
          ))}
          <div style={{ height: 8 }} />
          {consum.map((c) => (
            <div className="jurnal-rand" key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div className="cand mono">{dataRo(c.data)}{c.inregistratDe && ` · ${c.inregistratDe}`}</div>
                <div className="ce">{c.nume} · <b className="mono">{c.cant} {c.unitate}</b>{c.pret > 0 && <> · {bani(c.cant * c.pret)}</>}</div>
              </div>
              <button className="btn btn-mic pericol" onClick={() => onStergeConsum(c.id)}>✕</button>
            </div>
          ))}
        </>
      )}

      {(() => {
        const peTip = {};
        pontaj.forEach((p) => {
          const t = p.tipMunca || santier.domeniu || "Diverse";
          if (!peTip[t]) peTip[t] = { ore: 0, cost: 0 };
          peTip[t].ore += Number(p.ore) || 0;
          peTip[t].cost += (Number(p.ore) || 0) * (Number(p.tarifOra) || 0);
        });
        const lista = Object.entries(peTip).sort((a, b) => b[1].ore - a[1].ore);
        if (lista.length === 0) return null;
        return (
          <>
            <div className="sectiune">Ore pe tip de muncă</div>
            {lista.map(([t, v]) => (
              <div className="fisa-rand" key={t}>
                <span>{t}</span>
                <b className="mono">{v.ore}h · {bani(v.cost)}</b>
              </div>
            ))}
          </>
        );
      })()}

      <div className="sectiune">Cine a lucrat aici</div>
      {pontaj.length === 0 ? (
        <div className="gol-msg">Niciun pontaj încă.</div>
      ) : (
        <>
          {Object.entries(peOm).map(([nume, v]) => (
            <div className="fisa-rand" key={nume}>
              <span>👷 {nume} <span className="k">· {v.zile.size} {v.zile.size === 1 ? "zi" : "zile"}</span></span>
              <b className="mono">{v.ore}h · {bani(v.cost)}</b>
            </div>
          ))}
          <div className="sectiune">Intrări pontaj</div>
          {pontaj.map((p) => (
            <div className="jurnal-rand" key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div className="cand mono">{dataRo(p.data)}</div>
                <div className="ce">
                  {p.nume} · <b className="mono">{p.ore}h</b>{p.tarifOra > 0 && <> · {bani(p.ore * p.tarifOra)}</>}
                  {p.tipMunca && <><br /><span style={{ color: "var(--galben)", fontSize: 12 }}>{p.tipMunca}</span></>}
                </div>
              </div>
              <button className="btn btn-mic pericol" onClick={() => onStergePontaj(p.id)}>✕</button>
            </div>
          ))}
        </>
      )}
    </Foaie>
  );
}

function GestioneazaMembri({ echipa, angajati, echipe, onSalveaza, onClose }) {
  const [sel, setSel] = useState(
    Object.fromEntries(angajati.filter((a) => a.echipaId === echipa.id).map((a) => [a.id, true]))
  );
  const comuta = (id) => setSel({ ...sel, [id]: !sel[id] });
  const alesi = angajati.filter((a) => sel[a.id]);
  const numeAltaEchipa = (a) => echipe.find((e) => e.id === a.echipaId)?.nume;

  return (
    <Foaie titlu={`Membri: ${echipa.nume}`} onClose={onClose}>
      <div className="sub" style={{ marginBottom: 12 }}>
        Bifează cine face parte din echipă. Cei bifați din altă echipă se mută aici, cei debifați rămân fără echipă.
      </div>
      {angajati.length === 0 ? (
        <div className="gol-msg">Niciun angajat în evidență.</div>
      ) : (
        angajati.map((a) => {
          const altundeva = a.echipaId && a.echipaId !== echipa.id;
          return (
            <label key={a.id} className="rand-bifa">
              <input type="checkbox" checked={!!sel[a.id]} onChange={() => comuta(a.id)} />
              <span>
                {a.nume}
                <span className="rb-sub">
                  {a.grad || "—"}
                  {altundeva && <span style={{ color: "var(--galben)" }}> · acum la {numeAltaEchipa(a)}</span>}
                  {!a.echipaId && <span style={{ color: "var(--mut)" }}> · fără echipă</span>}
                </span>
              </span>
            </label>
          );
        })
      )}
      <button className="btn btn-galben" style={{ marginTop: 14 }}
        onClick={() => onSalveaza(alesi.map((a) => a.id))}>
        Salvează echipa ({alesi.length} {alesi.length === 1 ? "om" : "oameni"})
      </button>
    </Foaie>
  );
}

function FormPlan({ item, data, santiere, echipe, angajati, planificare, onSalveaza, onSterge, onModificaAlta, onSalveazaAlta, onInlocuieste, onImparte, onCere, onClose }) {
  const [f, setF] = useState(
    item || { data, santierId: santiere.filter((s) => s.status !== "finalizat")[0]?.id || "",
      echipaId: "", angajatIds: [], oraStart: "07:30", oraFinal: "16:00", note: "" }
  );
  const comuta = (id) => {
    const l = f.angajatIds || [];
    setF({ ...f, angajatIds: l.includes(id) ? l.filter((x) => x !== id) : [...l, id] });
  };
  const d = new Date(f.data);
  const inEchipa = f.echipaId ? angajati.filter((a) => a.echipaId === f.echipaId) : [];
  const suplimentari = angajati.filter((a) => a.echipaId !== f.echipaId);

  /* toți oamenii implicați de o intrare de planing */
  const oameniiDin = (p) => {
    const ids = new Set(p.angajatIds || []);
    if (p.echipaId) angajati.filter((a) => a.echipaId === p.echipaId).forEach((a) => ids.add(a.id));
    return ids;
  };

  const aiMei = oameniiDin(f);
  const oraOk = minute(f.oraStart) !== null && minute(f.oraFinal) !== null && minute(f.oraFinal) > minute(f.oraStart);

  /* conflict = aceeași zi, ALT șantier, oameni comuni, ore care se calcă.
     Pe același șantier nu e conflict — omul e oricum acolo. */
  const conflicte = [];
  const dejaAici = [];
  planificare
    .filter((p) => p.data === f.data && p.id !== f.id)
    .forEach((p) => {
      const lor = oameniiDin(p);
      const comuni = [...aiMei].filter((id) => lor.has(id));
      if (comuni.length === 0) return;
      if (!seSuprapun(f, p)) return;
      if (p.santierId === f.santierId) {
        dejaAici.push({
          ore: interval(p),
          nume: comuni.map((id) => angajati.find((a) => a.id === id)?.nume).filter(Boolean),
        });
        return;
      }
      conflicte.push({
        alta: p,
        comuni,
        totiOamenii: comuni.length === lor.size,
        santier: santiere.find((s) => s.id === p.santierId)?.nume || "alt șantier",
        ore: interval(p),
        nume: comuni.map((id) => angajati.find((a) => a.id === id)?.nume).filter(Boolean),
      });
    });

  const valid = f.santierId && oraOk && conflicte.length === 0;

  /* pot împărți ziua doar dacă intervalul meu încape în al lor, lăsând ceva pe măcar o parte */
  const potImparti = (c) => {
    const a1 = minute(c.alta.oraStart), a2 = minute(c.alta.oraFinal);
    const m1 = minute(f.oraStart), m2 = minute(f.oraFinal);
    if ([a1, a2, m1, m2].some((x) => x === null)) return false;
    return m1 >= a1 && m2 <= a2 && (m1 - a1 >= 30 || a2 - m2 >= 30);
  };
  const durataOre = (x) => {
    const d = (minute(x.oraFinal) || 0) - (minute(x.oraStart) || 0);
    const h = Math.floor(d / 60), m = d % 60;
    return m ? `${h}h${m}` : `${h}h`;
  };

  return (
    <Foaie titlu={`${zileTrad()[(d.getDay() + 6) % 7]}, ${dataRo(f.data)}`} onClose={onClose}>
      <div className="camp">
        <label>Șantier *</label>
        <select value={f.santierId} onChange={(e) => setF({ ...f, santierId: e.target.value })}>
          <option value="">— alege —</option>
          {santiere.filter((s) => s.status !== "finalizat").map((s) => (
            <option key={s.id} value={s.id}>{s.nume}</option>
          ))}
        </select>
      </div>

      <div className="rand2">
        <div className="camp">
          <label>De la ora *</label>
          <input type="time" value={f.oraStart} onChange={(e) => setF({ ...f, oraStart: e.target.value })} />
        </div>
        <div className="camp">
          <label>Până la ora *</label>
          <input type="time" value={f.oraFinal} onChange={(e) => setF({ ...f, oraFinal: e.target.value })} />
        </div>
      </div>
      {!oraOk && (
        <div className="sub" style={{ color: "var(--rosu)", marginBottom: 11 }}>
          Ora de final trebuie să fie după cea de start.
        </div>
      )}

      <div className="camp">
        <label>Echipă</label>
        <select value={f.echipaId} onChange={(e) => setF({ ...f, echipaId: e.target.value })}>
          <option value="">Fără echipă</option>
          {echipe.map((e) => <option key={e.id} value={e.id}>{e.nume}</option>)}
        </select>
      </div>

      {inEchipa.length > 0 && (
        <div className="sub" style={{ marginBottom: 11 }}>
          Merg automat: {inEchipa.map((a) => a.nume).join(", ")}
        </div>
      )}

      <div className="camp">
        <label>Oameni în plus (din alte echipe)</label>
        {suplimentari.map((a) => (
          <label key={a.id} className="rand-bifa">
            <input type="checkbox" checked={(f.angajatIds || []).includes(a.id)} onChange={() => comuta(a.id)} />
            <span>{a.nume}<span className="rb-sub">{a.grad || "—"}</span></span>
          </label>
        ))}
      </div>

      <div className="camp">
        <label>Ce se face / observații</label>
        <textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })}
          placeholder="ex. Turnare placă, vine betoniera la 9" />
      </div>

      {dejaAici.length > 0 && (
        <div className="info-plan">
          <b>ℹ Sunt deja puși aici</b>
          {dejaAici.map((c, i) => (
            <div key={i} className="cf-rand">
              {c.nume.join(", ")} {c.nume.length === 1 ? "apare" : "apar"} deja pe acest șantier între{" "}
              <b className="mono">{c.ore}</b>. Poți salva oricum — o să fie două intrări pentru aceeași zi.
            </div>
          ))}
        </div>
      )}

      {conflicte.length > 0 && (
        <div className="conflict">
          <b>⛔ Suprapunere de program</b>
          {conflicte.map((c, i) => {
            const durata = (minute(f.oraFinal) || 0) - (minute(f.oraStart) || 0);
            const startDupa = minute(c.alta.oraFinal);
            const potDupa = startDupa !== null && durata > 0 && startDupa + durata <= 24 * 60;
            const potInainte = minute(c.alta.oraStart) !== null && minute(f.oraStart) !== null
              && minute(c.alta.oraStart) < minute(f.oraStart);
            return (
              <div key={i} style={{ marginBottom: 10 }}>
                <div className="cf-rand">
                  {c.nume.join(", ")} {c.nume.length === 1 ? "e deja" : "sunt deja"} pe <b>{c.santier}</b> între <b className="mono">{c.ore}</b>.
                </div>
                <div className="actiuni" style={{ marginTop: 7 }}>
                  {potDupa && (
                    <button className="btn btn-mic principal"
                      onClick={() => setF({ ...f, oraStart: catreOra(startDupa), oraFinal: catreOra(startDupa + durata) })}>
                      Îi pun după: {catreOra(startDupa)}–{catreOra(startDupa + durata)}
                    </button>
                  )}
                  {potInainte && (
                    <button className="btn btn-mic"
                      onClick={() => onSalveazaAlta({ ...c.alta, oraFinal: f.oraStart })}>
                      Îi termin acolo la {f.oraStart}
                    </button>
                  )}
                  {potImparti(c) && (
                    <button className="btn btn-mic principal"
                      onClick={() => onCere(
                        `${c.nume.join(", ")} ${c.nume.length === 1 ? "vine" : "vin"} aici ${f.oraStart}–${f.oraFinal}, ` +
                        `apoi ${c.nume.length === 1 ? "se întoarce" : "se întorc"} pe ${c.santier}. Programul de acolo se taie în două.`,
                        () => onImparte(c, f.oraStart, f.oraFinal), "Împarte ziua")}>
                      Îi iau doar {durataOre(f)} și revin acolo
                    </button>
                  )}
                  <button className="btn btn-mic" onClick={() => onModificaAlta(c.alta)}>
                    Deschide programul lor
                  </button>
                  <button className="btn btn-mic pericol"
                    onClick={() => onCere(
                      `Înlocuiești programul de pe ${c.santier} (${c.ore}) cu ăsta? ` +
                      (c.totiOamenii
                        ? "Intrarea aceea se șterge complet."
                        : `${c.nume.join(", ")} ${c.nume.length === 1 ? "iese" : "ies"} de acolo, restul echipei rămâne.`),
                      () => onInlocuieste(c), "Înlocuiește")}>
                    Înlocuiește programul lor
                  </button>
                </div>
              </div>
            );
          })}
          <div className="cf-sfat">Sau schimbi tu orele de mai sus, ori scoți oamenii din listă.</div>
        </div>
      )}

      <button className="btn btn-galben" disabled={!valid} onClick={() => valid && onSalveaza(f)}>
        Salvează în planing
      </button>
      {item && (
        <button className="btn btn-mic pericol" style={{ width: "100%", marginTop: 9 }} onClick={() => onSterge(item.id)}>
          Șterge din planing
        </button>
      )}
    </Foaie>
  );
}

function FormParolaAngajat({ angajat, onSalveaza, onClose }) {
  const [pin, setPin] = useState("");
  const [eroare, setEroare] = useState("");
  return (
    <Foaie titlu={`Parolă: ${angajat.nume}`} onClose={onClose}>
      <div className="sub" style={{ marginBottom: 12 }}>
        {angajat.pin
          ? "Setezi o parolă nouă. Spune-i-o omului — cea veche nu mai merge."
          : "Poți să-i setezi tu parola, sau o lași goală și și-o alege singur la prima intrare."}
      </div>
      <div className="camp">
        <label>Parolă nouă (minim 4 caractere)</label>
        <input type="text" inputMode="numeric" value={pin} onChange={(e) => { setPin(e.target.value); setEroare(""); }} placeholder="ex. 2580" />
      </div>
      {eroare && <div style={{ color: "var(--rosu)", fontSize: 13, marginBottom: 10 }}>{eroare}</div>}
      <button className="btn btn-galben" onClick={() => pin.length >= 4 ? onSalveaza(pin) : setEroare("Minim 4 caractere.")}>
        Salvează parola
      </button>
      {angajat.pin && (
        <button className="btn btn-mic" style={{ width: "100%", marginTop: 9 }}
          onClick={() => onSalveaza("")}>
          Șterge parola (își alege el alta)
        </button>
      )}
    </Foaie>
  );
}

function ListaSarcini({ santier, sarcini, onAdauga, onComuta, onSterge, onClose }) {
  const deschise = sarcini.filter((x) => x.status === "deschis");
  const gata = sarcini.filter((x) => x.status === "rezolvat");
  const rand = (x) => (
    <div className="card" key={x.id} style={x.status === "rezolvat" ? { opacity: .65 } : null}>
      <div className="card-rand">
        <div>
          <div className="titlu">{x.titlu}</div>
          <div className="sub">
            {x.cand}
            {x.descriere && <><br />{x.descriere}</>}
            {x.status === "rezolvat" && x.rezolvatDe && <><br />✓ Rezolvat de {x.rezolvatDe} · {x.dataRezolvare}</>}
          </div>
        </div>
        <span className={"chip " + (x.status === "rezolvat" ? "ok" : "alerta")}>
          {x.status === "rezolvat" ? "Gata" : "De făcut"}
        </span>
      </div>
      {(x.fotoId || x.fotoData) && <Poza fotoId={x.fotoId} fotoData={x.fotoData} />}
      <div className="actiuni">
        <button className="btn btn-mic" onClick={() => onComuta(x.id)}>
          {x.status === "rezolvat" ? "Redeschide" : "Marchează rezolvat"}
        </button>
        <button className="btn btn-mic pericol" onClick={() => onSterge(x.id)}>Șterge</button>
      </div>
    </div>
  );
  return (
    <Foaie titlu={`De rezolvat: ${santier.nume}`} onClose={onClose}>
      <button className="btn btn-galben" onClick={onAdauga}>+ Adaugă problemă cu poză</button>
      <div style={{ height: 12 }} />
      {sarcini.length === 0 ? (
        <div className="gol-msg">
          Nimic încă. Faci o poză cu ce e de reparat sau de terminat, scrii două vorbe, iar oamenii de pe șantierul ăsta o văd pe telefonul lor.
        </div>
      ) : (
        <>
          {deschise.map(rand)}
          {gata.length > 0 && (
            <>
              <div className="sectiune">Rezolvate ({gata.length})</div>
              {gata.map(rand)}
            </>
          )}
        </>
      )}
    </Foaie>
  );
}

function FormSarcina({ santierId, onSalveaza, onClose }) {
  const [f, setF] = useState({ santierId, titlu: "", descriere: "" });
  const [poza, setPoza] = useState(null);      // dataURL comprimat, gata de salvat
  const [procesez, setProcesez] = useState(false);
  const [salvez, setSalvez] = useState(false);
  const [eroare, setEroare] = useState("");
  const [pasi, setPasi] = useState([]);
  const noteaza = (x) => setPasi((p) => [...p, x]);

  const alegePoza = async (e) => {
    const fis = e.target.files?.[0];
    e.target.value = ""; // ca să meargă și dacă alege aceeași poză a doua oară
    if (!fis) { noteaza("Nu s-a ales niciun fișier."); return; }
    setEroare(""); setProcesez(true); setPoza(null);
    noteaza(`Ales: ${fis.name || "poză"} · ${Math.round(fis.size / 1024)} KB`);
    try {
      const p = await comprimaPoza(fis);
      setPoza(p);
      noteaza(`Micșorată la ~${Math.round((p.length * 0.75) / 1024)} KB`);
    } catch (er) {
      setEroare(er.message || "Poza nu s-a putut procesa.");
      noteaza("Eroare la micșorare: " + (er.message || "necunoscută"));
    }
    setProcesez(false);
  };

  const trimite = async () => {
    if (!f.titlu.trim()) return;
    setEroare(""); setSalvez(true);
    try {
      await onSalveaza(f, poza, noteaza);
    } catch (er) {
      noteaza("Eroare la salvare: " + (er.message || "necunoscută"));
      setEroare((er.message || "Salvarea a eșuat.") + " Poți salva problema și fără poză.");
      setSalvez(false);
    }
  };

  const marime = poza ? Math.round((poza.length * 0.75) / 1024) : 0;

  return (
    <Foaie titlu="Problemă de rezolvat" onClose={onClose}>
      <div className="camp">
        <label>Ce e de făcut *</label>
        <input value={f.titlu} onChange={(e) => setF({ ...f, titlu: e.target.value })}
          placeholder="ex. Refăcut colțul de la baie" />
      </div>
      <div className="camp">
        <label>Detalii</label>
        <textarea rows={2} value={f.descriere} onChange={(e) => setF({ ...f, descriere: e.target.value })}
          placeholder="ex. Nu e la plumb, se vede de la ușă. De reparat înainte de gletuit." />
      </div>

      <div className="camp">
        <label>Poză</label>
        <label className="buton-poza">
          <input type="file" accept="image/*" onChange={alegePoza}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%",
              opacity: 0, cursor: "pointer", fontSize: 0 }} />
          {procesez ? "Se pregătește poza…" : poza ? "Schimbă poza" : "📷 Fă o poză sau alege din galerie"}
        </label>
        {poza && (
          <>
            <img className="poza" src={poza} alt="" style={{ marginTop: 10 }} />
            <div className="sub" style={{ marginTop: 6, display: "flex", justifyContent: "space-between" }}>
              <span>Pregătită · ~{marime} KB</span>
              <button className="btn btn-mic pericol" onClick={() => setPoza(null)}>Scoate poza</button>
            </div>
          </>
        )}
      </div>

      {pasi.length > 0 && (
        <div className="pasi-poza">
          {pasi.map((p, i) => <div key={i}>· {p}</div>)}
        </div>
      )}

      {eroare && (
        <div className="conflict" style={{ marginTop: 4 }}>
          <b>⚠ {eroare}</b>
        </div>
      )}

      <button className="btn btn-galben" disabled={!f.titlu.trim() || salvez || procesez} onClick={trimite}>
        {salvez ? "Se salvează…" : procesez ? "Așteaptă poza…" : "Salvează"}
      </button>
    </Foaie>
  );
}

function FormIesire({ material, santiere, onSalveaza, onClose }) {
  const [f, setF] = useState({ cant: "", santierId: "", motiv: "", data: aziISO() });
  const active = santiere.filter((s) => s.status !== "finalizat");
  const valoare = (Number(f.cant) || 0) * (Number(material.pret) || 0);
  const valid = Number(f.cant) > 0;
  return (
    <Foaie titlu={`Scoate din stoc: ${material.nume}`} onClose={onClose}>
      <div className="sub" style={{ marginBottom: 12 }}>
        În stoc: <b className="mono">{material.cant} {material.unitate}</b>
        {material.pret > 0 && <> · {bani(material.pret)}/{material.unitate}</>}
      </div>
      <div className="rand2">
        <div className="camp"><label>Cantitate * ({material.unitate})</label>
          <input type="number" step="0.01" value={f.cant} onChange={(e) => setF({ ...f, cant: e.target.value })} placeholder="0" /></div>
        <div className="camp"><label>Data</label>
          <input type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} /></div>
      </div>
      <div className="camp">
        <label>Unde se duce</label>
        <select value={f.santierId} onChange={(e) => setF({ ...f, santierId: e.target.value })}>
          <option value="">Nu știu / pierdere / consum intern</option>
          {active.map((s) => <option key={s.id} value={s.id}>{s.nume}</option>)}
        </select>
      </div>
      {!f.santierId && (
        <>
          <div className="camp">
            <label>Motiv (opțional)</label>
            <input value={f.motiv} onChange={(e) => setF({ ...f, motiv: e.target.value })}
              placeholder="ex. spart la descărcare, lipsă la inventar, dat împrumut" />
          </div>
          <div className="sub" style={{ color: "var(--galben)", marginBottom: 12 }}>
            Fără șantier, valoarea asta se scade direct din marja ta netă și apare la Statistici → materiale fără destinație.
          </div>
        </>
      )}
      {valoare > 0 && <div className="sub" style={{ marginBottom: 12 }}>Valoare: <b style={{ color: "var(--galben)" }}>{bani(valoare)}</b></div>}
      {Number(f.cant) > Number(material.cant) && (
        <div className="sub" style={{ color: "var(--rosu)", marginBottom: 10 }}>
          ⚠ Scoți mai mult decât ai în stoc. Stocul va ajunge la 0.
        </div>
      )}
      <button className="btn btn-galben" disabled={!valid}
        onClick={() => valid && onSalveaza(f.santierId || null, {
          materialId: material.id, cant: f.cant, pret: material.pret,
          unitate: material.unitate, motiv: f.motiv, data: f.data, scadeDinStoc: true,
        })}>
        Scoate din stoc
      </button>
    </Foaie>
  );
}

function FormPin({ actual, onSalveaza, onClose }) {
  const [vechi, setVechi] = useState("");
  const [nou, setNou] = useState("");
  const [eroare, setEroare] = useState("");
  return (
    <Foaie titlu="Schimbă PIN admin" onClose={onClose}>
      <div className="camp"><label>PIN actual</label>
        <input type="password" inputMode="numeric" value={vechi} onChange={(e) => { setVechi(e.target.value); setEroare(""); }} /></div>
      <div className="camp"><label>PIN nou (minim 4 caractere)</label>
        <input type="password" inputMode="numeric" value={nou} onChange={(e) => setNou(e.target.value)} /></div>
      {eroare && <div style={{ color: "var(--rosu)", fontSize: 13, marginBottom: 10 }}>{eroare}</div>}
      <button className="btn btn-galben" onClick={() => {
        if (vechi !== actual) return setEroare("PIN-ul actual e greșit.");
        if (nou.length < 4) return setEroare("PIN-ul nou e prea scurt.");
        onSalveaza(nou);
      }}>Salvează PIN</button>
    </Foaie>
  );
}


/* ---------- pornire ---------- */
const radacina = ReactDOM.createRoot(document.getElementById("root"));
radacina.render(<App />);
