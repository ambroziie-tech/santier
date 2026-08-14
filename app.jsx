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
  dotare: [], verificari: [], categoriiMateriale: [], categoriiScule: [], roluriFirma: [],
  firma: null,
  alimentari: [],
  setari: { pin: PIN_IMPLICIT, zilePoze: 30, zileCereri: 30, oreVizibileMuncitori: true, procentTaxe: 0,
    program: { start: "07:30", final: "16:00", pauza: 60,
      zile: ["MO", "TU", "WE", "TH", "FR"], special: {} } },
  suplimentare: [],
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
/* Programul unei zile: cel special dacă există, altfel cel standard.
   codZi: "MO".."SU" */
const CODURI_ZI = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const codZiDinData = (dataISO) => CODURI_ZI[(new Date(dataISO).getDay() + 6) % 7];

const programZi = (program, codZi) => {
  const p = program || {};
  const sp = (p.special || {})[codZi];
  return {
    start: sp?.start || p.start || "07:30",
    final: sp?.final || p.final || "16:00",
    pauza: sp?.pauza !== undefined ? sp.pauza : (p.pauza !== undefined ? p.pauza : 60),
    special: !!sp,
  };
};

/* orele plătite dintr-o zi: durata minus pauza */
const oreDinProgram = (pz) => {
  const d = (minute(pz.final) || 0) - (minute(pz.start) || 0) - (Number(pz.pauza) || 0);
  return d > 0 ? +(d / 60).toFixed(2) : 0;
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
/* costul real al unei ore lucrate, cu taxele patronale incluse */
const costCuTaxe = (ore, tarifOra, procentTaxe) =>
  (Number(ore) || 0) * (Number(tarifOra) || 0) * (1 + (Number(procentTaxe) || 0) / 100);

const etichetaCerere = (tip) =>
  tip === "problema" ? "⚠ Problemă"
  : tip === "planing" ? "🗓 Planing"
  : tip === "resurse" ? "👷 Muncitori ceruți"
  : "📦 Necesar";

let SIMBOL = "€";
const bani = (n) =>
  (Number(n) || 0).toLocaleString("ro-RO", { maximumFractionDigits: 0 }) + " " + SIMBOL;

const DOMENII = ["Zidărie", "Fundații / terasamente", "Structură / dulgherie", "Acoperiș", "Finisaje", "Instalații", "Izolații", "Amenajări exterioare", "Demolări", "Diverse"];

const GRADE = ["Muncitor", "Muncitor calificat", "Șef de echipă", "Operator utilaj", "Șofer", "Maistru", "Zidar", "Dulgher", "Fierar", "Finisor"];
const GRADE_BIROU = ["Administrativ", "Contabilitate", "Secretariat", "Achiziții", "Manager", "Altă funcție"];

/* rolurile de firmă: dau acces la o parte din panoul de admin, printr-un cont personal.
   null = fără rol special = intră doar în vederea de muncitor/birou obișnuită. */
/* fiecare rol de firmă e un pachet de bife pe care-l definești tu.
   grupate ca să fie ușor de citit într-un formular. */
const GRUPURI_PERMISIUNI = [
  { titlu: "Panou", chei: [["panou", "Vede panoul principal"]] },
  { titlu: "Șantiere", chei: [
    ["santiere", "Vede șantierele — cifrat, marjă, cine a lucrat"],
    ["santiereEditare", "Poate adăuga șantiere, pontaje și materiale pe ele"],
  ] },
  { titlu: "Planing", chei: [["planing", "Vede și modifică planingul"]] },
  { titlu: "Stoc", chei: [
    ["stocMateriale", "Materiale — adaugă, scade, prețuri"],
    ["stocScule", "Scule — adaugă, alocă pe echipe"],
    ["stocAuto", "Camioane și utilaje — ITP, întreținere, combustibil"],
  ] },
  { titlu: "Cereri", chei: [["cereri", "Vede și aprobă cererile de pe teren"]] },
  { titlu: "Rapoarte", chei: [
    ["cifre", "Cifre și rentabilitate — marje, aport pe om"],
    ["rapoarte", "Raport lunar pe fiecare angajat"],
  ] },
  { titlu: "Echipe", chei: [["dotare", "Verifică dotarea standard a echipelor"]] },
  { titlu: "Oameni", chei: [
    ["oameni", "Vede angajații și fișele lor"],
    ["oameniEditare", "Poate adăuga, modifica sau șterge angajați"],
  ] },
];
const numeRol = (roluri, id) => (roluri || []).find((r) => r.id === id)?.nume || null;

/* zile rămase până la o dată yyyy-mm-dd; null dacă lipsește */
const zileRamase = (d) => {
  if (!d) return null;
  const diff = Math.ceil((new Date(d) - new Date().setHours(0, 0, 0, 0)) / 86400000);
  return diff;
};
const dataRo = (d) => (d ? new Date(d).toLocaleDateString("ro-RO") : "—");

/* Deschide adresa în aplicația de hărți a telefonului.
   Pe iPhone Apple Plans/Google Maps, pe Android Google Maps — decide sistemul. */
const linkHarta = (adresa) => {
  const q = encodeURIComponent(adresa || "");
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return iOS ? `maps://?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
};

/* butonul de navigare, folosit peste tot unde apare o adresă */
function ButonHarta({ adresa, mic }) {
  if (!adresa || !adresa.trim()) return null;
  return (
    <a className={"btn btn-mic" + (mic ? "" : " principal")}
      style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}
      href={linkHarta(adresa)} target="_blank" rel="noreferrer"
      onClick={(e) => e.stopPropagation()}>
      📍 {mic ? "Hartă" : "Deschide în hărți"}
    </a>
  );
}

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
  min-height:100vh;max-width:560px;margin:0 auto;
  padding-bottom:calc(92px + env(safe-area-inset-bottom, 0px))}
.mono{font-family:'Chivo Mono',monospace}
.antet{padding:calc(env(safe-area-inset-top, 0px) + 14px) 16px 10px;position:sticky;top:0;
  background:var(--asfalt);z-index:10}
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
.filtre{display:flex;gap:6px;overflow-x:auto;margin-bottom:11px;padding-bottom:3px}
.filtre button{flex:none;background:var(--beton);border:1px solid var(--linie);color:var(--mut);
  font-family:'Archivo',sans-serif;font-weight:600;font-size:12.5px;padding:7px 13px;
  border-radius:20px;cursor:pointer;white-space:nowrap}
.filtre button.activ{background:var(--galben-int);border-color:var(--galben);color:var(--galben)}
.subtab{display:flex;gap:8px;margin-bottom:12px}
.subtab button{flex:1;background:var(--beton);border:1px solid var(--linie);color:var(--mut);
  font-family:'Archivo',sans-serif;font-weight:700;font-size:13px;padding:9px;border-radius:9px;cursor:pointer}
.subtab button.activ{background:var(--galben-int);border-color:var(--galben);color:var(--galben)}
.voal{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:40}
.foaie{position:fixed;left:0;right:0;bottom:0;max-width:560px;margin:0 auto;background:var(--beton);
  border-radius:16px 16px 0 0;border-top:2px solid var(--galben);z-index:50;
  padding:18px 16px calc(26px + env(safe-area-inset-bottom, 0px));
  max-height:88vh;overflow-y:auto}
.foaie-cap{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px}
.foaie-cap h2{margin-bottom:0}
.foaie-x{flex:none;width:34px;height:34px;border-radius:50%;background:var(--beton2);
  border:1px solid var(--linie);color:var(--text);font-size:16px;line-height:1;cursor:pointer}
.foaie h2{font-size:16px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;margin-bottom:14px}
.camp{margin-bottom:11px}
.camp label{display:block;font-size:12px;font-weight:600;color:var(--mut);margin-bottom:5px}
.camp input,.camp select,.camp textarea{width:100%;background:var(--asfalt);border:1px solid var(--linie);
  color:var(--text);border-radius:9px;padding:10px 12px;font-size:14.5px;font-family:'Archivo',sans-serif}
.camp input:focus,.camp select:focus,.camp textarea:focus{outline:2px solid var(--galben);outline-offset:-1px}
.rand2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.nav{position:fixed;bottom:0;left:0;right:0;max-width:560px;margin:0 auto;background:var(--beton);
  border-top:1px solid var(--linie);display:flex;z-index:30;
  padding-bottom:env(safe-area-inset-bottom, 0px)}
.nav button{flex:1;background:none;border:none;color:var(--mut);font-family:'Archivo',sans-serif;
  font-size:10.5px;font-weight:600;padding:11px 2px 9px;cursor:pointer;display:flex;flex-direction:column;
  align-items:center;gap:4px;position:relative;min-height:58px;justify-content:center}
.nav button.activ{color:var(--galben)}
.nav .ico{font-size:21px;line-height:1}
.bulina{position:absolute;top:6px;right:calc(50% - 16px);background:var(--rosu);color:#fff;
  font-size:9px;font-weight:800;min-width:15px;height:15px;border-radius:8px;display:flex;
  align-items:center;justify-content:center;padding:0 3px}
.gol-msg{text-align:center;color:var(--mut);padding:30px 16px;font-size:14px;line-height:1.6}
.jurnal-rand{border-left:2px solid var(--galben);padding:6px 0 6px 12px;margin-bottom:8px}
.jurnal-rand .cand{font-size:11px;color:var(--mut)}
.jurnal-rand .ce{font-size:13.5px;margin-top:2px;line-height:1.45}
.lista-in-card{margin-top:8px;padding-top:8px;border-top:1px dashed var(--linie);font-size:13px;line-height:1.75}
.intrare{display:flex;flex-direction:column;justify-content:center;min-height:100vh;gap:12px;
  padding:calc(env(safe-area-inset-top, 0px) + 16px) 16px calc(env(safe-area-inset-bottom, 0px) + 16px)}
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
.rand-cerere{display:flex;align-items:center;gap:10px;padding:9px 2px;
  border-bottom:1px dashed var(--linie)}
.rand-cerere>div:first-child{flex:1;min-width:0}
.rc-cant{display:flex;align-items:center;gap:9px;flex:none}
.rc-cant button{width:34px;height:34px;border-radius:50%;background:var(--beton2);
  border:1px solid var(--linie);color:var(--galben);font-size:19px;line-height:1;cursor:pointer}
.rc-cant span{min-width:26px;text-align:center;font-size:15px;font-weight:700}
.btn-sterge-plan{background:none;border:none;color:var(--mut);font-size:17px;line-height:1;
  padding:4px 8px;cursor:pointer;flex:none}
.plan-item{background:var(--asfalt);border-radius:8px;padding:9px 10px;margin-top:8px;cursor:pointer;
  border-left:3px solid var(--galben)}
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
.meniu-iesire{display:flex;align-items:center;gap:11px;background:none;border:1px solid var(--linie);
  color:var(--rosu);font-family:'Archivo',sans-serif;font-weight:700;font-size:14.5px;padding:14px;
  border-radius:11px;cursor:pointer;text-align:left;margin-top:6px}
.meniu-iesire span{font-size:19px}
.meniu-set button>div{display:flex;flex-direction:column;gap:2px}
.ms-desc{font-size:11.5px;font-weight:400;color:var(--mut);text-transform:none;letter-spacing:0}
.ms-sageata{font-size:20px;color:var(--mut);flex:none}
.btn-inapoi{display:flex;align-items:center;gap:9px;background:none;border:none;color:var(--galben);
  font-family:'Archivo',sans-serif;font-weight:700;font-size:14px;padding:2px 0 12px;cursor:pointer}
.btn-inapoi span{color:var(--text);font-size:16px;font-weight:800}
.meniu-set button.activ{background:var(--galben-int);border-color:var(--galben);color:var(--galben)}
.alerta-card{cursor:pointer;border-left:3px solid var(--galben)}
.alerta-card.expirat{border-left-color:var(--rosu)}
.bara{height:5px;background:var(--asfalt);border-radius:3px;margin-top:9px;overflow:hidden}
.bara-fill{height:100%;border-radius:3px}
.nav button{font-size:9.5px;letter-spacing:-.2px}
.nav .ico{font-size:21px}
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
        <div className="foaie-cap">
          <h2>{titlu}</h2>
          <button className="foaie-x" onClick={onClose} aria-label="Închide">✕</button>
        </div>
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
  const [filtruCat, setFiltruCat] = useState("");
  const [filtruCereri, setFiltruCereri] = useState("toate");
  const [sortSant, setSortSant] = useState("activitate");
  const [subOam, setSubOam] = useState("angajati");
  const [subSet, setSubSet] = useState(null);
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
          if (d.firma?.moneda) SIMBOL = d.firma.moneda.indexOf("lei") >= 0 ? "lei" : "€";
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
    if (nou.firma?.moneda) SIMBOL = nou.firma.moneda.indexOf("lei") >= 0 ? "lei" : "€";
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

  /* ---------- backup ---------- */
  const [lucruBackup, setLucruBackup] = useState("");
  const [copiiSalvate, setCopiiSalvate] = useState([]);

  const incarcaCopii = useCallback(async () => {
    try {
      const r = await stocare.list("copie:", true);
      const lista = [];
      for (const cheie of r?.keys || []) {
        try {
          const v = await stocare.get(cheie, true);
          if (v?.value) {
            const d = JSON.parse(v.value);
            lista.push({ cheie, cand: d.cand, rezumat: d.rezumat });
          }
        } catch (e) {}
      }
      setCopiiSalvate(lista.sort((a, b) => (b.cand || "").localeCompare(a.cand || "")));
    } catch (e) { setCopiiSalvate([]); }
  }, []);

  useEffect(() => {
    if (tab === "setari" && subSet === "backup") incarcaCopii();
  }, [tab, subSet, incarcaCopii]);

  const rezumatDate = (d) =>
    `${d.santiere?.length || 0} șantiere · ${d.angajati?.length || 0} angajați · ${d.pontaj?.length || 0} pontaje · ${d.materiale?.length || 0} materiale`;

  const faCopieRapida = async () => {
    setLucruBackup("Se face copia…");
    try {
      const cand = new Date().toISOString();
      const pachet = { versiune: VERSIUNE_BACKUP, cand, rezumat: rezumatDate(db), date: db };
      const ok = await stocare.set(`copie:${cand}`, JSON.stringify(pachet), true);
      if (!ok) throw new Error("Stocarea a refuzat copia.");
      const r = await stocare.list("copie:", true);
      const chei = (r?.keys || []).sort();
      for (const c of chei.slice(0, Math.max(0, chei.length - MAX_COPII))) {
        try { await stocare.delete(c, true); } catch (e) {}
      }
      await incarcaCopii();
      setLucruBackup("Copie făcută.");
    } catch (e) {
      setLucruBackup("Copia a eșuat: " + (e.message || "eroare necunoscută"));
    }
    setTimeout(() => setLucruBackup(""), 4000);
  };

  const restaureazaCopie = (cheie) =>
    cere("Restaurezi această copie? Tot ce e acum în aplicație se înlocuiește. Pozele nu se ating.", async () => {
      setLucruBackup("Se restaurează…");
      try {
        const v = await stocare.get(cheie, true);
        const pachet = JSON.parse(v.value);
        const d = pachet.date || pachet;
        await salveaza({ ...gol, ...d, setari: { ...gol.setari, ...(d.setari || {}) } });
        setLucruBackup("Restaurat.");
      } catch (e) {
        setLucruBackup("Restaurarea a eșuat: " + (e.message || "fișier deteriorat"));
      }
      setTimeout(() => setLucruBackup(""), 4000);
    }, "Restaurează");

  const stergeCopie = (cheie) => cere("Ștergi această copie?", async () => {
    try { await stocare.delete(cheie, true); await incarcaCopii(); } catch (e) {}
  }, "Șterge");

  const exporta = async (cuPoze) => {
    setLucruBackup(cuPoze ? "Se adună pozele…" : "Se pregătește fișierul…");
    try {
      const poze = cuPoze ? await adunaPoze() : {};
      const pachet = {
        versiune: VERSIUNE_BACKUP, cand: new Date().toISOString(),
        rezumat: rezumatDate(db), continePoze: cuPoze, poze, date: db,
      };
      const text = JSON.stringify(pachet);
      const nume = numeFisier();
      const rezultat = await descarca(text, nume);
      setLucruBackup(rezultat === "partajat" ? "Trimis prin partajare."
        : rezultat === "descarcat" ? "Fișier descărcat."
        : "Nu s-a putut descărca — folosește copia rapidă de mai sus.");
    } catch (e) {
      setLucruBackup("Exportul a eșuat: " + (e.message || "eroare necunoscută"));
    }
    setTimeout(() => setLucruBackup(""), 6000);
  };

  const importa = async (fisier) => {
    setLucruBackup("Se citește fișierul…");
    try {
      const text = await fisier.text();
      const pachet = JSON.parse(text);
      const d = pachet.date || pachet;
      if (!d || typeof d !== "object" || !Array.isArray(d.santiere))
        throw new Error("Fișierul nu pare un backup al acestei aplicații.");
      const candS = pachet.cand ? new Date(pachet.cand).toLocaleString("ro-RO") : "necunoscut";
      cere(`Backup din ${candS} · ${rezumatDate(d)}. Se înlocuiește TOT ce e acum în aplicație. Continui?`,
        async () => {
          const poze = pachet.poze || {};
          const nrPoze = Object.keys(poze).length;
          if (nrPoze) {
            setLucruBackup(`Se pun la loc ${nrPoze} poze…`);
            for (const [id, dataUrl] of Object.entries(poze)) {
              try { await stocare.set(`foto:${id}`, dataUrl, true); } catch (e) {}
            }
          }
          await salveaza({ ...gol, ...d, setari: { ...gol.setari, ...(d.setari || {}) } });
          setLucruBackup("Import reușit.");
          setTimeout(() => setLucruBackup(""), 5000);
        }, "Importă",
        () => setLucruBackup(""));
    } catch (e) {
      setLucruBackup("Importul a eșuat: " + (e.message || "fișier invalid"));
      setTimeout(() => setLucruBackup(""), 5000);
    }
  };

  /* ---------- curățenie automată a pozelor ----------
     Pozele problemelor rezolvate se șterg după un număr de zile.
     Textul rămâne — dispare doar imaginea, care ocupă locul. */
  const [curatenie, setCuratenie] = useState("");

  const zileDeLaISO = (d) => {
    if (!d) return null;
    return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  };

  const stergePozeVechi = useCallback(async (praguri, tacut) => {
    const zilePastrare = Number(praguri) || 0;
    if (!zilePastrare) return 0;
    const deSters = db.sarcini.filter((x) =>
      x.status === "rezolvat" && (x.fotoId || x.fotoData) &&
      zileDeLaISO(x.rezolvatISO) !== null && zileDeLaISO(x.rezolvatISO) >= zilePastrare);
    if (deSters.length === 0) return 0;

    for (const x of deSters) {
      if (x.fotoId) { try { await stocare.delete(`foto:${x.fotoId}`, true); } catch (e) {} }
    }
    const sarcini = db.sarcini.map((x) =>
      deSters.some((y) => y.id === x.id)
        ? { ...x, fotoId: null, fotoData: null, pozaStearsa: true }
        : x);
    await salveaza({ ...db, sarcini });
    if (!tacut) setCuratenie(`${deSters.length} ${deSters.length === 1 ? "poză ștearsă" : "poze șterse"}.`);
    return deSters.length;
  }, [db, salveaza]);

  /* cererile și suplimentarele rezolvate se șterg după un timp.
     Orele deja aprobate rămân în pontaj — se șterge doar cererea. */
  const curataCereri = useCallback(async (zile, tacut) => {
    const prag = Number(zile) || 0;
    if (!prag) return 0;
    const vechi = (d) => {
      const t = d ? new Date(d).getTime() : null;
      return t ? Math.floor((Date.now() - t) / 86400000) >= prag : false;
    };
    const cereriRamase = db.cereri.filter((c) =>
      c.status === "nou" || !vechi(c.rezolvatLa || c.candISO));
    const supRamase = db.suplimentare.filter((x) =>
      x.status === "nou" || !vechi(x.raspunsLa));
    const sterse = (db.cereri.length - cereriRamase.length) + (db.suplimentare.length - supRamase.length);
    if (sterse === 0) return 0;
    await salveaza({ ...db, cereri: cereriRamase, suplimentare: supRamase });
    if (!tacut) setCuratenie(`${sterse} intrări vechi șterse.`);
    return sterse;
  }, [db, salveaza]);

  useEffect(() => {
    if (identitate?.rol !== "admin") return;
    const z = db.setari?.zileCereri;
    if (!z) return;
    curataCereri(z, true);
    // eslint-disable-next-line
  }, [identitate, db.setari?.zileCereri]);

  /* la fiecare intrare ca admin, curăț ce a expirat */
  useEffect(() => {
    if (identitate?.rol !== "admin") return;
    const zile = db.setari?.zilePoze;
    if (!zile) return;
    stergePozeVechi(zile, true);
    // eslint-disable-next-line
  }, [identitate, db.setari?.zilePoze]);

  /* raport tipăribil (din fereastra de tipărire alegi „Salvează ca PDF") */
  const deschideRaport = (titlu, corp) => {
    const w = window.open("", "_blank");
    if (!w) { cere("Browserul a blocat fereastra. Permite ferestrele pop-up pentru site și încearcă din nou.", () => {}, "Am înțeles"); return; }
    w.document.write(`<!DOCTYPE html><html lang="ro"><head><meta charset="utf-8">
      <title>${titlu}</title>
      <style>
        *{box-sizing:border-box}
        body{font-family:-apple-system,system-ui,sans-serif;color:#17191D;max-width:800px;
          margin:0 auto;padding:28px 22px;line-height:1.5;font-size:13px}
        h1{font-size:21px;margin:0 0 3px}
        h2{font-size:14px;margin:22px 0 8px;padding-bottom:5px;border-bottom:2px solid #F5B301;
          text-transform:uppercase;letter-spacing:.5px}
        .cap{color:#666;font-size:12px;margin-bottom:18px}
        table{width:100%;border-collapse:collapse;margin-bottom:6px}
        th{text-align:left;font-size:11px;text-transform:uppercase;color:#666;
          border-bottom:1px solid #ddd;padding:6px 4px}
        td{padding:6px 4px;border-bottom:1px solid #f0f0f0}
        td.n,th.n{text-align:right;white-space:nowrap}
        .tot{font-weight:700;background:#faf6e8}
        .verde{color:#1c7a4a;font-weight:700}
        .rosu{color:#c0392b;font-weight:700}
        .mic{color:#666;font-size:11px}
        @media print{ body{padding:0} .bara-sus{display:none} }
        .bara-sus{position:sticky;top:0;background:#fff;padding:10px 0 14px;
          display:flex;gap:10px;border-bottom:1px solid #eee;margin-bottom:14px;z-index:9}
        button{background:#F5B301;border:none;padding:11px 18px;border-radius:8px;
          font-size:14px;font-weight:700;cursor:pointer}
        button.secundar{background:#eee;color:#333}
      </style></head><body>
      <div class="bara-sus">
        <button onclick="window.print()">🖨 Salvează ca PDF / Tipărește</button>
        <button class="secundar" id="btn-inchide">✕ Închide</button>
      </div>
      <div id="nota-inchide" style="display:none;color:#999;font-size:12px;margin:-6px 0 14px">
        Browserul nu lasă pagina să se închidă singură — apasă din nou pe filă/fereastră ca să revii.
      </div>
      ${corp}
      <script>
        document.getElementById("btn-inchide").onclick = function () {
          window.close();
          setTimeout(function () {
            document.getElementById("nota-inchide").style.display = "block";
          }, 250);
        };
      </script>
      </body></html>`);
    w.document.close();
  };

  const capRaport = (titlu, sub) => `
    <h1>${titlu}</h1>
    <div class="cap">${sub}<br>${db.firma?.nume || ""}${db.firma?.siret ? " · " + db.firma.siret : ""}
    · generat ${new Date().toLocaleDateString("ro-RO")}</div>`;

  const raportSantier = (s) => {
    const b = bilant(s);
    const pont = pontajSantier(s.id);
    const cons = consumSantier(s.id);
    const peOm = {};
    pont.forEach((p) => {
      if (!peOm[p.nume]) peOm[p.nume] = { ore: 0, cost: 0, zile: new Set() };
      peOm[p.nume].ore += Number(p.ore) || 0;
      peOm[p.nume].cost += (Number(p.ore) || 0) * (Number(p.tarifOra) || 0);
      peOm[p.nume].zile.add(p.data);
    });
    const peMat = {};
    cons.forEach((c) => {
      const k = (c.nume || "").toLowerCase();
      if (!peMat[k]) peMat[k] = { nume: c.nume, cant: 0, unitate: c.unitate, val: 0 };
      peMat[k].cant += Number(c.cant) || 0;
      peMat[k].val += (Number(c.cant) || 0) * (Number(c.pret) || 0);
    });
    const oreTot = pont.reduce((t, p) => t + (Number(p.ore) || 0), 0);

    const faze = areFaze(s) ? s.faze.map((fz) => ({ fz, b: bilantFaza(s, fz) })) : [];

    deschideRaport(`Raport ${s.nume}`, `
      ${capRaport(s.nume, `${s.client ? s.client + " · " : ""}${s.adresaFull || s.adresa || ""}
        ${s.dataStart ? " · început " + dataRo(s.dataStart) : ""}`)}

      <h2>Bilanț</h2>
      <table>
        <tr><td>Cifrat</td><td class="n">${bani(b.incasat)}</td></tr>
        <tr><td>Manoperă (${(+oreTot.toFixed(1))}h)</td><td class="n">− ${bani(b.manopera)}</td></tr>
        ${b.taxe > 0 ? `<tr><td>Taxe pe salarii</td><td class="n">− ${bani(b.taxe)}</td></tr>` : ""}
        <tr><td>Materiale</td><td class="n">− ${bani(b.materiale)}</td></tr>
        ${b.auto > 0 ? `<tr><td>Auto (combustibil/întreținere)</td><td class="n">− ${bani(b.auto)}</td></tr>` : ""}
        <tr class="tot"><td>Marjă</td><td class="n ${b.marja >= 0 ? "verde" : "rosu"}">
          ${b.marja < 0 ? "−" : ""}${bani(Math.abs(b.marja))}${b.procent !== null ? " · " + b.procent + "%" : ""}</td></tr>
      </table>

      ${faze.length ? `<h2>Pe faze</h2><table>
        <tr><th>Fază</th><th class="n">Ore</th><th class="n">Manoperă</th><th class="n">Materiale</th><th class="n">Marjă</th></tr>
        ${faze.map(({ fz, b: bf }) => `<tr><td>${fz.nume}<div class="mic">${fz.domeniu || ""}</div></td>
          <td class="n">${bf.ore}h</td><td class="n">${bani(bf.manopera)}</td>
          <td class="n">${bani(bf.materiale)}</td>
          <td class="n ${bf.marja >= 0 ? "verde" : "rosu"}">${bf.marja < 0 ? "−" : ""}${bani(Math.abs(bf.marja))}</td></tr>`).join("")}
      </table>` : ""}

      <h2>Cine a lucrat</h2>
      <table>
        <tr><th>Nume</th><th class="n">Zile</th><th class="n">Ore</th><th class="n">Cost</th></tr>
        ${Object.entries(peOm).sort((a, b2) => b2[1].ore - a[1].ore)
          .map(([nume, v]) => `<tr><td>${nume}</td><td class="n">${v.zile.size}</td>
            <td class="n">${+v.ore.toFixed(1)}h</td><td class="n">${bani(v.cost)}</td></tr>`).join("")}
        <tr class="tot"><td>Total</td><td class="n"></td><td class="n">${+oreTot.toFixed(1)}h</td>
          <td class="n">${bani(b.manopera)}</td></tr>
      </table>

      <h2>Materiale consumate</h2>
      <table>
        <tr><th>Material</th><th class="n">Cantitate</th><th class="n">Valoare</th></tr>
        ${Object.values(peMat).sort((a, b2) => b2.val - a.val)
          .map((m) => `<tr><td>${m.nume}</td><td class="n">${m.cant} ${m.unitate}</td>
            <td class="n">${bani(m.val)}</td></tr>`).join("")}
        <tr class="tot"><td>Total</td><td class="n"></td><td class="n">${bani(b.materiale)}</td></tr>
      </table>
    `);
  };

  const raportLunarOm = (an, luna) => {
    const prefix = `${an}-${String(luna).padStart(2, "0")}`;
    const pontLuna = db.pontaj.filter((p) => (p.data || "").startsWith(prefix));
    const supLuna = db.suplimentare.filter((x) => x.status === "aprobat" && (x.data || "").startsWith(prefix));
    const numeLuna = new Date(an, luna - 1, 1).toLocaleDateString("ro-RO", { month: "long", year: "numeric" });

    const peOm = {};
    db.angajati.forEach((a) => { peOm[a.id] = { a, ore: 0, cost: 0, supl: 0, costSupl: 0, peSantier: {}, zile: new Set() }; });
    pontLuna.forEach((p) => {
      if (!peOm[p.angajatId]) return;
      const r = peOm[p.angajatId];
      r.ore += Number(p.ore) || 0;
      r.cost += (Number(p.ore) || 0) * (Number(p.tarifOra) || 0);
      r.zile.add(p.data);
      const sn = db.santiere.find((x) => x.id === p.santierId)?.nume || "—";
      r.peSantier[sn] = (r.peSantier[sn] || 0) + (Number(p.ore) || 0);
      if (p.suplimentar) { r.supl += Number(p.ore) || 0; r.costSupl += (Number(p.ore) || 0) * (Number(p.tarifOra) || 0); }
    });

    const procTaxe = Number(db.setari?.procentTaxe) || 0;
    const randuri = Object.values(peOm).filter((r) => r.ore > 0 || r.supl > 0)
      .map((r) => ({ ...r, costReal: r.cost * (1 + procTaxe / 100) }))
      .sort((a, b) => b.ore - a.ore);
    const totalOre = randuri.reduce((t, r) => t + r.ore, 0);
    const totalCost = randuri.reduce((t, r) => t + r.cost, 0);
    const totalCostReal = randuri.reduce((t, r) => t + r.costReal, 0);

    deschideRaport(`Raport ${numeLuna}`, `
      ${capRaport(`Raport lunar — ${numeLuna}`, `${randuri.length} angajați cu ore înregistrate` +
        (procTaxe > 0 ? ` · ${procTaxe}% taxe pe salarii` : ""))}

      <table>
        <tr><th>Angajat</th><th class="n">Zile</th><th class="n">Ore</th><th class="n">Suplimentare</th>
          <th class="n">Salariu brut</th>${procTaxe > 0 ? '<th class="n">Cost real</th>' : ""}</tr>
        ${randuri.map((r) => `<tr>
          <td>${r.a.nume}<div class="mic">${r.a.grad || ""}</div></td>
          <td class="n">${r.zile.size}</td>
          <td class="n">${+r.ore.toFixed(1)}h</td>
          <td class="n">${r.supl > 0 ? `+${+r.supl.toFixed(1)}h` : "—"}</td>
          <td class="n">${bani(r.cost)}</td>
          ${procTaxe > 0 ? `<td class="n">${bani(r.costReal)}</td>` : ""}
        </tr>`).join("")}
        <tr class="tot"><td>Total</td><td class="n"></td><td class="n">${+totalOre.toFixed(1)}h</td><td class="n"></td>
          <td class="n">${bani(totalCost)}</td>${procTaxe > 0 ? `<td class="n">${bani(totalCostReal)}</td>` : ""}</tr>
      </table>

      <h2>Pe fiecare om, câte ore pe șantier</h2>
      ${randuri.map((r) => `<h2 style="border:none;margin-top:16px;font-size:13px">${r.a.nume}</h2>
        <table><tr><th>Șantier</th><th class="n">Ore</th></tr>
        ${Object.entries(r.peSantier).sort((a, b) => b[1] - a[1])
          .map(([n, o]) => `<tr><td>${n}</td><td class="n">${+o.toFixed(1)}h</td></tr>`).join("")}
        </table>`).join("")}
    `);
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

  /* materialul primit: ori rămâne în depozit, ori pleacă direct pe un șantier
     (caz în care intră ca și consum pe lucrarea aia, nu în stoc) */
  const salvMaterialCuDestinatie = (m, dest) => {
    const nou = m.id ? m : { ...m, id: uid() };
    let materiale = m.id
      ? db.materiale.map((x) => (x.id === m.id ? nou : x))
      : [...db.materiale, nou];

    if (!dest?.santierId) {
      salveaza({ ...db, materiale });
      setFoaie(null);
      return;
    }

    const santier = db.santiere.find((x) => x.id === dest.santierId);
    const cant = Number(nou.cant) || 0;
    const intrare = {
      id: uid(), santierId: dest.santierId, fazaId: dest.fazaId || null,
      materialId: nou.id, nume: nou.nume, cant, unitate: nou.unitate,
      pret: Number(nou.pret) || 0, data: aziISO(),
      motiv: "livrat direct pe șantier",
    };
    /* a plecat tot pe șantier, deci în depozit nu rămâne nimic din livrarea asta */
    materiale = materiale.map((x) => (x.id === nou.id ? { ...x, cant: 0 } : x));

    salveaza(cuJurnal({ ...db, materiale, consum: [intrare, ...db.consum] },
      `${santier?.nume || "Șantier"}: primit direct ${cant} ${nou.unitate} ${nou.nume}`));
    setFoaie(null);
  };
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
      tipMunca: r.tipMunca || null, fazaId: r.fazaId || null, data,
    }));
    const totalOre = intrari.reduce((s, i) => s + i.ore, 0);
    salveaza(cuJurnal({ ...db, pontaj: [...intrari, ...db.pontaj] },
      `Pontaj ${santier.nume}: ${intrari.length} ${intrari.length === 1 ? "om" : "oameni"} · ${totalOre}h`));
    setFoaie(null);
  };
  /* ---------- ore suplimentare, cu aprobarea adminului ---------- */
  const cereSuplimentare = (c) => {
    salveaza({ ...db, suplimentare: [
      { ...c, id: uid(), status: "nou", trimisLa: new Date().toISOString() }, ...db.suplimentare] });
    setFoaie(null);
  };

  const aprobaSuplimentare = (sup) => {
    const angajat = db.angajati.find((a) => a.id === sup.angajatId);
    const santier = db.santiere.find((x) => x.id === sup.santierId);
    /* aprobarea creează pontajul propriu-zis */
    const intrare = {
      id: uid(), santierId: sup.santierId, fazaId: sup.fazaId || null,
      angajatId: sup.angajatId, nume: sup.nume,
      ore: Number(sup.ore) || 0, tarifOra: Number(angajat?.tarifOra) || 0,
      tipMunca: sup.tipMunca || santier?.domeniu || null,
      data: sup.data, suplimentar: true,
    };
    salveaza(cuJurnal({
      ...db,
      pontaj: [intrare, ...db.pontaj],
      suplimentare: db.suplimentare.map((x) =>
        x.id === sup.id
          ? { ...x, status: "aprobat", oreAprobate: Number(sup.ore) || 0,
              notaAdmin: sup.notaAdmin || "", raspunsLa: new Date().toISOString() }
          : x),
    }, `Suplimentare aprobate: ${sup.nume} · ${sup.ore}h pe ${santier?.nume || "șantier"} (${dataRo(sup.data)})`));
  };

  const respingeSuplimentare = (sup, motiv) =>
    salveaza({ ...db, suplimentare: db.suplimentare.map((x) =>
      x.id === sup.id ? { ...x, status: "respins", motiv: motiv || "", raspunsLa: new Date().toISOString() } : x) });

  const stergeSuplimentare = (id) =>
    cere("Ștergi această cerere de ore suplimentare?", () =>
      salveaza({ ...db, suplimentare: db.suplimentare.filter((x) => x.id !== id) }), "Șterge");

  /* ---------- alimentare: muncitorul cere, adminul aprobă ---------- */
  const cereAlimentare = async (c, fisierPoza) => {
    let fotoId = null, fotoData = null;
    if (fisierPoza) {
      try {
        const dataUrl = await comprimaPoza(fisierPoza);
        const r = await salveazaPoza(dataUrl);
        fotoId = r.fotoId; fotoData = r.fotoData;
      } catch (e) { /* trimite oricum, fără poză */ }
    }
    salveaza({ ...db, alimentari: [
      { ...c, id: uid(), fotoId, fotoData, status: "nou", trimisLa: new Date().toISOString() },
      ...db.alimentari] });
    setFoaie(null);
  };

  const aprobaAlimentare = (al, litri, cost) => {
    const camion = db.camioane.find((c) => c.id === al.camionId);
    const intrare = {
      id: uid(), camionId: al.camionId,
      tip: `⛽ Alimentare ${litri} L`, cost, km: al.km || undefined,
      note: al.note || "", santierId: al.santierId || null, data: al.data,
    };
    salveaza(cuJurnal({
      ...db,
      intretinere: [intrare, ...db.intretinere],
      alimentari: db.alimentari.map((x) =>
        x.id === al.id
          ? { ...x, status: "aprobat", litriAprobati: litri, costAprobat: cost, raspunsLa: new Date().toISOString() }
          : x),
    }, `Alimentare aprobată: ${camion?.nume || "vehicul"} · ${litri} L · ${al.nume} (${dataRo(al.data)})`));
  };

  const respingeAlimentare = (al, motiv) =>
    salveaza({ ...db, alimentari: db.alimentari.map((x) =>
      x.id === al.id ? { ...x, status: "respins", motiv: motiv || "", raspunsLa: new Date().toISOString() } : x) });

  const stergeAlimentare = (id) => cere("Ștergi această cerere de alimentare?", async () => {
    const al = db.alimentari.find((x) => x.id === id);
    if (al?.fotoId) { try { await stocare.delete(`foto:${al.fotoId}`, true); } catch (e) {} }
    salveaza({ ...db, alimentari: db.alimentari.filter((x) => x.id !== id) });
  }, "Șterge");

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
      fazaId: c.fazaId || null,
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

  /* umple o săptămână după programul firmei: fiecare echipă merge pe șantierul
     ei, în zilele lucrătoare, la orele standard. Nu suprascrie ce e deja pus. */
  const umpleSaptamana = (luni) => {
    const p = db.setari?.program || {};
    const zileLucru = p.zile || ["MO", "TU", "WE", "TH", "FR"];
    const coduri = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
    const echipeCuSantier = db.echipe
      .map((e) => ({ e, s: db.santiere.find((x) => x.status !== "finalizat" && x.id === e.santierId) }))
      .filter((x) => x.s);

    if (echipeCuSantier.length === 0) {
      cere("Nicio echipă n-are un șantier setat. Pune la fiecare echipă șantierul pe care lucrează (Setări → Oameni → Echipe), apoi încearcă din nou.",
        () => {}, "Am înțeles");
      return;
    }

    const noi = [];
    for (let d = 0; d < 7; d++) {
      if (!zileLucru.includes(coduri[d])) continue;
      const data = iso(adaugaZile(luni, d));
      const pz = programZi(p, coduri[d]);
      echipeCuSantier.forEach(({ e, s: sant }) => {
        const exista = db.planificare.some((x) => x.data === data && x.echipaId === e.id);
        if (exista) return;
        noi.push({
          id: uid(), data, santierId: sant.id, echipaId: e.id, angajatIds: [],
          oraStart: pz.start, oraFinal: pz.final, note: "",
        });
      });
    }

    if (noi.length === 0) {
      cere("Săptămâna e deja completată pentru toate echipele.", () => {}, "Am înțeles");
      return;
    }

    cere(`Pun ${noi.length} zile de lucru după programul firmei? Zilele cu program special (ex. vineri) primesc orele lor. Ce e deja pus nu se atinge.`,
      () => salveaza(cuJurnal({ ...db, planificare: [...db.planificare, ...noi] },
        `Planing generat automat: ${noi.length} intrări`)),
      "Completează");
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
            ? { ...x, status: "rezolvat", rezolvatDe: cine, dataRezolvare: azi(), rezolvatISO: aziISO() }
            : { ...x, status: "deschis", rezolvatDe: null, dataRezolvare: null, rezolvatISO: null }
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
    salveaza({ ...db, cereri: [{ ...c, id: uid(), cand: azi(), candISO: new Date().toISOString(), status: "nou" }, ...db.cereri] });
    setFoaie(null);
  };

  /* adminul trimite materialele cerute: se scad din stoc și intră pe șantier */
  const onoreazaCerere = (cerere) => {
    const santier = db.santiere.find((x) => x.id === cerere.santierId);
    let materiale = [...db.materiale];
    const intrari = [];
    (cerere.linii || []).forEach((l) => {
      const mat = l.materialId ? materiale.find((m) => m.id === l.materialId) : null;
      const cant = Number(l.cant) || 0;
      if (mat) materiale = materiale.map((m) =>
        m.id === mat.id ? { ...m, cant: Math.max(0, Number(m.cant) - cant) } : m);
      if (cerere.santierId)
        intrari.push({
          id: uid(), santierId: cerere.santierId, fazaId: null,
          materialId: mat?.id || null, nume: l.nume, cant,
          unitate: l.unitate, pret: Number(mat?.pret) || 0,
          data: aziISO(), motiv: `cerut de ${cerere.autorNume}`,
          inregistratDe: "Admin",
        });
    });
    salveaza(cuJurnal({
      ...db, materiale,
      consum: [...intrari, ...db.consum],
      cereri: db.cereri.map((x) => (x.id === cerere.id ? { ...x, status: "rezolvat" } : x)),
    }, `Trimis pe ${santier?.nume || "șantier"}: ${(cerere.linii || []).map((l) => `${l.cant} ${l.unitate} ${l.nume}`).join(", ")}`));
  };
  const marcheazaCerere = (id, status) =>
    salveaza({ ...db, cereri: db.cereri.map((c) => (c.id === id
      ? { ...c, status, rezolvatLa: status === "rezolvat" ? new Date().toISOString() : null } : c)) });
  const stergeCerere = stergeGen("cereri", "Ștergi această cerere?");

  /* ---------- derivate ---------- */
  const q = cauta.trim().toLowerCase();
  const filtrat = (lista, campuri) =>
    !q ? lista : lista.filter((x) => campuri.some((c) => (x[c] || "").toLowerCase().includes(q)));
  const numeEchipa = (id) => db.echipe.find((e) => e.id === id)?.nume || "Fără echipă";
  const categoriiMateriale = [...new Set([
    ...(db.categoriiMateriale || []),
    ...db.materiale.map((m) => (m.categorie || "").trim()).filter(Boolean),
  ])].sort((a, b) => a.localeCompare(b, "ro"));

  const categoriiScule = [...new Set([
    ...(db.categoriiScule || []),
    ...db.scule.map((s) => (s.categorie || "").trim()).filter(Boolean),
  ])].sort((a, b) => a.localeCompare(b, "ro"));

  const stocScazut = db.materiale.filter((m) => Number(m.cant) <= Number(m.minim || 0));
  const cereriNoi = db.cereri.filter((c) => c.status === "nou");
  const valMateriale = db.materiale.reduce((s, m) => s + (Number(m.cant) || 0) * (Number(m.pret) || 0), 0);
  const valScule = db.scule.reduce((s, x) => s + (Number(x.pret) || 0), 0);
  const pontajSantier = (sid) => db.pontaj.filter((p) => p.santierId === sid);
  const oreSantier = (sid) => pontajSantier(sid).reduce((s, p) => s + (Number(p.ore) || 0), 0);
  const costSantier = (sid) => pontajSantier(sid).reduce((s, p) => s + (Number(p.ore) || 0) * (Number(p.tarifOra) || 0), 0);
  /* ultima zi în care s-a pontat ceva pe șantier */
  const ultimaZi = (sid) =>
    db.pontaj.filter((p) => p.santierId === sid).map((p) => p.data).sort().pop() || null;

  const consumSantier = (sid) => db.consum.filter((c) => c.santierId === sid);
  const costMaterialeSantier = (sid) =>
    consumSantier(sid).reduce((s, c) => s + (Number(c.cant) || 0) * (Number(c.pret) || 0), 0);
  const sumaMat = (lista) =>
    (lista || []).reduce((t, m) => t + (Number(m.cant) || 0) * (Number(m.pret) || 0), 0);

  /* un șantier poate avea faze cu deviz propriu (demolare, zidărie, tencuială…).
     Dacă are, cifratul și prevederile se adună din faze; dacă nu, rămân cele
     de pe șantier, ca înainte. */
  const areFaze = (s) => Array.isArray(s.faze) && s.faze.length > 0;
  const valoareSantier = (s) =>
    areFaze(s) ? s.faze.reduce((t, f) => t + (Number(f.valoare) || 0), 0) : Number(s.valoare) || 0;
  const orePrevSantier = (s) =>
    areFaze(s) ? s.faze.reduce((t, f) => t + (Number(f.orePrev) || 0), 0) : Number(s.orePrev) || 0;
  const prevMateriale = (s) =>
    areFaze(s) ? s.faze.reduce((t, f) => t + sumaMat(f.materialePrev), 0) : sumaMat(s.materialePrev);

  const pontajFaza = (sid, fid) => pontajSantier(sid).filter((p) => p.fazaId === fid);
  const consumFaza = (sid, fid) => consumSantier(sid).filter((c) => c.fazaId === fid);

  const bilantFaza = (s, f) => {
    const pont = pontajFaza(s.id, f.id);
    const ore = pont.reduce((t, p) => t + (Number(p.ore) || 0), 0);
    const manopera = pont.reduce((t, p) => t + (Number(p.ore) || 0) * (Number(p.tarifOra) || 0), 0);
    const taxe = manopera * (Number(db.setari?.procentTaxe) || 0) / 100;
    const materiale = consumFaza(s.id, f.id).reduce((t, c) => t + (Number(c.cant) || 0) * (Number(c.pret) || 0), 0);
    const incasat = Number(f.valoare) || 0;
    const cost = manopera + taxe + materiale;
    return { ore, manopera, taxe, materiale, cost, incasat, marja: incasat - cost,
      procent: incasat > 0 ? Math.round(((incasat - cost) / incasat) * 100) : null,
      orePrev: Number(f.orePrev) || 0, matPrev: sumaMat(f.materialePrev) };
  };

  const autoSantier = (sid) =>
    db.intretinere.filter((i) => i.santierId === sid).reduce((s, i) => s + (Number(i.cost) || 0), 0);

  const bilant = (s) => {
    const manopera = costSantier(s.id);
    const taxe = manopera * (Number(db.setari?.procentTaxe) || 0) / 100;
    const materiale = costMaterialeSantier(s.id);
    const auto = autoSantier(s.id);
    const cost = manopera + taxe + materiale + auto;
    const incasat = valoareSantier(s);
    return { manopera, taxe, materiale, auto, cost, incasat, marja: incasat - cost,
      procent: incasat > 0 ? Math.round(((incasat - cost) / incasat) * 100) : null };
  };
  const consumNealocat = db.consum.filter((c) => !c.santierId);
  const pierderiTotal = consumNealocat.reduce((s, c) => s + (Number(c.cant) || 0) * (Number(c.pret) || 0), 0);
  const santiereActive = db.santiere.filter((s) => s.status !== "finalizat");
  const costManoperaTotal = db.santiere.reduce((s, x) => s + costSantier(x.id), 0);
  const taxeSalariiTotal = costManoperaTotal * (Number(db.setari?.procentTaxe) || 0) / 100;
  const cifratTotal = db.santiere.reduce((s, x) => s + valoareSantier(x), 0);
  const materialeAlocateTotal = db.santiere.reduce((s, x) => s + costMaterialeSantier(x.id), 0);
  const cheltuieliAutoTotal = db.intretinere.reduce((s, i) => s + (Number(i.cost) || 0), 0);
  const marjaBruta = cifratTotal - costManoperaTotal - taxeSalariiTotal - materialeAlocateTotal - cheltuieliAutoTotal;
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
  /* dacă a intrat cu PIN-ul de firmă, e proprietarul, cu acces total.
     dacă a intrat cu contul lui personal și are un rol de firmă, accesul e restrâns la ce-i dă rolul. */
  const esteProprietar = esteAdmin && !identitate.angajatId;
  /* dacă a intrat cu un cont personal, permisiunile vin din rolul atribuit fișei lui */
  const rolActiv = identitate.angajatId ? (db.roluriFirma || []).find((r) => r.id === eu?.rolFirmaId) : null;
  const permisiuni = esteProprietar ? null : (rolActiv?.permisiuni || {});

  /* fiecare rol vede doar taburile pentru care are cel puțin o bifă relevantă */
  const idTaburiPermise = esteProprietar ? null : [
    permisiuni.panou && "panou",
    (permisiuni.santiere || permisiuni.santiereEditare) && "santiere",
    permisiuni.planing && "planing",
    (permisiuni.stocMateriale || permisiuni.stocScule || permisiuni.stocAuto) && "inventar",
    permisiuni.cereri && "cereri",
    "setari", // mereu accesibil — aici stă și butonul de ieșire din cont
  ].filter(Boolean);
  /* dacă tabul curent nu e permis rolului, cad pe primul tab permis */
  const tabEfectiv = (!idTaburiPermise || idTaburiPermise.includes(tab)) ? tab : idTaburiPermise[0];

  /* ==================== PRIMA CONFIGURARE ==================== */
  if (esteAdmin && !db.firma?.nume)
    return (
      <div className="app"><style>{css}</style>
        <ConfigurareFirma
          onSalveaza={(firma) => salveaza(cuJurnal({ ...db, firma }, `Firmă configurată: ${firma.nume}`))}
          onIesi={() => setIdent(null)} />
      </div>
    );

  /* ==================== VEDEREA MUNCITORULUI ==================== */
  if (!esteAdmin) {
    const eBirou = eu?.tip === "birou";
    /* biroul nu are tab "azi" — dacă a rămas pe valoarea implicită, îl trec pe Planing */
    const tabMEfectiv = eBirou && !["planing", "cereri"].includes(tabM) ? "planing" : tabM;
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

    /* orele lui, calculate doar dacă adminul le lasă vizibile */
    const oreVizibile = db.setari?.oreVizibileMuncitori ?? true;
    const oreleMele = db.pontaj.filter((p) => p.angajatId === identitate.angajatId);
    const totalOreMele = oreleMele.reduce((s, p) => s + (Number(p.ore) || 0), 0);
    const peSantierOre = {};
    const peTipOre = {};
    oreleMele.forEach((p) => {
      const n = db.santiere.find((s) => s.id === p.santierId)?.nume || t("Șantier șters");
      peSantierOre[n] = (peSantierOre[n] || 0) + (Number(p.ore) || 0);
      const tp = p.tipMunca || "—";
      peTipOre[tp] = (peTipOre[tp] || 0) + (Number(p.ore) || 0);
    });
    const luna30Mele = oreleMele
      .filter((p) => p.data >= iso(adaugaZile(new Date(), -30)))
      .reduce((s, p) => s + (Number(p.ore) || 0), 0);

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
          {(s?.adresaFull || s?.adresa) && (
            <div className="actiuni">
              <ButonHarta adresa={s.adresaFull || s.adresa} />
              {s.adresaFull && (
                <span className="sub" style={{ alignSelf: "center", marginTop: 0 }}>{s.adresaFull}</span>
              )}
            </div>
          )}
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
            <h1>{db.firma?.nume || <>Șantier <span>Manager</span></>}</h1>
            <span className="rol-chip static">{eu?.nume?.split(" ")[0] || "👷"}</span>
          </div>
          <div className="hazard" />
        </div>

        <div className="continut">

          {/* ---------- AZI ---------- */}
          {tabM === "azi" && !eBirou && (
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
          {tabM === "scule" && !eBirou && (
            <>
              {db.scule.filter((x) => x.comun).length > 0 && (
                <>
                  <div className="sectiune">🔧 Utilaje comune</div>
                  <div className="sub" style={{ marginBottom: 10 }}>Se mută între echipe.</div>
                  {db.scule.filter((x) => x.comun).map((s) => {
                    const laEchipa = s.echipaId === eu?.echipaId;
                    return (
                      <div className="card" key={s.id}>
                        <div className="card-rand">
                          <div>
                            <div className="titlu">{s.nume}</div>
                            <div className="sub">
                              {s.stare === "alocat"
                                ? <>La <b style={{ color: laEchipa ? "var(--verde)" : "var(--text)" }}>
                                    {laEchipa ? "voi" : numeEchipa(s.echipaId)}</b> din {s.dataAlocare}</>
                                : s.stare === "service" ? "În service"
                                : s.stare === "problema" ? "Cu problemă"
                                : "În depozit — liber"}
                            </div>
                          </div>
                          <span className={"chip " + (s.stare === "problema" ? "alerta" : s.stare)}>
                            {s.stare === "alocat" ? (laEchipa ? "La voi" : "Ocupat") : s.stare === "service" ? "Service"
                              : s.stare === "problema" ? "Problemă" : "Liber"}
                          </span>
                        </div>
                        {!laEchipa && s.stare !== "problema" && s.stare !== "service" && (
                          <div className="actiuni">
                            <button className="btn btn-mic"
                              onClick={() => trimiteCerere({
                                tip: "necesar",
                                text: `Ne trebuie ${s.nume}${s.stare === "alocat" ? `, e acum la ${numeEchipa(s.echipaId)}` : ""}.`,
                                santierId: eu?.echipaId ? (db.santiere.find((x) => x.id === echipaMea?.santierId)?.id || null) : null,
                                santierNume: echipaMea?.nume ? db.santiere.find((x) => x.id === echipaMea?.santierId)?.nume || null : null,
                                linii: [], dataCeruta: null, oameniCeruti: null,
                                autorId: eu?.id || null, autorNume: eu?.nume || "Necunoscut",
                              })}>
                              Cer utilajul ăsta
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              )}

              {(() => {
                const camioaneEchipa = db.camioane.filter((c) => (echipaMea?.camioaneIds || []).includes(c.id));
                const aleMeleAlimentari = db.alimentari.filter((x) => x.autorId === identitate.angajatId);
                if (camioaneEchipa.length === 0 && aleMeleAlimentari.length === 0) return null;
                return (
                  <>
                    {camioaneEchipa.length > 0 && (
                      <>
                        <div className="sectiune">🚛 Camionul echipei</div>
                        {camioaneEchipa.map((c) => (
                          <div className="card" key={c.id}>
                            <div className="card-rand">
                              <div>
                                <div className="titlu">{c.nume}</div>
                                <div className="sub">
                                  {c.numar && <><span className="mono">{c.numar}</span> · </>}
                                  {c.km && <>{Number(c.km).toLocaleString("ro-RO")} km</>}
                                </div>
                              </div>
                            </div>
                            <div className="actiuni">
                              <button className="btn btn-mic principal"
                                onClick={() => setFoaie({ tip: "cerereAlimentare", item: c })}>
                                ⛽ Am făcut plinul
                              </button>
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                    {aleMeleAlimentari.length > 0 && (
                      <>
                        <div className="sectiune">Alimentările tale</div>
                        {aleMeleAlimentari.slice(0, 5).map((x) => {
                          const cm = db.camioane.find((c) => c.id === x.camionId);
                          return (
                            <div className="card" key={x.id}>
                              <div className="card-rand">
                                <div>
                                  <div className="titlu">{cm?.nume || "—"} · <b className="mono">{x.litri} L</b></div>
                                  <div className="sub">
                                    {dataRo(x.data)} · cerut {bani(x.cost)}
                                    {x.status === "respins" && x.motiv && (
                                      <><br /><span style={{ color: "var(--rosu)" }}>Refuzat: {x.motiv}</span></>
                                    )}
                                  </div>
                                </div>
                                <span className={"chip " + (x.status === "aprobat" ? "ok" : x.status === "respins" ? "alerta" : "alocat")}>
                                  {x.status === "aprobat" ? "Aprobată" : x.status === "respins" ? "Refuzată" : "În așteptare"}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </>
                );
              })()}

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
          {tabM === "materiale" && !eBirou && eu?.poateStoc && (() => {
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
          {tabM === "ore" && !eBirou && oreVizibile && (
            <>
              <div className="rezumat">
                <div>
                  <div className="rz-nr mono">{totalOreMele}h</div>
                  <div className="rz-lbl">{t("Total:")} toate lucrările</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="rz-nr mono" style={{ color: "var(--galben)" }}>{luna30Mele}h</div>
                  <div className="rz-lbl">ultimele 30 de zile</div>
                </div>
              </div>
              {totalOreMele === 0 ? (
                <div className="gol-msg">Nu ai încă ore pontate. Șeful le trece după fiecare zi de lucru.</div>
              ) : (
                <>
                  <div className="sectiune">Pe șantier</div>
                  {Object.entries(peSantierOre).sort((a, b) => b[1] - a[1]).map(([n, o]) => (
                    <div className="card" key={n} style={{ padding: "12px 14px" }}>
                      <div className="card-rand">
                        <div className="titlu" style={{ fontSize: 14 }}>🏗 {n}</div>
                        <b className="mono">{o}h</b>
                      </div>
                      <div className="bara"><div className="bara-fill"
                        style={{ width: `${(o / totalOreMele) * 100}%`, background: "var(--galben)" }} /></div>
                    </div>
                  ))}
                  <div className="sectiune">Ce ai lucrat</div>
                  {Object.entries(peTipOre).sort((a, b) => b[1] - a[1]).map(([n, o]) => (
                    <div className="fisa-rand" key={n}>
                      <span>{n}</span>
                      <b className="mono">{o}h · {Math.round((o / totalOreMele) * 100)}%</b>
                    </div>
                  ))}
                </>
              )}
            </>
          )}

          {tabMEfectiv === "planing" && eBirou && (() => {
            const luni = luniaSaptamanii(saptamana);
            const zile = [...Array(7)].map((_, i) => adaugaZile(luni, i));
            const eticheta = `${luni.getDate()} ${luni.toLocaleDateString("ro-RO", { month: "short" })} – ${adaugaZile(luni, 6).getDate()} ${adaugaZile(luni, 6).toLocaleDateString("ro-RO", { month: "short" })}`;
            return (
              <>
                <div className="nav-sapt">
                  <button className="btn btn-mic" onClick={() => setSaptamana(saptamana - 1)}>‹</button>
                  <div>
                    <div className="ns-titlu">{saptamana === 0 ? "Săptămâna asta" : saptamana === 1 ? "Săptămâna viitoare" : saptamana === -1 ? "Săptămâna trecută" : eticheta}</div>
                    <div className="ns-sub mono">{eticheta}</div>
                  </div>
                  <button className="btn btn-mic" onClick={() => setSaptamana(saptamana + 1)}>›</button>
                </div>
                {saptamana !== 0 && (
                  <button className="btn btn-mic" style={{ marginBottom: 12 }} onClick={() => setSaptamana(0)}>Săptămâna asta</button>
                )}

                {zile.map((d, i) => {
                  const zi = iso(d);
                  const intrari = db.planificare
                    .filter((p) => p.data === zi)
                    .sort((a, b) => (minute(a.oraStart) || 0) - (minute(b.oraStart) || 0));
                  const eAzi = zi === iso(new Date());
                  return (
                    <div className="zi-plan" key={zi}>
                      <div className="zi-antet">
                        <div>
                          <b style={{ color: eAzi ? "var(--galben)" : "var(--text)" }}>{zileTrad()[i]}</b>
                          <span className="mono" style={{ color: "var(--mut)", fontSize: 12, marginLeft: 7 }}>
                            {d.getDate()}.{String(d.getMonth() + 1).padStart(2, "0")}
                          </span>
                        </div>
                      </div>
                      {intrari.length === 0 ? (
                        <div className="zi-gol">—</div>
                      ) : intrari.map((p) => {
                        const s = db.santiere.find((x) => x.id === p.santierId);
                        const ech = db.echipe.find((x) => x.id === p.echipaId);
                        const oameni = (p.angajatIds || []).map((id) => db.angajati.find((a) => a.id === id)?.nume).filter(Boolean);
                        return (
                          <div className="plan-item" key={p.id}>
                            <div className="pi-cap">
                              <div className="titlu" style={{ fontSize: 14 }}>🏗 {s ? s.nume : "Șantier șters"}</div>
                              <span className="chip alocat mono">{interval(p)}</span>
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

                <button className="btn btn-galben" style={{ marginTop: 6 }}
                  onClick={() => setFoaie({ tip: "cerere", tipInitial: "planing" })}>
                  🗓 Cere o modificare de planing
                </button>
              </>
            );
          })()}

          {tabMEfectiv === "cereri" && (
            <>
              <div className="card">
                <div className="titlu">{eBirou ? "🏢 " : "✉ "}{eBirou ? eu?.nume : t("Probleme și necesar")}</div>
                <div className="sub">
                  {eBirou
                    ? "Ești la birou, nu pe șantier — de-aia vezi doar ecranul ăsta. Scrii aici orice are nevoie de atenția șefului."
                    : t("Mesajul ajunge doar la admin.")}
                </div>
              </div>
              <button className="btn btn-galben" onClick={() => setFoaie({ tip: "cerere" })}>
                {t("+ Raportează o problemă / cere ceva")}
              </button>
              {!eBirou && (
                <button className="btn btn-mic" style={{ width: "100%", marginTop: 9 }}
                  onClick={() => setFoaie({ tip: "suplimentare", santiere: pentruConsum })}>
                  ⏱ Am stat peste program
                </button>
              )}

              {!eBirou && (() => {
                const aleMele = db.suplimentare.filter((x) => x.angajatId === identitate.angajatId);
                if (aleMele.length === 0) return null;
                return (
                  <>
                    <div className="sectiune">Orele tale suplimentare</div>
                    {aleMele.map((x) => {
                      const sn = db.santiere.find((y) => y.id === x.santierId);
                      return (
                        <div className="card" key={x.id}>
                          <div className="card-rand">
                            <div>
                              <div className="titlu"><b className="mono">{x.ore}h</b> · {dataRo(x.data)}</div>
                              <div className="sub">
                                {sn?.nume || "—"}
                                {x.motivCerere && <><br />{x.motivCerere}</>}
                                {x.status === "respins" && x.motiv && (
                                  <><br /><span style={{ color: "var(--rosu)" }}>Refuzat: {x.motiv}</span></>
                                )}
                              </div>
                            </div>
                            <span className={"chip " + (x.status === "aprobat" ? "ok" : x.status === "respins" ? "alerta" : "alocat")}>
                              {x.status === "aprobat" ? "Aprobate" : x.status === "respins" ? "Refuzate" : "În așteptare"}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </>
                );
              })()}
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
                      <div className="titlu">{etichetaCerere(c.tip)}</div>
                      <div className="sub">
                        {c.santierNume && <>🏗 {c.santierNume}<br /></>}
                        {c.dataCeruta && (
                          <>{c.tip === "resurse" && c.oameniCeruti ? `${c.oameniCeruti} ${c.oameniCeruti === 1 ? "om" : "oameni"} · ` : ""}
                          Pentru {dataRo(c.dataCeruta)}<br /></>
                        )}
                        {c.text}<br /><span className="mono">{c.cand}</span>
                      </div>
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
        {foaie?.tip === "cerereAlimentare" && (
          <FormCerereAlimentare camion={foaie.item} santiere={pentruConsum}
            onTrimite={(c, poza) => cereAlimentare({ ...c, camionId: foaie.item.id, autorId: eu?.id, nume: eu?.nume }, poza)}
            onClose={() => setFoaie(null)} />
        )}
        {foaie?.tip === "raportScula" && (
          <RaportScula scula={foaie.item} numeleMeu={eu?.nume}
            onSalveaza={(tip, note) => raporteazaScula(foaie.item.id, tip, note, eu?.nume)}
            onClose={() => setFoaie(null)} />
        )}
        {foaie?.tip === "suplimentare" && (
          <FormSuplimentare eu={eu} santiere={foaie.santiere} program={db.setari?.program}
            onTrimite={cereSuplimentare} onClose={() => setFoaie(null)} />
        )}
        {foaie?.tip === "cerere" && (
          <FormCerere eu={eu} santiere={pentruConsum} materiale={db.materiale}
            tipInitial={foaie.tipInitial} onTrimite={trimiteCerere} onClose={() => setFoaie(null)} />
        )}

        <Confirmare intrebare={intrebare} onInchide={() => setIntrebare(null)} />

        <nav className="nav">
          {(eBirou ? [
            ["planing", "🗓", "Planing", 0],
            ["cereri", "✉", t("Cereri"), cereriDeschise.length],
          ] : [
            ["azi", "🗓", t("Azi"), sarciniDeschise.length],
            ["scule", "🔧", "Scule", 0],
            ...(eu?.poateStoc ? [["materiale", "📦", "Materiale", 0]] : []),
            ...(oreVizibile ? [["ore", "⏱", t("Orele tale"), 0]] : []),
            ["cereri", "✉", t("Cereri"),
              cereriDeschise.length +
              db.suplimentare.filter((x) => x.angajatId === identitate.angajatId && x.status === "nou").length +
              db.alimentari.filter((x) => x.autorId === identitate.angajatId && x.status === "nou").length],
          ]).map(([id, ico, lbl, badge]) => (
            <button key={id} className={tabMEfectiv === id ? "activ" : ""} onClick={() => setTabM(id)}>
              {badge > 0 && <span className="bulina">{badge}</span>}
              <span className="ico">{ico}</span>{lbl}
            </button>
          ))}
        </nav>
      </div>
    );
  }

  /* ==================== VEDEREA ADMINULUI ==================== */
  if (!esteProprietar && idTaburiPermise.length === 0)
    return (
      <div className="app"><style>{css}</style>
        <div className="intrare">
          <h1>Șantier <span>Manager</span></h1>
          <div className="hazard" />
          <div className="gol-msg">
            Contul tău nu are niciun rol activ, sau rolul a fost șters. Cere-i proprietarului
            să-ți atribuie un rol din fișa ta.
          </div>
          <button className="btn btn-mic" onClick={() => setIdent(null)}>Ieși din cont</button>
        </div>
      </div>
    );

  return (
    <div className="app"><style>{css}</style>
      <div className="antet">
        <div className="antet-rand">
          <h1>{db.firma?.nume || <>Șantier <span>Manager</span></>}</h1>
          <span className="rol-chip static">{esteProprietar ? "Admin" : (rolActiv?.nume || "Admin")}</span>
        </div>
        <div className="hazard" />
      </div>

      <div className="continut">
        {eroareSalvare && <div className="conflict" style={{ marginBottom: 12 }}><b>⚠ {eroareSalvare}</b></div>}

        {/* ---------- PANOU ---------- */}
        {tabEfectiv === "panou" && (
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
                    onClick={() => { setTab("inventar"); setSubInv("camioane"); }}>
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

            {(() => {
              /* zile în care cineva are mult peste programul normal — probabil pontaj dublu */
              const pragBaza = oreDinProgram(programZi(db.setari?.program, "MO")) || 8;
              const peZiOm = {};
              db.pontaj.forEach((p) => {
                if (!p.angajatId || !p.data) return;
                const k = p.angajatId + "|" + p.data;
                if (!peZiOm[k]) peZiOm[k] = { nume: p.nume, data: p.data, ore: 0, intrari: 0 };
                peZiOm[k].ore += Number(p.ore) || 0;
                peZiOm[k].intrari += 1;
              });
              const suspecte = Object.values(peZiOm)
                .filter((x) => x.intrari > 1 && x.ore > pragBaza + 4)
                .sort((a, b) => b.data.localeCompare(a.data))
                .slice(0, 5);
              if (suspecte.length === 0) return null;
              return (
                <>
                  <div className="sectiune">⚠ Posibil pontaj dublu</div>
                  {suspecte.map((x, i) => (
                    <div className="card alerta-card expirat" key={i}>
                      <div className="card-rand">
                        <div>
                          <div className="titlu">{x.nume}</div>
                          <div className="sub">
                            {dataRo(x.data)} · <b className="mono">{+x.ore.toFixed(1)}h</b> în{" "}
                            {x.intrari} pontaje separate
                          </div>
                        </div>
                        <span className="chip alerta">verifică</span>
                      </div>
                    </div>
                  ))}
                  <div className="sub" style={{ marginBottom: 6 }}>
                    Poate fi corect (a lucrat pe două șantiere), dar merită verificat —
                    intri pe șantier → Detalii → Intrări pontaj și ștergi ce e în plus.
                  </div>
                </>
              );
            })()}

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
                        <div className="titlu">{etichetaCerere(c.tip)} · {c.autorNume}</div>
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
                        <div className="sub">
                          Stoc: <b className="mono">{m.cant} {m.unitate}</b> · minim {m.minim}
                          {m.pret > 0 && <> · {bani(m.pret)}/{m.unitate}</>}
                        </div>
                      </div>
                      <span className="chip alerta">Stoc scăzut</span>
                    </div>
                    <div className="actiuni">
                      <button className="btn btn-mic principal"
                        onClick={() => setFoaie({ tip: "aprovizionare", item: m })}>
                        + Am cumpărat
                      </button>
                    </div>
                  </div>
                ))}
                <button className="btn btn-mic" style={{ width: "100%" }}
                  onClick={() => { setTab("inventar"); setSubInv("materiale"); setFoaie({ tip: "material" }); }}>
                  + Material nou în stoc
                </button>
              </>
            )}



          </>
        )}

        {/* ---------- INVENTAR ---------- */}
        {tabEfectiv === "inventar" && (() => {
          const poateMat = esteProprietar || !!permisiuni.stocMateriale;
          const poateScu = esteProprietar || !!permisiuni.stocScule;
          const poateAuto = esteProprietar || !!permisiuni.stocAuto;
          const subInvPermis = (subInv === "materiale" && poateMat) || (subInv === "scule" && poateScu) || (subInv === "camioane" && poateAuto)
            ? subInv
            : (poateMat && "materiale") || (poateScu && "scule") || (poateAuto && "camioane") || "materiale";
          return (
          <>
            <div className="subtab">
              {poateMat && (
                <button className={subInvPermis === "materiale" ? "activ" : ""}
                  onClick={() => { setSubInv("materiale"); setFiltruCat(""); }}>Materiale</button>
              )}
              {poateScu && (
                <button className={subInvPermis === "scule" ? "activ" : ""}
                  onClick={() => { setSubInv("scule"); setFiltruCat(""); }}>Scule</button>
              )}
              {poateAuto && (
                <button className={subInvPermis === "camioane" ? "activ" : ""}
                  onClick={() => { setSubInv("camioane"); setFiltruCat(""); }}>
                  Auto{alerteCamioane.length > 0 && ` (${alerteCamioane.length})`}
                </button>
              )}
            </div>
            {subInvPermis !== "camioane" && (
              <input className="cautare" placeholder="Caută…" value={cauta} onChange={(e) => setCauta(e.target.value)} />
            )}

            {subInvPermis === "materiale" && (
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
                {(() => {
                  const cats = [...new Set(db.materiale.map((m) => (m.categorie || "").trim()).filter(Boolean))].sort();
                  if (cats.length === 0) return null;
                  return (
                    <div className="filtre">
                      <button className={!filtruCat ? "activ" : ""} onClick={() => setFiltruCat("")}>Toate</button>
                      {cats.map((c) => (
                        <button key={c} className={filtruCat === c ? "activ" : ""}
                          onClick={() => setFiltruCat(filtruCat === c ? "" : c)}>{c}</button>
                      ))}
                    </div>
                  );
                })()}
                {filtrat(db.materiale, ["nume", "categorie", "locatie"])
                  .filter((m) => !filtruCat || (m.categorie || "").trim() === filtruCat)
                  .sort((a, b) => {
                    const sa = Number(a.cant) <= Number(a.minim || 0) ? 0 : 1;
                    const sb = Number(b.cant) <= Number(b.minim || 0) ? 0 : 1;
                    return sa - sb || a.nume.localeCompare(b.nume, "ro");
                  })
                  .map((m) => {
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

            {subInvPermis === "scule" && (
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

                {(() => {
                  const comune = db.scule.filter((x) => x.comun);
                  if (comune.length === 0) return null;
                  return (
                    <>
                      <div className="sectiune">🔧 Utilaje comune</div>
                      <div className="sub" style={{ marginBottom: 10 }}>
                        Se mută între echipe. Oricine vede cine îl are acum.
                      </div>
                      {comune.map((s) => (
                        <div className="card" key={s.id}>
                          <div className="card-rand">
                            <div>
                              <div className="titlu">{s.nume}</div>
                              <div className="sub">
                                {s.stare === "alocat" ? <>La <b>{numeEchipa(s.echipaId)}</b> din {s.dataAlocare}</>
                                  : s.stare === "service" ? "În service" : s.stare === "problema" ? "Cu problemă"
                                  : "În depozit — liber"}
                              </div>
                            </div>
                            <span className={"chip " + (s.stare === "problema" ? "alerta" : s.stare)}>
                              {s.stare === "alocat" ? "Ocupat" : s.stare === "service" ? "Service"
                                : s.stare === "problema" ? "Problemă" : "Liber"}
                            </span>
                          </div>
                          <div className="actiuni">
                            <button className="btn btn-mic principal" onClick={() => setFoaie({ tip: "aloca", item: s })}>
                              Transferă
                            </button>
                            {s.stare === "alocat" && (
                              <button className="btn btn-mic" onClick={() => returneazaScula(s.id)}>Eliberează</button>
                            )}
                          </div>
                        </div>
                      ))}
                    </>
                  );
                })()}

                {(() => {
                  const cats = [...new Set(db.scule.filter((x) => !x.comun).map((x) => (x.categorie || "").trim()).filter(Boolean))].sort();
                  if (cats.length === 0) return null;
                  return (
                    <div className="filtre">
                      <button className={!filtruCat ? "activ" : ""} onClick={() => setFiltruCat("")}>Toate</button>
                      {cats.map((c) => (
                        <button key={c} className={filtruCat === c ? "activ" : ""}
                          onClick={() => setFiltruCat(filtruCat === c ? "" : c)}>{c}</button>
                      ))}
                    </div>
                  );
                })()}
                {filtrat(db.scule.filter((x) => !x.comun), ["nume", "cod", "categorie"])
                  .filter((x) => !filtruCat || (x.categorie || "").trim() === filtruCat)
                  .sort((a, b) => {
                    const ord = { problema: 0, service: 1, alocat: 2, depozit: 3 };
                    return (ord[a.stare] ?? 9) - (ord[b.stare] ?? 9) || a.nume.localeCompare(b.nume, "ro");
                  })
                  .map((s) => (
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

            {subInvPermis === "camioane" && (
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
                                    cheltuieli totale: <b>{bani(costTotal)}</b>
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
                                <button className="btn btn-mic principal" onClick={() => setFoaie({ tip: "alimentare", item: c })}>⛽ Alimentare</button>
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

          </>
          );
        })()}

        {/* ---------- OAMENI ---------- */}
        {tabEfectiv === "setari" && (
          <>
            {!subSet && (
              <div className="meniu-set">
                {(() => {
                  const sectiuni = SECTIUNI_SETARI.filter(([id]) => {
                    if (esteProprietar) return true;
                    if (id === "cifre") return !!permisiuni.cifre;
                    if (id === "rapoarte") return !!permisiuni.rapoarte;
                    if (id === "dotare") return !!permisiuni.dotare;
                    if (id === "oameni") return !!permisiuni.oameni;
                    if (id === "categorii" || id === "categoriiScule")
                      return !!permisiuni.stocMateriale || !!permisiuni.stocScule;
                    return false; // cont, invitații, backup, roluri — doar proprietarul
                  });
                  if (sectiuni.length === 0)
                    return (
                      <div className="sub" style={{ marginBottom: 12 }}>
                        Rolul tău nu are acces la nicio secțiune din Setări.
                      </div>
                    );
                  return sectiuni.map(([id, ico, lbl, desc]) => (
                    <button key={id} onClick={() => { setSubSet(id); setCauta(""); }}>
                      <span>{ico}</span>
                      <div style={{ flex: 1 }}>{lbl}<span className="ms-desc">{desc}</span></div>
                      <span className="ms-sageata">›</span>
                    </button>
                  ));
                })()}
                <button className="meniu-iesire" onClick={() => setIdent(null)}>
                  <span>🚪</span>Ieși din cont
                </button>
              </div>
            )}
            {subSet && (
              <button className="btn-inapoi" onClick={() => { setSubSet(null); setCauta(""); }}>
                ‹ Setări<span>{SECTIUNI_SETARI.find((x) => x[0] === subSet)?.[2]}</span>
              </button>
            )}
          </>
        )}

        {tabEfectiv === "setari" && subSet === "oameni" && (
          <>
            <div className="subtab">
              <button className={subOam === "angajati" ? "activ" : ""} onClick={() => setSubOam("angajati")}>Angajați</button>
              <button className={subOam === "echipe" ? "activ" : ""} onClick={() => setSubOam("echipe")}>Echipe</button>
            </div>

            {subOam === "angajati" && (
              <>
                <input className="cautare" placeholder="Caută angajat…" value={cauta} onChange={(e) => setCauta(e.target.value)} />
                {(esteProprietar || permisiuni.oameniEditare) && (
                  <button className="btn btn-galben" onClick={() => setFoaie({ tip: "angajat" })}>+ Adaugă angajat</button>
                )}
                {!esteProprietar && !permisiuni.oameniEditare && (
                  <div className="sub" style={{ marginBottom: 10 }}>
                    Vezi fișele, dar nu le poți modifica — rolul tău nu are voie.
                  </div>
                )}
                <div style={{ height: 12 }} />
                {filtrat(db.angajati, ["nume", "grad"]).map((a) => (
                  <div className="card apasabil" key={a.id} onClick={() => setFoaie({ tip: "fisa", item: a })}>
                    <div className="card-rand">
                      <div>
                        <div className="titlu">{a.nume}</div>
                        <div className="sub">
                          {a.tip === "birou" ? "🏢 " : ""}{a.grad || "—"}
                          {a.tip !== "birou" && <> · {numeEchipa(a.echipaId)}</>}
                          {a.rolFirmaId && <><br /><span style={{ color: "var(--galben)" }}>🔑 {numeRol(db.roluriFirma, a.rolFirmaId)}</span></>}
                        </div>
                      </div>
                      <span className={"chip " + (a.tip === "birou" ? "gri" : "gri")}>Fișă →</span>
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
                  const santierEi = db.santiere.find((x) => x.id === e.santierId);
                  const camioaneEi = db.camioane.filter((c) => (e.camioaneIds || []).includes(c.id));
                  return (
                    <div className="card" key={e.id}>
                      <div className="card-rand">
                        <div>
                          <div className="titlu">{e.nume}</div>
                          <div className="sub">
                            {santierEi ? `🏗 ${santierEi.nume}` : "Fără șantier fix"} · {membri.length} oameni
                            {camioaneEi.length > 0 && <> · 🚛 {camioaneEi.map((c) => c.nume).join(", ")}</>}
                          </div>
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
        {tabEfectiv === "santiere" && (
          <>
            {(esteProprietar || permisiuni.santiereEditare) && (
              <button className="btn btn-galben" onClick={() => setFoaie({ tip: "santier" })}>+ Adaugă șantier</button>
            )}
            {!esteProprietar && !permisiuni.santiereEditare && (
              <div className="sub" style={{ marginBottom: 10 }}>
                Vezi cifrele fiecărui șantier. Rolul tău nu are voie să modifice nimic aici.
              </div>
            )}
            <div style={{ height: 12 }} />
            <div className="filtre">
              {[["activitate", "Ultima activitate"], ["marja", "Marjă"], ["nume", "Nume"],
                ["valoare", "Valoare"], ["finalizate", "Finalizate"]].map(([id, et]) => (
                <button key={id} className={sortSant === id ? "activ" : ""}
                  onClick={() => setSortSant(id)}>{et}</button>
              ))}
            </div>
            {db.santiere
              .filter((s) => sortSant === "finalizate" ? s.status === "finalizat" : s.status !== "finalizat")
              .sort((a, b) => {
                if (sortSant === "marja") return bilant(b).marja - bilant(a).marja;
                if (sortSant === "nume") return a.nume.localeCompare(b.nume, "ro");
                if (sortSant === "valoare") return valoareSantier(b) - valoareSantier(a);
                return (ultimaZi(b.id) || "").localeCompare(ultimaZi(a.id) || "");
              })
              .map((s) => {
              const ore = oreSantier(s.id);
              const oameni = new Set(pontajSantier(s.id).map((p) => p.angajatId || p.nume)).size;
              const finalizat = s.status === "finalizat";
              const b = bilant(s);
              const orePrev = orePrevSantier(s);
              const matPrev = prevMateriale(s);
              const nrFaze = areFaze(s) ? s.faze.length : 0;
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
                        {nrFaze > 0 && <> · <span style={{ color: "var(--galben)" }}>{nrFaze} faze</span></>}
                        {(() => {
                          const uz = ultimaZi(s.id);
                          if (!uz) return <><br /><span style={{ color: "var(--mut)" }}>nimeni n-a lucrat încă aici</span></>;
                          const z = Math.floor((Date.now() - new Date(uz).getTime()) / 86400000);
                          const cul = z >= 14 ? "var(--rosu)" : z >= 7 ? "var(--galben)" : "var(--mut)";
                          return <><br /><span style={{ color: cul }}>
                            {z === 0 ? "s-a lucrat azi" : z === 1 ? "ultima dată ieri" : `ultima dată acum ${z} zile`}
                          </span></>;
                        })()}
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
                      <div className="pr-prev">
                        {oameni} {oameni === 1 ? "om" : "oameni"}
                        {b.taxe > 0 && <> · +{bani(b.taxe)} taxe</>}
                      </div>
                    </div>
                  </div>
                  <div className="actiuni">
                    {(esteProprietar || permisiuni.santiereEditare) && !finalizat && db.angajati.length > 0 && (
                      <button className="btn btn-mic principal" onClick={() => setFoaie({ tip: "pontaj", item: s })}>+ Pontaj</button>
                    )}
                    {(esteProprietar || permisiuni.santiereEditare) && !finalizat && (
                      <button className="btn btn-mic principal" onClick={() => setFoaie({ tip: "consum", item: s })}>+ Material</button>
                    )}
                    {(s.adresaFull || s.adresa) && <ButonHarta adresa={s.adresaFull || s.adresa} mic />}
                    {(esteProprietar || permisiuni.santiereEditare) && (
                      <button className="btn btn-mic" onClick={() => setFoaie({ tip: "sarcini", item: s })}>
                        📷 De rezolvat{db.sarcini.filter((x) => x.santierId === s.id && x.status === "deschis").length > 0
                          ? ` (${db.sarcini.filter((x) => x.santierId === s.id && x.status === "deschis").length})` : ""}
                      </button>
                    )}
                    {finalizat && (
                      <button className="btn btn-mic principal" onClick={() => raportSantier(s)}>
                        📄 Raport PDF
                      </button>
                    )}
                    <button className="btn btn-mic" onClick={() => setFoaie({ tip: "detaliiSantier", item: s })}>Detalii</button>
                    {(esteProprietar || permisiuni.santiereEditare) && (
                      <>
                        <button className="btn btn-mic" onClick={() => setFoaie({ tip: "santier", item: s })}>Modifică</button>
                        <button className="btn btn-mic" onClick={() => salvSantier({ ...s, status: finalizat ? "activ" : "finalizat" })}>
                          {finalizat ? "Redeschide" : "Finalizează"}
                        </button>
                        <button className="btn btn-mic pericol" onClick={() => stergeSantier(s.id)}>Șterge</button>
                      </>
                    )}
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
        {tabEfectiv === "planing" && (() => {
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
                <button className="btn btn-mic principal" onClick={() => umpleSaptamana(luni)}>
                  ⚡ Completează după program
                </button>
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
                          {(s?.adresaFull || s?.adresa) && (
                            <div style={{ marginTop: 7 }}>
                              <ButonHarta adresa={s.adresaFull || s.adresa} mic />
                            </div>
                          )}
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
        {tabEfectiv === "setari" && subSet === "cifre" && (() => {
          /* ---- pe șantier ---- */
          const peSantier = db.santiere.map((s) => {
            const b = bilant(s);
            return { ...s, ...b, ore: oreSantier(s.id) };
          }).sort((a, b) => b.marja - a.marja);

          /* ---- pe muncitor ---- */
          const peOm = db.angajati.map((a) => {
            const ale = db.pontaj.filter((p) => p.angajatId === a.id);
            const ore = ale.reduce((s, p) => s + (Number(p.ore) || 0), 0);
            const costBrut = ale.reduce((s, p) => s + (Number(p.ore) || 0) * (Number(p.tarifOra) || 0), 0);
            const cost = costBrut * (1 + (Number(db.setari?.procentTaxe) || 0) / 100);
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
          /* împart fiecare șantier pe tipurile de muncă chiar pontate acolo,
             proporțional cu orele — așa o casă cu demolare + zidărie + finisaje
             se împarte corect, nu intră toată la o singură categorie */
          const peDomeniu = {};
          db.santiere.forEach((s) => {
            const b = bilant(s);
            const pontajele = pontajSantier(s.id);
            const oreTot = pontajele.reduce((x, p) => x + (Number(p.ore) || 0), 0);
            const adauga = (d, cota, ore, nrLucrari) => {
              if (!peDomeniu[d]) peDomeniu[d] = { cifrat: 0, marja: 0, nr: 0, ore: 0 };
              peDomeniu[d].cifrat += b.incasat * cota;
              peDomeniu[d].marja += b.marja * cota;
              peDomeniu[d].ore += ore;
              peDomeniu[d].nr += nrLucrari;
            };
            /* dacă șantierul e cifrat pe faze, folosesc marja exactă a fiecărei faze */
            if (areFaze(s)) {
              s.faze.forEach((fz) => {
                const bf = bilantFaza(s, fz);
                const d = fz.domeniu || "Diverse";
                if (!peDomeniu[d]) peDomeniu[d] = { cifrat: 0, marja: 0, nr: 0, ore: 0 };
                peDomeniu[d].cifrat += bf.incasat;
                peDomeniu[d].marja += bf.marja;
                peDomeniu[d].ore += bf.ore;
                peDomeniu[d].nr += 1;
              });
              return;
            }
            if (oreTot === 0) {
              adauga(s.domeniu || "Diverse", 1, 0, 1);
              return;
            }
            const oreTip = {};
            pontajele.forEach((p) => {
              const d = p.tipMunca || s.domeniu || "Diverse";
              oreTip[d] = (oreTip[d] || 0) + (Number(p.ore) || 0);
            });
            Object.entries(oreTip).forEach(([d, ore]) => adauga(d, ore / oreTot, ore, 1));
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
                {taxeSalariiTotal > 0 && (
                  <div className="fisa-rand"><span className="k">Taxe pe salarii ({db.setari?.procentTaxe}%)</span><b className="mono">−{bani(taxeSalariiTotal)}</b></div>
                )}
                <div className="fisa-rand"><span className="k">Materiale pe șantiere</span><b className="mono">−{bani(materialeAlocateTotal)}</b></div>
                <div className="fisa-rand">
                  <span className="k">Materiale fără destinație</span>
                  <b className="mono" style={{ color: pierderiTotal > 0 ? "var(--rosu)" : "var(--mut)" }}>−{bani(pierderiTotal)}</b>
                </div>
                {cheltuieliAutoTotal > 0 && (
                  <div className="fisa-rand"><span className="k">Auto (întreținere + combustibil)</span><b className="mono">−{bani(cheltuieliAutoTotal)}</b></div>
                )}
                <div className="fisa-rand" style={{ borderBottom: "none", paddingTop: 12 }}>
                  <span className="k"><b>Marjă netă</b></span>
                  <b className="mono" style={{ fontSize: 18, color: marjaTotala >= 0 ? "var(--verde)" : "var(--rosu)" }}>
                    {marjaTotala < 0 ? "−" : ""}{bani(Math.abs(marjaTotala))}
                  </b>
                </div>
              </div>

              {(() => {
                const birou = db.angajati.filter((a) => a.tip === "birou");
                if (birou.length === 0) return null;
                const totalBirou = birou.reduce((s, a) => s + (Number(a.salariuLunar) || 0), 0);
                const totalBirouTaxe = totalBirou * (Number(db.setari?.procentTaxe) || 0) / 100;
                return (
                  <>
                    <div className="sectiune">🏢 Personal de birou (estimat lunar)</div>
                    <div className="card">
                      <div className="sub" style={{ marginTop: 0, marginBottom: 10 }}>
                        Nu sunt legați de șantiere, deci nu intră în marja de mai sus — e o cifră
                        separată, ca să știi cât te costă lunar și pe ei.
                      </div>
                      {birou.map((a) => (
                        <div className="fisa-rand" key={a.id}>
                          <span>{a.nume} <span className="k">· {a.grad || "—"}</span></span>
                          <b className="mono">{a.salariuLunar ? bani(a.salariuLunar) : "—"}</b>
                        </div>
                      ))}
                      <div className="fisa-rand" style={{ borderBottom: "none", paddingTop: 10 }}>
                        <span className="k"><b>Total lunar{taxeSalariiTotal > 0 ? " (brut)" : ""}</b></span>
                        <b className="mono" style={{ fontSize: 16 }}>{bani(totalBirou)}</b>
                      </div>
                      {totalBirouTaxe > 0 && (
                        <div className="fisa-rand" style={{ borderBottom: "none" }}>
                          <span className="k">+ taxe pe salarii ({db.setari?.procentTaxe}%)</span>
                          <b className="mono">{bani(totalBirouTaxe)}</b>
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}

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
              <div className="sub" style={{ marginBottom: 10 }}>
                Șantierele cifrate pe faze intră aici cu marja exactă a fiecărei faze.
                Cele cifrate cu o singură sumă se împart după orele pontate — mai puțin exact,
                dar orientativ.
              </div>
              {domeniiSortate.length === 0 ? (
                <div className="gol-msg">Adaugă șantiere cu tip de lucrare ca să vezi comparația.</div>
              ) : domeniiSortate.map((d) => (
                <div className="card" key={d.d} style={{ padding: "12px 14px" }}>
                  <div className="card-rand">
                    <div>
                      <div className="titlu" style={{ fontSize: 14 }}>{d.d}</div>
                      <div className="sub">
                        {d.nr} {d.nr === 1 ? "șantier" : "șantiere"} · <span className="mono">{d.ore}h</span> ·
                        partea din cifrat {bani(d.cifrat)}
                      </div>
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
        

        {tabEfectiv === "setari" && subSet === "cont" && (
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
              <div className="titlu">🏢 {db.firma?.nume || "Firma"}</div>
              <div className="sub">
                {db.firma?.forma && <>{db.firma.forma} · </>}
                {db.firma?.oras || "—"}
                {db.firma?.siret && <><br />SIRET/CUI: <span className="mono">{db.firma.siret}</span></>}
                {db.firma?.telefon && <><br />{db.firma.telefon}</>}
                {db.firma?.moneda && <><br />Monedă: {db.firma.moneda}</>}
              </div>
              <div className="actiuni">
                <button className="btn btn-mic principal" onClick={() => setFoaie({ tip: "firma" })}>
                  Modifică datele firmei
                </button>
              </div>
            </div>

            <div className="card">
              <div className="titlu">👁 Ce văd muncitorii</div>
              <div className="sub">
                Dacă opriți, tabul „Orele tale" dispare complet de pe telefonul lor — restul
                (planing, scule, cereri, materiale) rămâne neschimbat.
              </div>
              <div className="actiuni">
                <button className={"btn btn-mic" + ((db.setari?.oreVizibileMuncitori ?? true) ? " principal" : "")}
                  onClick={() => salveaza({ ...db, setari: { ...db.setari, oreVizibileMuncitori: true } })}>
                  Își văd orele
                </button>
                <button className={"btn btn-mic" + (!(db.setari?.oreVizibileMuncitori ?? true) ? " principal" : "")}
                  onClick={() => salveaza({ ...db, setari: { ...db.setari, oreVizibileMuncitori: false } })}>
                  Nu le văd
                </button>
              </div>
            </div>

            <div className="card">
              <div className="titlu">💰 Taxe pe salarii</div>
              <div className="sub">
                Pe lângă ce plătești direct angajatului, mai ai și cotizații patronale.
                Procentul de aici se adaugă la manoperă peste tot în aplicație — pe șantiere,
                în Cifre, în rapoarte — ca marja să reflecte costul real, nu doar salariul brut.
              </div>
              <div className="camp" style={{ marginTop: 11, marginBottom: 4 }}>
                <label>Procent peste salariul brut</label>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input type="number" step="0.5" style={{ maxWidth: 100 }}
                    value={db.setari?.procentTaxe ?? 0}
                    onChange={(e) => salveaza({ ...db, setari: { ...db.setari, procentTaxe: e.target.value } })}
                    placeholder="ex. 42" />
                  <span className="sub" style={{ marginTop: 0 }}>%</span>
                </div>
              </div>
              {Number(db.setari?.procentTaxe) > 0 && (
                <div className="sub">
                  Un salariu de 20 €/h te costă de fapt <b className="mono">
                  {bani(20 * (1 + Number(db.setari.procentTaxe) / 100))}</b>/h.
                </div>
              )}
            </div>

            <div className="card">
              <div className="titlu">🕖 Programul de lucru</div>
              <div className="sub">
                Orele standard ale firmei. Se folosesc când pui ceva în planing, la pontaj și
                când completezi automat săptămâna.
              </div>
              <ProgramLucru program={db.setari?.program}
                onSchimba={(pr) => salveaza({ ...db, setari: { ...db.setari, program: pr } })} />
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

        {tabEfectiv === "setari" && subSet === "roluri" && esteProprietar && (
          <RoluriFirma db={db} onSalveaza={salveaza} cere={cere} setFoaie={setFoaie} />
        )}

        {tabEfectiv === "setari" && subSet === "dotare" && (
          <Dotare db={db} onSalveaza={salveaza} setFoaie={setFoaie} cere={cere} />
        )}

        {tabEfectiv === "setari" && subSet === "categorii" && (
          <CategoriiMateriale db={db} onSalveaza={salveaza} cere={cere} />
        )}

        {tabEfectiv === "setari" && subSet === "categoriiScule" && (
          <CategoriiScule db={db} onSalveaza={salveaza} cere={cere} />
        )}

        {tabEfectiv === "setari" && subSet === "invitatii" && (
          <Invitatii db={db} onSeteazaPin={(id, pin) => setPinAngajat(id, pin, false)} />
        )}

        {tabEfectiv === "setari" && subSet === "rapoarte" && (
          <RaportLunar db={db} bani={bani} dataRo={dataRo} onRaport={raportLunarOm} />
        )}

        {tabEfectiv === "setari" && subSet === "backup" && (
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
              <div className="titlu">🧹 Curățenie automată a pozelor</div>
              <div className="sub">
                Pozele problemelor rezolvate se șterg singure după un timp. Textul rămâne —
                dispare doar imaginea, care ocupă locul. Așa nu rămâi fără spațiu.
              </div>
              <div className="actiuni">
                {[[7, "7 zile"], [30, "30 zile"], [90, "3 luni"], [0, "Niciodată"]].map(([z, et]) => (
                  <button key={z}
                    className={"btn btn-mic" + ((db.setari?.zilePoze ?? 30) === z ? " principal" : "")}
                    onClick={() => salveaza({ ...db, setari: { ...db.setari, zilePoze: z } })}>
                    {et}
                  </button>
                ))}
              </div>
              {(() => {
                const cuPoza = db.sarcini.filter((x) => x.fotoId || x.fotoData);
                const rezolvate = cuPoza.filter((x) => x.status === "rezolvat");
                return (
                  <div className="sub" style={{ marginTop: 11 }}>
                    Acum: <b>{cuPoza.length}</b> {cuPoza.length === 1 ? "poză" : "poze"} salvate
                    ({rezolvate.length} la probleme deja rezolvate).
                    {curatenie && <><br /><span style={{ color: "var(--verde)" }}>{curatenie}</span></>}
                  </div>
                );
              })()}
              <div className="actiuni">
                <button className="btn btn-mic"
                  onClick={() => cere(
                    "Ștergi acum pozele problemelor rezolvate mai vechi decât pragul ales? Textul rămâne.",
                    async () => {
                      const n = await stergePozeVechi(db.setari?.zilePoze || 30);
                      if (n === 0) setCuratenie("Nimic de șters deocamdată.");
                      setTimeout(() => setCuratenie(""), 5000);
                    }, "Curăță")}>
                  Curăță acum
                </button>
              </div>
            </div>

            <div className="card">
              <div className="titlu">🧹 Curățenie cereri și ore suplimentare</div>
              <div className="sub">
                Cererile rezolvate și cererile de ore suplimentare (aprobate sau refuzate) se
                șterg singure din listă după un timp. Orele deja aprobate rămân în pontaj —
                se șterge doar cererea, nu munca plătită.
              </div>
              <div className="actiuni">
                {[[7, "7 zile"], [30, "30 zile"], [90, "3 luni"], [0, "Niciodată"]].map(([z, et]) => (
                  <button key={z}
                    className={"btn btn-mic" + ((db.setari?.zileCereri ?? 30) === z ? " principal" : "")}
                    onClick={() => salveaza({ ...db, setari: { ...db.setari, zileCereri: z } })}>
                    {et}
                  </button>
                ))}
              </div>
              <div className="sub" style={{ marginTop: 11 }}>
                Acum: <b>{db.cereri.filter((c) => c.status === "rezolvat").length}</b> cereri rezolvate ·{" "}
                <b>{db.suplimentare.filter((x) => x.status !== "nou").length}</b> suplimentare procesate.
              </div>
              <div className="actiuni">
                <button className="btn btn-mic"
                  onClick={() => cere(
                    "Ștergi acum cererile și suplimentarele vechi mai vechi decât pragul ales?",
                    async () => {
                      const n = await curataCereri(db.setari?.zileCereri || 30);
                      if (n === 0) setCuratenie("Nimic de șters deocamdată.");
                      setTimeout(() => setCuratenie(""), 5000);
                    }, "Curăță")}>
                  Curăță acum
                </button>
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
        {tabEfectiv === "cereri" && (
          <>
            <div className="filtre">
              {[["toate", "Toate"], ["ore", "⏱ Ore"], ["combustibil", "⛽ Combustibil"], ["planing", "🗓 Planing"], ["resurse", "👷 Muncitori"], ["necesar", "📦 Necesar"], ["problema", "⚠ Probleme"]].map(([id, et]) => (
                <button key={id} className={filtruCereri === id ? "activ" : ""}
                  onClick={() => setFiltruCereri(id)}>{et}</button>
              ))}
            </div>
            {(filtruCereri === "toate" || filtruCereri === "ore") && (() => {
              const noi = db.suplimentare.filter((x) => x.status === "nou");
              const vechi = db.suplimentare.filter((x) => x.status !== "nou").slice(0, 6);
              if (db.suplimentare.length === 0) return null;
              const rand = (x) => {
                const sn = db.santiere.find((y) => y.id === x.santierId);
                const ang = db.angajati.find((a) => a.id === x.angajatId);
                const cost = (Number(x.ore) || 0) * (Number(ang?.tarifOra) || 0);
                return (
                  <div className="card" key={x.id} style={x.status !== "nou" ? { opacity: .7 } : null}>
                    <div className="card-rand">
                      <div>
                        <div className="titlu">{x.nume} · <b className="mono">{x.ore}h</b></div>
                        <div className="sub">
                          {dataRo(x.data)} · {sn?.nume || "—"}
                          {cost > 0 && <> · costă <b>{bani(cost)}</b></>}
                          {x.motivCerere && <><br />{x.motivCerere}</>}
                          {x.status === "respins" && x.motiv && (
                            <><br /><span style={{ color: "var(--rosu)" }}>Refuzat: {x.motiv}</span></>
                          )}
                        </div>
                      </div>
                      <span className={"chip " + (x.status === "aprobat" ? "ok" : x.status === "respins" ? "alerta" : "alocat")}>
                        {x.status === "aprobat" ? "Aprobate" : x.status === "respins" ? "Refuzate" : "De aprobat"}
                      </span>
                    </div>
                    {x.status === "nou" && (
                      <div className="actiuni">
                        <button className="btn btn-mic principal"
                          onClick={() => setFoaie({ tip: "aproba", item: x })}>
                          Aprobă
                        </button>
                        <button className="btn btn-mic" onClick={() => setFoaie({ tip: "respinge", item: x })}>
                          Refuză
                        </button>
                        <button className="btn btn-mic pericol" onClick={() => stergeSuplimentare(x.id)}>Șterge</button>
                      </div>
                    )}
                  </div>
                );
              };
              return (
                <>
                  <div className="sectiune">⏱ Ore suplimentare {noi.length > 0 && `(${noi.length} de aprobat)`}</div>
                  {noi.map(rand)}
                  {noi.length === 0 && <div className="gol-msg">Nimic de aprobat.</div>}
                  {vechi.length > 0 && (
                    <>
                      <div className="sectiune">Istoric suplimentare</div>
                      {vechi.map(rand)}
                    </>
                  )}
                </>
              );
            })()}

            {(filtruCereri === "toate" || filtruCereri === "combustibil") && (() => {
              const noiA = db.alimentari.filter((x) => x.status === "nou");
              const vechiA = db.alimentari.filter((x) => x.status !== "nou").slice(0, 6);
              if (db.alimentari.length === 0) return null;
              const randA = (x) => {
                const cm = db.camioane.find((c) => c.id === x.camionId);
                const sn = db.santiere.find((s) => s.id === x.santierId);
                return (
                  <div className="card" key={x.id} style={x.status !== "nou" ? { opacity: .7 } : null}>
                    <div className="card-rand">
                      <div>
                        <div className="titlu">{cm?.nume || "—"} · <b className="mono">{x.litri} L</b></div>
                        <div className="sub">
                          {x.nume} · {dataRo(x.data)} · cerut {bani(x.cost)}
                          {sn && <> · 🏗 {sn.nume}</>}
                          {x.note && <><br />{x.note}</>}
                          {x.status === "aprobat" && x.costAprobat !== undefined && Number(x.costAprobat) !== Number(x.cost) && (
                            <><br /><span style={{ color: "var(--galben)" }}>Aprobat: {x.litriAprobati} L · {bani(x.costAprobat)}</span></>
                          )}
                          {x.status === "respins" && x.motiv && (
                            <><br /><span style={{ color: "var(--rosu)" }}>Refuzat: {x.motiv}</span></>
                          )}
                        </div>
                      </div>
                      <span className={"chip " + (x.status === "aprobat" ? "ok" : x.status === "respins" ? "alerta" : "alocat")}>
                        {x.status === "aprobat" ? "Aprobată" : x.status === "respins" ? "Refuzată" : "De aprobat"}
                      </span>
                    </div>
                    {(x.fotoId || x.fotoData) && <Poza fotoId={x.fotoId} fotoData={x.fotoData} inalt={160} />}
                    {x.status === "nou" && (
                      <div className="actiuni">
                        <button className="btn btn-mic principal" onClick={() => setFoaie({ tip: "aprobaAlimentare", item: x })}>
                          Aprobă
                        </button>
                        <button className="btn btn-mic" onClick={() => setFoaie({ tip: "respingeAlimentare", item: x })}>
                          Refuză
                        </button>
                        <button className="btn btn-mic pericol" onClick={() => stergeAlimentare(x.id)}>Șterge</button>
                      </div>
                    )}
                  </div>
                );
              };
              return (
                <>
                  <div className="sectiune">⛽ Alimentări {noiA.length > 0 && `(${noiA.length} de aprobat)`}</div>
                  {noiA.map(randA)}
                  {noiA.length === 0 && <div className="gol-msg">Nimic de aprobat.</div>}
                  {vechiA.length > 0 && (
                    <>
                      <div className="sectiune">Istoric alimentări</div>
                      {vechiA.map(randA)}
                    </>
                  )}
                </>
              );
            })()}

            {(filtruCereri === "toate" || (filtruCereri !== "ore" && filtruCereri !== "combustibil")) &&
              <div className="sectiune">
                {filtruCereri === "necesar" ? "📦 Cereri de materiale"
                  : filtruCereri === "problema" ? "⚠ Probleme raportate"
                  : filtruCereri === "planing" ? "🗓 Cereri legate de planing"
                  : filtruCereri === "resurse" ? "👷 Cereri de muncitori"
                  : "Probleme și necesar raportate de pe teren"}
              </div>}
            {db.cereri.length === 0 ? (
              <div className="gol-msg">Nimic raportat. Muncitorii intră cu contul lor și trimit probleme sau ce le lipsește — apare doar aici, la tine.</div>
            ) : db.cereri
              .filter((c) => filtruCereri === "toate" || filtruCereri === c.tip)
              .filter(() => filtruCereri !== "ore" && filtruCereri !== "combustibil")
              .map((c) => {
              const areLinii = Array.isArray(c.linii) && c.linii.length > 0;
              return (
                <div className="card" key={c.id}>
                  <div className="card-rand">
                    <div>
                      <div className="titlu">{etichetaCerere(c.tip)} · {c.autorNume}</div>
                      <div className="sub">
                        {c.santierNume && <>🏗 {c.santierNume}<br /></>}
                        {c.dataCeruta && (
                          <><b style={{ color: "var(--galben)" }}>
                            {c.tip === "resurse" && c.oameniCeruti ? `${c.oameniCeruti} ${c.oameniCeruti === 1 ? "om" : "oameni"} · ` : ""}
                            Pentru {dataRo(c.dataCeruta)}
                          </b><br /></>
                        )}
                        {!areLinii && <>{c.text}<br /></>}
                        <span className="mono">{c.cand}</span>
                      </div>
                    </div>
                    <span className={"chip " + (c.status === "nou" ? "alocat" : "ok")}>
                      {c.status === "nou" ? "Nouă" : "Rezolvată"}
                    </span>
                  </div>

                  {areLinii && (
                    <div className="lista-in-card">
                      {c.linii.map((l, i) => {
                        const mat = l.materialId ? db.materiale.find((m) => m.id === l.materialId) : null;
                        const lipsa = mat && Number(mat.cant) < Number(l.cant);
                        return (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                            <span>📦 {l.nume}</span>
                            <b className="mono" style={{ color: lipsa ? "var(--rosu)" : "var(--text)", whiteSpace: "nowrap" }}>
                              {l.cant} {l.unitate}
                              {mat && <span style={{ color: "var(--mut)", fontWeight: 400 }}> / {mat.cant} în stoc</span>}
                              {!mat && <span style={{ color: "var(--mut)", fontWeight: 400 }}> · nu e în stoc</span>}
                            </b>
                          </div>
                        );
                      })}
                      {c.text && <div style={{ color: "var(--mut)", marginTop: 6 }}>{c.text}</div>}
                    </div>
                  )}

                  <div className="actiuni">
                    {c.status === "nou" && areLinii && c.santierId && (
                      <button className="btn btn-mic principal"
                        onClick={() => cere(
                          `Trimiți ${c.linii.map((l) => `${l.cant} ${l.unitate} ${l.nume}`).join(", ")} pe ${c.santierNume}? Se scad din stoc și intră ca material consumat acolo.`,
                          () => onoreazaCerere(c), "Trimite")}>
                        Trimite materialele
                      </button>
                    )}
                    {c.status === "nou" && c.tip === "planing" && c.dataCeruta && (
                      <button className="btn btn-mic principal"
                        onClick={() => { setTab("planing"); setFoaie({ tip: "plan", data: c.dataCeruta }); }}>
                        Deschide planingul
                      </button>
                    )}
                    {c.status === "nou"
                      ? <button className="btn btn-mic" onClick={() => marcheazaCerere(c.id, "rezolvat")}>Marchează rezolvată</button>
                      : <button className="btn btn-mic" onClick={() => marcheazaCerere(c.id, "nou")}>Redeschide</button>}
                    <button className="btn btn-mic pericol" onClick={() => stergeCerere(c.id)}>Șterge</button>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* ---------- FORMULARE ADMIN ---------- */}
      {foaie?.tip === "material" && (
        <FormMaterial item={foaie.item} santiere={db.santiere.filter((x) => x.status !== "finalizat")}
          categorii={categoriiMateriale} onSalveaza={salvMaterialCuDestinatie} onClose={() => setFoaie(null)} />
      )}
      {foaie?.tip === "scula" && (
        <FormScula item={foaie.item} categorii={categoriiScule} onSalveaza={salvScula} onClose={() => setFoaie(null)} />
      )}
      {foaie?.tip === "echipa" && (
        <FormEchipa item={foaie.item} santiere={db.santiere.filter((x) => x.status !== "finalizat")}
          camioane={db.camioane} onSalveaza={salvEchipa} onClose={() => setFoaie(null)} />
      )}
      {foaie?.tip === "rolNou" && (
        <FormRol item={foaie.item}
          onSalveaza={(rol) => {
            salveaza({
              ...db,
              roluriFirma: rol.id
                ? (db.roluriFirma || []).map((r) => (r.id === rol.id ? rol : r))
                : [...(db.roluriFirma || []), { ...rol, id: uid() }],
            });
            setFoaie(null);
          }}
          onClose={() => setFoaie(null)} />
      )}
      {foaie?.tip === "angajat" && (
        <FormAngajat item={foaie.item} echipe={db.echipe} esteProprietar={esteProprietar}
          roluriFirma={db.roluriFirma} onSalveaza={salvAngajat} onClose={() => setFoaie(null)} />
      )}
      {foaie?.tip === "fisa" && (
        <FisaAngajat
          angajat={db.angajati.find((a) => a.id === foaie.item.id)}
          echipe={db.echipe}
          numeEchipa={numeEchipa}
          pontaj={db.pontaj}
          santiere={db.santiere}
          roluriFirma={db.roluriFirma}
          doarCitire={!esteProprietar && !permisiuni.oameniEditare}
          onEdit={() => setFoaie({ tip: "angajat", item: foaie.item })}
          onMuta={(echipaId) => salvAngajat({ ...db.angajati.find((a) => a.id === foaie.item.id), echipaId })}
          onSterge={() => stergeAngajat(foaie.item.id)}
          onParola={() => setFoaie({ tip: "parola", item: db.angajati.find((a) => a.id === foaie.item.id) })}
          onClose={() => setFoaie(null)}
        />
      )}
      {foaie?.tip === "aprovizionare" && (
        <FormAprovizionare material={foaie.item}
          santiere={db.santiere.filter((x) => x.status !== "finalizat")}
          onSalveaza={(cant, pret, dest) => {
            const m = foaie.item;
            const cantN = Number(cant) || 0;
            const pretN = Number(pret) || Number(m.pret) || 0;
            if (dest?.santierId) {
              const sant = db.santiere.find((x) => x.id === dest.santierId);
              salveaza(cuJurnal({
                ...db,
                materiale: db.materiale.map((x) => (x.id === m.id ? { ...x, pret: pretN } : x)),
                consum: [{ id: uid(), santierId: dest.santierId, fazaId: null,
                  materialId: m.id, nume: m.nume, cant: cantN, unitate: m.unitate,
                  pret: pretN, data: aziISO(), motiv: "livrat direct pe șantier" }, ...db.consum],
              }, `${sant?.nume}: primit direct ${cantN} ${m.unitate} ${m.nume}`));
            } else {
              salveaza(cuJurnal({
                ...db,
                materiale: db.materiale.map((x) =>
                  x.id === m.id ? { ...x, cant: (Number(x.cant) || 0) + cantN, pret: pretN } : x),
              }, `Aprovizionat: ${cantN} ${m.unitate} ${m.nume}`));
            }
            setFoaie(null);
          }}
          onClose={() => setFoaie(null)} />
      )}
      {foaie?.tip === "santier" && <FormSantier item={foaie.item} onSalveaza={salvSantier} onClose={() => setFoaie(null)} />}
      {foaie?.tip === "pontaj" && (
        <FormPontaj santier={foaie.item} angajati={db.angajati} echipe={db.echipe} program={db.setari?.program}
          pontajExistent={db.pontaj} santiere={db.santiere}
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
          angajati={db.angajati} planificare={db.planificare} program={db.setari?.program}
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
      {foaie?.tip === "aproba" && (
        <AprobaSuplimentare sup={foaie.item}
          angajat={db.angajati.find((a) => a.id === foaie.item.angajatId)}
          santier={db.santiere.find((x) => x.id === foaie.item.santierId)}
          onAproba={(ore, nota) => { aprobaSuplimentare({ ...foaie.item, ore, notaAdmin: nota }); setFoaie(null); }}
          onClose={() => setFoaie(null)} />
      )}
      {foaie?.tip === "respinge" && (
        <Foaie titlu={`Refuzi ${foaie.item.ore}h pentru ${foaie.item.nume}?`} onClose={() => setFoaie(null)}>
          <MotivRefuz onTrimite={(m) => { respingeSuplimentare(foaie.item, m); setFoaie(null); }} />
        </Foaie>
      )}
      {foaie?.tip === "aprobaAlimentare" && (
        <AprobaAlimentare al={foaie.item}
          camion={db.camioane.find((c) => c.id === foaie.item.camionId)}
          onAproba={(litri, cost) => { aprobaAlimentare(foaie.item, litri, cost); setFoaie(null); }}
          onClose={() => setFoaie(null)} />
      )}
      {foaie?.tip === "respingeAlimentare" && (
        <Foaie titlu={`Refuzi alimentarea de la ${foaie.item.nume}?`} onClose={() => setFoaie(null)}>
          <MotivRefuz onTrimite={(m) => { respingeAlimentare(foaie.item, m); setFoaie(null); }} />
        </Foaie>
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
          orePrevTot={orePrevSantier(db.santiere.find((x) => x.id === foaie.item.id) || foaie.item)}
          bilanturiFaze={(() => {
            const sn = db.santiere.find((x) => x.id === foaie.item.id) || foaie.item;
            return areFaze(sn) ? sn.faze.map((fz) => ({ faza: fz, b: bilantFaza(sn, fz) })) : [];
          })()}
          onStergePontaj={stergePontaj} onStergeConsum={stergeConsum} onClose={() => setFoaie(null)} />
      )}
      {foaie?.tip === "camion" && <FormCamion item={foaie.item} onSalveaza={salvCamion} onClose={() => setFoaie(null)} />}
      {foaie?.tip === "intretinere" && (
        <FormIntretinere camion={foaie.item} onSalveaza={(i) => adaugaIntretinere(foaie.item.id, i)} onClose={() => setFoaie(null)} />
      )}
      {foaie?.tip === "alimentare" && (
        <FormAlimentare camion={foaie.item} santiere={db.santiere.filter((x) => x.status !== "finalizat")}
          onSalveaza={(i) => adaugaIntretinere(foaie.item.id, i)} onClose={() => setFoaie(null)} />
      )}
      {foaie?.tip === "istoricCamion" && (
        <Foaie titlu={`Istoric: ${foaie.item.nume}`} onClose={() => setFoaie(null)}>
          {db.intretinere.filter((i) => i.camionId === foaie.item.id).length === 0 ? (
            <div className="gol-msg">Nicio intervenție notată.</div>
          ) : db.intretinere.filter((i) => i.camionId === foaie.item.id).map((i) => (
            <div className="jurnal-rand" key={i.id}>
              <div className="cand mono">{i.data}{i.km ? ` · ${Number(i.km).toLocaleString("ro-RO")} km` : ""}</div>
              <div className="ce">
                {i.tip}{i.cost ? <> · <b>{bani(i.cost)}</b></> : ""}
                {i.santierId && <> · <span style={{ color: "var(--galben)" }}>
                  {db.santiere.find((x) => x.id === i.santierId)?.nume || "șantier"}</span></>}
                {i.note ? <><br />{i.note}</> : ""}
              </div>
            </div>
          ))}
        </Foaie>
      )}
      {foaie?.tip === "aloca" && (
        <Foaie titlu={`Alocă: ${foaie.item.nume}`} onClose={() => setFoaie(null)}>
          {db.echipe.map((e) => (
            <button key={e.id} className="btn btn-galben" style={{ marginBottom: 9 }} onClick={() => alocaScula(foaie.item.id, e.id)}>
              {e.nume} {(() => { const sn = db.santiere.find((x) => x.id === e.santierId); return sn ? `· ${sn.nume}` : ""; })()}
            </button>
          ))}
        </Foaie>
      )}
      {foaie?.tip === "firma" && (
        <Foaie titlu="Datele firmei" onClose={() => setFoaie(null)}>
          <CampuriFirma valoare={db.firma || {}}
            onSalveaza={(firma) => { salveaza({ ...db, firma }); setFoaie(null); }} />
        </Foaie>
      )}
      {foaie?.tip === "pin" && (
        <FormPin actual={db.setari.pin} onSalveaza={(pin) => { salveaza({ ...db, setari: { ...db.setari, pin } }); setFoaie(null); }} onClose={() => setFoaie(null)} />
      )}

      <Confirmare intrebare={intrebare} onInchide={() => setIntrebare(null)} />

      {/* ---------- NAVIGARE ADMIN ---------- */}
      {(() => {
        const toateTaburile = [
          ["panou", "▦", t("Panou"), alerteCamioane.length + cereriNoi.length],
          ["santiere", "🏗", t("Șantiere"), 0],
          ["planing", "🗓", t("Planing"), 0],
          ["inventar", "▤", t("Stoc"),
            stocScazut.length + db.scule.filter((x) => x.stare === "problema").length + alerteCamioane.length],
          ["cereri", "✉", t("Cereri"),
            cereriNoi.length + db.suplimentare.filter((x) => x.status === "nou").length +
            db.alimentari.filter((x) => x.status === "nou").length],
          ["setari", "⚙", t("Setări"), 0],
        ];
        const taburiPermise = idTaburiPermise
          ? toateTaburile.filter((x) => idTaburiPermise.includes(x[0]))
          : toateTaburile;
        return (
          <nav className="nav">
            {taburiPermise.map(([id, ico, lbl, badge]) => (
          <button key={id} className={tabEfectiv === id ? "activ" : ""} onClick={() => { setTab(id); setCauta(""); }}>
            {badge > 0 && <span className="bulina">{badge}</span>}
                <span className="ico">{ico}</span>{lbl}
              </button>
            ))}
          </nav>
        );
      })()}
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

/* Pe iPhone descărcarea clasică nu merge în aplicația instalată pe ecran,
   așa că încerc întâi partajarea (Salvează în Fișiere, trimite pe mail etc.) */
const descarca = async (text, nume) => {
  const blob = new Blob([text], { type: "application/json" });

  try {
    if (navigator.canShare && window.File) {
      const fis = new File([blob], nume, { type: "application/json" });
      if (navigator.canShare({ files: [fis] })) {
        await navigator.share({ files: [fis], title: nume });
        return "partajat";
      }
    }
  } catch (e) {
    if (e && e.name === "AbortError") return "anulat";
  }

  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nume;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return "descarcat";
  } catch (e) {
    return "esuat";
  }
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

function CategoriiMateriale({ db, onSalveaza, cere }) {
  const [nume, setNume] = useState("");
  const [editez, setEditez] = useState(null); // categoria redenumită acum
  const [redenumire, setRedenumire] = useState("");

  const folosite = db.materiale.reduce((acc, m) => {
    const c = (m.categorie || "").trim();
    if (c) acc[c] = (acc[c] || 0) + 1;
    return acc;
  }, {});
  const toate = [...new Set([...(db.categoriiMateriale || []), ...Object.keys(folosite)])]
    .sort((a, b) => a.localeCompare(b, "ro"));

  const adauga = () => {
    const n = nume.trim();
    if (!n || toate.includes(n)) { setNume(""); return; }
    onSalveaza({ ...db, categoriiMateriale: [...(db.categoriiMateriale || []), n] });
    setNume("");
  };

  const salveazaRedenumire = (vechi) => {
    const nou = redenumire.trim();
    setEditez(null);
    if (!nou || nou === vechi) return;
    onSalveaza({
      ...db,
      categoriiMateriale: [...new Set((db.categoriiMateriale || []).map((c) => (c === vechi ? nou : c)))],
      materiale: db.materiale.map((m) => ((m.categorie || "").trim() === vechi ? { ...m, categorie: nou } : m)),
    });
  };

  const sterge = (c) => {
    const nr = folosite[c] || 0;
    cere(
      nr > 0
        ? `Ștergi categoria „${c}"? ${nr} ${nr === 1 ? "material rămâne" : "materiale rămân"} fără categorie.`
        : `Ștergi categoria „${c}"?`,
      () => onSalveaza({
        ...db,
        categoriiMateriale: (db.categoriiMateriale || []).filter((x) => x !== c),
        materiale: db.materiale.map((m) => ((m.categorie || "").trim() === c ? { ...m, categorie: "" } : m)),
      }),
      "Șterge"
    );
  };

  return (
    <>
      <div className="card">
        <div className="titlu">🏷️ Categoriile tale</div>
        <div className="sub">
          Le vezi apoi la fiecare material, la alegere. Le poți redenumi sau șterge oricând —
          materialele care le foloseau nu se șterg, doar rămân fără categorie.
        </div>
      </div>

      <div className="camp">
        <label>Adaugă o categorie nouă</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={nume} onChange={(e) => setNume(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && adauga()}
            placeholder="ex. Instalații electrice" style={{ flex: 1 }} />
          <button className="btn btn-mic principal" onClick={adauga}>+</button>
        </div>
      </div>

      {toate.length === 0 ? (
        <div className="gol-msg">
          Nicio categorie încă. Adaugă-le aici sau apar automat pe măsură ce le scrii la materiale.
        </div>
      ) : (
        toate.map((c) => (
          <div className="card" key={c} style={{ padding: "11px 14px" }}>
            {editez === c ? (
              <div style={{ display: "flex", gap: 8 }}>
                <input value={redenumire} onChange={(e) => setRedenumire(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && salveazaRedenumire(c)}
                  autoFocus style={{ flex: 1 }} />
                <button className="btn btn-mic principal" onClick={() => salveazaRedenumire(c)}>Salvează</button>
              </div>
            ) : (
              <div className="card-rand">
                <div>
                  <div className="titlu" style={{ fontSize: 14.5 }}>{c}</div>
                  <div className="sub">
                    {folosite[c] || 0} {folosite[c] === 1 ? "material" : "materiale"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="btn btn-mic" onClick={() => { setEditez(c); setRedenumire(c); }}>Redenumește</button>
                  <button className="btn btn-mic pericol" onClick={() => sterge(c)}>Șterge</button>
                </div>
              </div>
            )}
          </div>
        ))
      )}
    </>
  );
}

function CategoriiScule({ db, onSalveaza, cere }) {
  const [nume, setNume] = useState("");
  const [editez, setEditez] = useState(null);
  const [redenumire, setRedenumire] = useState("");

  const folosite = db.scule.reduce((acc, sc) => {
    const c = (sc.categorie || "").trim();
    if (c) acc[c] = (acc[c] || 0) + 1;
    return acc;
  }, {});
  const toate = [...new Set([...(db.categoriiScule || []), ...Object.keys(folosite)])]
    .sort((a, b) => a.localeCompare(b, "ro"));

  const adauga = () => {
    const n = nume.trim();
    if (!n || toate.includes(n)) { setNume(""); return; }
    onSalveaza({ ...db, categoriiScule: [...(db.categoriiScule || []), n] });
    setNume("");
  };

  const salveazaRedenumire = (vechi) => {
    const nou = redenumire.trim();
    setEditez(null);
    if (!nou || nou === vechi) return;
    onSalveaza({
      ...db,
      categoriiScule: [...new Set((db.categoriiScule || []).map((c) => (c === vechi ? nou : c)))],
      scule: db.scule.map((sc) => ((sc.categorie || "").trim() === vechi ? { ...sc, categorie: nou } : sc)),
    });
  };

  const sterge = (c) => {
    const nr = folosite[c] || 0;
    cere(
      nr > 0
        ? `Ștergi categoria „${c}"? ${nr} ${nr === 1 ? "sculă rămâne" : "scule rămân"} fără categorie.`
        : `Ștergi categoria „${c}"?`,
      () => onSalveaza({
        ...db,
        categoriiScule: (db.categoriiScule || []).filter((x) => x !== c),
        scule: db.scule.map((sc) => ((sc.categorie || "").trim() === c ? { ...sc, categorie: "" } : sc)),
      }),
      "Șterge"
    );
  };

  return (
    <>
      <div className="card">
        <div className="titlu">🗂️ Categoriile tale de scule</div>
        <div className="sub">
          Le vezi apoi la fiecare sculă, la alegere, și le folosești ca filtre la lista de scule.
          Le poți redenumi sau șterge oricând — sculele care le foloseau nu se șterg, doar rămân
          fără categorie.
        </div>
      </div>

      <div className="camp">
        <label>Adaugă o categorie nouă</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={nume} onChange={(e) => setNume(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && adauga()}
            placeholder="ex. Electrice" style={{ flex: 1 }} />
          <button className="btn btn-mic principal" onClick={adauga}>+</button>
        </div>
      </div>

      {toate.length === 0 ? (
        <div className="gol-msg">
          Nicio categorie încă. Adaugă-le aici sau apar automat pe măsură ce le scrii la scule.
        </div>
      ) : (
        toate.map((c) => (
          <div className="card" key={c} style={{ padding: "11px 14px" }}>
            {editez === c ? (
              <div style={{ display: "flex", gap: 8 }}>
                <input value={redenumire} onChange={(e) => setRedenumire(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && salveazaRedenumire(c)}
                  autoFocus style={{ flex: 1 }} />
                <button className="btn btn-mic principal" onClick={() => salveazaRedenumire(c)}>Salvează</button>
              </div>
            ) : (
              <div className="card-rand">
                <div>
                  <div className="titlu" style={{ fontSize: 14.5 }}>{c}</div>
                  <div className="sub">
                    {folosite[c] || 0} {folosite[c] === 1 ? "sculă" : "scule"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="btn btn-mic" onClick={() => { setEditez(c); setRedenumire(c); }}>Redenumește</button>
                  <button className="btn btn-mic pericol" onClick={() => sterge(c)}>Șterge</button>
                </div>
              </div>
            )}
          </div>
        ))
      )}
    </>
  );
}

function RoluriFirma({ db, onSalveaza, cere, setFoaie }) {
  const roluri = db.roluriFirma || [];

  const salvRol = (rol) => {
    const lista = rol.id
      ? roluri.map((r) => (r.id === rol.id ? rol : r))
      : [...roluri, { ...rol, id: uid() }];
    onSalveaza({ ...db, roluriFirma: lista });
    setFoaie(null);
  };

  const stergeRol = (id) => {
    const nrOameni = db.angajati.filter((a) => a.rolFirmaId === id).length;
    cere(
      nrOameni > 0
        ? `Ștergi rolul? ${nrOameni} ${nrOameni === 1 ? "angajat rămâne" : "angajați rămân"} fără rol — intră normal, ca muncitor.`
        : "Ștergi acest rol?",
      () => onSalveaza({
        ...db,
        roluriFirma: roluri.filter((r) => r.id !== id),
        angajati: db.angajati.map((a) => (a.rolFirmaId === id ? { ...a, rolFirmaId: null } : a)),
      }),
      "Șterge"
    );
  };

  return (
    <>
      <div className="card">
        <div className="titlu">🔑 Rolurile firmei</div>
        <div className="sub">
          Fiecare rol e un pachet de bife. Îl dai unui angajat din fișa lui, iar el intră cu
          parola personală direct în partea din aplicație pe care i-o permiți — nimic mai mult.
        </div>
      </div>

      <button className="btn btn-galben" onClick={() => setFoaie({ tip: "rolNou" })}>+ Rol nou</button>
      <div style={{ height: 12 }} />

      {roluri.length === 0 ? (
        <div className="gol-msg">
          Niciun rol încă. Creează unul — de exemplu „Secretariat", cu bifele pentru Cifre și
          Rapoarte — apoi îl dai cuiva din fișa lui.
        </div>
      ) : (
        roluri.map((r) => {
          const nrOameni = db.angajati.filter((a) => a.rolFirmaId === r.id).length;
          const bifate = Object.entries(r.permisiuni || {}).filter(([, v]) => v).length;
          return (
            <div className="card" key={r.id}>
              <div className="card-rand">
                <div>
                  <div className="titlu">{r.nume}</div>
                  <div className="sub">
                    {bifate} {bifate === 1 ? "permisiune" : "permisiuni"} · {nrOameni} {nrOameni === 1 ? "angajat" : "angajați"}
                  </div>
                </div>
              </div>
              <div className="actiuni">
                <button className="btn btn-mic principal" onClick={() => setFoaie({ tip: "rolNou", item: r })}>Modifică</button>
                <button className="btn btn-mic pericol" onClick={() => stergeRol(r.id)}>Șterge</button>
              </div>
            </div>
          );
        })
      )}
    </>
  );
}

function FormRol({ item, onSalveaza, onClose }) {
  const [f, setF] = useState(item || { nume: "", permisiuni: {} });
  const bifeaza = (cheie) =>
    setF({ ...f, permisiuni: { ...f.permisiuni, [cheie]: !f.permisiuni[cheie] } });

  return (
    <Foaie titlu={item ? "Modifică rol" : "Rol nou"} onClose={onClose}>
      <div className="camp">
        <label>Numele rolului *</label>
        <input value={f.nume} onChange={(e) => setF({ ...f, nume: e.target.value })}
          placeholder="ex. Secretariat, Achiziții, Șef șantier" autoFocus />
      </div>

      {GRUPURI_PERMISIUNI.map((grup) => (
        <div className="camp" key={grup.titlu}>
          <label>{grup.titlu}</label>
          {grup.chei.map(([cheie, descriere]) => (
            <label key={cheie} className="rand-bifa">
              <input type="checkbox" checked={!!f.permisiuni[cheie]} onChange={() => bifeaza(cheie)} />
              <span>{descriere}</span>
            </label>
          ))}
        </div>
      ))}

      <button className="btn btn-galben" disabled={!f.nume.trim()}
        onClick={() => f.nume.trim() && onSalveaza(f)}>
        Salvează rolul
      </button>
    </Foaie>
  );
}

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
  const [santierId, setSantierId] = useState(santiere.length === 1 ? santiere[0].id : "");
  const [fazaId, setFazaId] = useState("");
  const fazeleLui = (sid) => {
    const s = santiere.find((x) => x.id === sid);
    return Array.isArray(s?.faze) ? s.faze : [];
  };
  const [pas, setPas] = useState(
    santiere.length === 1 ? (fazeleLui(santiere[0].id).length > 0 ? 1.5 : 2) : 1
  );
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
      data: aziISO(), scadeDinStoc: true, inregistratDe: numeleMeu, fazaId: fazaId || null,
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
          setPas(2);
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
              onClick={() => {
                setSantierId(s.id);
                setFazaId("");
                setPas(fazeleLui(s.id).length > 0 ? 1.5 : 2);
              }}>
              🏗 {s.nume}
            </button>
          ))
        )}
      </Foaie>
    );

  /* pasul intermediar — pe ce fază, dacă șantierul are faze */
  if (pas === 1.5)
    return (
      <Foaie titlu="La ce fază?" onClose={onClose}>
        <div className="sub" style={{ marginBottom: 12 }}>Pe {santier?.nume}</div>
        {fazeleLui(santierId).map((fz) => (
          <button key={fz.id} className="btn btn-mare" onClick={() => { setFazaId(fz.id); setPas(2); }}>
            <span>🧱 {fz.nume}</span>
          </button>
        ))}
        <button className="btn btn-mic" style={{ width: "100%", marginTop: 4 }}
          onClick={() => { setFazaId(""); setPas(2); }}>
          Nu știu / altceva
        </button>
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

const FORME = ["SAS", "SASU", "SARL", "EURL", "Micro-entreprise", "Auto-entrepreneur", "SRL", "PFA", "Alta"];
const MONEDE = ["€ EUR", "lei RON"];

function CampuriFirma({ valoare, onSalveaza, butonText = "Salvează" }) {
  const [f, setF] = useState({
    nume: "", forma: FORME[0], siret: "", oras: "", adresa: "",
    telefon: "", email: "", moneda: MONEDE[0], ...valoare,
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <>
      <div className="camp">
        <label>Numele firmei *</label>
        <input value={f.nume} onChange={set("nume")} placeholder="ex. Boring Construct" />
      </div>
      <div className="rand2">
        <div className="camp">
          <label>Forma juridică</label>
          <select value={f.forma} onChange={set("forma")}>
            {FORME.map((x) => <option key={x}>{x}</option>)}
          </select>
        </div>
        <div className="camp">
          <label>Monedă</label>
          <select value={f.moneda} onChange={set("moneda")}>
            {MONEDE.map((x) => <option key={x}>{x}</option>)}
          </select>
        </div>
      </div>
      <div className="camp">
        <label>SIRET / CUI</label>
        <input value={f.siret} onChange={set("siret")} placeholder="ex. 812 345 678 00012" />
      </div>
      <div className="rand2">
        <div className="camp">
          <label>Oraș</label>
          <input value={f.oras} onChange={set("oras")} placeholder="ex. Angers" />
        </div>
        <div className="camp">
          <label>Telefon</label>
          <input value={f.telefon} onChange={set("telefon")} placeholder="ex. 06 12 34 56 78" />
        </div>
      </div>
      <div className="camp">
        <label>Adresă</label>
        <input value={f.adresa} onChange={set("adresa")} placeholder="strada, număr, cod poștal" />
      </div>
      <div className="camp">
        <label>Email</label>
        <input value={f.email} onChange={set("email")} placeholder="contact@firma.fr" />
      </div>
      <button className="btn btn-galben" disabled={!f.nume.trim()}
        onClick={() => f.nume.trim() && onSalveaza({ ...f, nume: f.nume.trim() })}>
        {butonText}
      </button>
    </>
  );
}

function ConfigurareFirma({ onSalveaza, onIesi }) {
  return (
    <div className="continut" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 24px)" }}>
      <div className="hazard" style={{ marginBottom: 18 }} />
      <h1 style={{ fontSize: 20, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".5px" }}>
        Bun venit
      </h1>
      <div className="sub" style={{ margin: "8px 0 18px", lineHeight: 1.6 }}>
        Spune-mi câteva lucruri despre firma ta. Numele apare în capul aplicației, la tine
        și la oamenii tăi. Restul îl completezi acum sau mai târziu, din Setări.
      </div>
      <CampuriFirma valoare={{}} onSalveaza={onSalveaza} butonText="Gata, intru în aplicație" />
      <button className="btn btn-mic" style={{ width: "100%", marginTop: 10 }} onClick={onIesi}>
        Ieși din cont
      </button>
    </div>
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
                    if (pin === ales.pin) onIntra({ rol: ales.rolFirmaId ? "admin" : "muncitor", angajatId });
                    else setEroare(t("Parolă greșită. Dacă ai uitat-o, cere-i șefului să ți-o reseteze."));
                  } else {
                    if (pin.length < 4) return setEroare(t("Parola trebuie să aibă minim 4 caractere."));
                    onSeteazaPin(angajatId, pin);
                    onIntra({ rol: ales.rolFirmaId ? "admin" : "muncitor", angajatId });
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
function FormAprovizionare({ material, santiere = [], onSalveaza, onClose }) {
  const [cant, setCant] = useState("");
  const [pret, setPret] = useState(material.pret || "");
  const [santierId, setSantierId] = useState("");
  const [fazaId, setFazaId] = useState("");
  const santierAles = santiere.find((x) => x.id === santierId);
  const fazeleLui = Array.isArray(santierAles?.faze) ? santierAles.faze : [];
  const valoare = (Number(cant) || 0) * (Number(pret) || 0);

  return (
    <Foaie titlu={`Am cumpărat: ${material.nume}`} onClose={onClose}>
      <div className="sub" style={{ marginBottom: 12 }}>
        În stoc acum: <b className="mono">{material.cant} {material.unitate}</b> · minim {material.minim} {material.unitate}
      </div>
      <div className="rand2">
        <div className="camp"><label>Cât ai cumpărat *</label>
          <input type="number" step="0.01" value={cant} onChange={(e) => setCant(e.target.value)}
            placeholder={`ex. ${material.minim || 20}`} autoFocus /></div>
        <div className="camp"><label>Preț / {material.unitate}</label>
          <input type="number" step="0.01" value={pret} onChange={(e) => setPret(e.target.value)} /></div>
      </div>

      {santiere.length > 0 && (
        <div className="camp">
          <label>Unde a ajuns</label>
          <select value={santierId} onChange={(e) => { setSantierId(e.target.value); setFazaId(""); }}>
            <option value="">🏠 În depozit</option>
            {santiere.map((x) => <option key={x.id} value={x.id}>🏗 Direct pe {x.nume}</option>)}
          </select>
        </div>
      )}
      {fazeleLui.length > 0 && (
        <div className="camp">
          <label>Pe ce fază</label>
          <select value={fazaId} onChange={(e) => setFazaId(e.target.value)}>
            <option value="">— nealocat pe fază —</option>
            {fazeleLui.map((fz) => <option key={fz.id} value={fz.id}>{fz.nume}</option>)}
          </select>
        </div>
      )}

      {valoare > 0 && <div className="sub" style={{ marginBottom: 12 }}>Valoare: <b style={{ color: "var(--galben)" }}>{bani(valoare)}</b></div>}

      <button className="btn btn-galben" disabled={!Number(cant)}
        onClick={() => Number(cant) && onSalveaza(cant, pret, { santierId, fazaId })}>
        {santierId ? "Trimite direct pe șantier" : "Adaugă în stoc"}
      </button>
    </Foaie>
  );
}

function FormCerereAlimentare({ camion, santiere = [], onTrimite, onClose }) {
  const [litri, setLitri] = useState("");
  const [cost, setCost] = useState("");
  const [km, setKm] = useState("");
  const [santierId, setSantierId] = useState("");
  const [note, setNote] = useState("");
  const [poza, setPoza] = useState(null);
  const [procesez, setProcesez] = useState(false);
  const [eroarePoza, setEroarePoza] = useState("");
  const [trimit, setTrimit] = useState(false);

  const pretLitru = Number(litri) > 0 && Number(cost) > 0 ? (Number(cost) / Number(litri)).toFixed(2) : null;
  const valid = Number(litri) > 0 && Number(cost) > 0;

  const alegePoza = async (e) => {
    const fis = e.target.files?.[0];
    e.target.value = "";
    if (!fis) return;
    setEroarePoza(""); setProcesez(true); setPoza(null);
    try {
      const dataUrl = await comprimaPoza(fis);
      setPoza({ dataUrl, fisier: fis });
    } catch (er) {
      setEroarePoza(er.message || "Poza nu s-a putut procesa.");
    }
    setProcesez(false);
  };

  const trimite = async () => {
    if (!valid) return;
    setTrimit(true);
    await onTrimite(
      { litri, cost, km: km || undefined, santierId: santierId || null, note, data: aziISO() },
      poza?.fisier || null
    );
  };

  return (
    <Foaie titlu={`Am făcut plinul: ${camion.nume}`} onClose={onClose}>
      <div className="sub" style={{ marginBottom: 12 }}>
        Trimiți spre aprobare — șeful vede suma și decide. Dacă ai bonul, fă-i o poză, ajută la
        verificare.
      </div>
      <div className="rand2">
        <div className="camp"><label>Litri *</label>
          <input type="number" step="0.1" value={litri} onChange={(e) => setLitri(e.target.value)}
            placeholder="ex. 65" autoFocus /></div>
        <div className="camp"><label>Cost total (€) *</label>
          <input type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)}
            placeholder="ex. 112" /></div>
      </div>
      {pretLitru && <div className="sub" style={{ marginTop: -6, marginBottom: 12 }}>≈ {pretLitru} €/litru</div>}

      <div className="camp"><label>Km curent (opțional)</label>
        <input type="number" value={km} onChange={(e) => setKm(e.target.value)} placeholder={camion.km ? String(camion.km) : "ex. 185200"} />
      </div>

      {santiere.length > 0 && (
        <div className="camp">
          <label>Pe ce șantier (opțional)</label>
          <select value={santierId} onChange={(e) => setSantierId(e.target.value)}>
            <option value="">— fără —</option>
            {santiere.map((x) => <option key={x.id} value={x.id}>{x.nume}</option>)}
          </select>
        </div>
      )}

      <div className="camp"><label>Poză bon (opțional)</label>
        <label className="buton-poza">
          <input type="file" accept="image/*" onChange={alegePoza}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", fontSize: 0 }} />
          {procesez ? "Se pregătește poza…" : poza ? "Schimbă poza" : "📷 Fă o poză bonului"}
        </label>
        {poza && <img className="poza" src={poza.dataUrl} alt="" style={{ marginTop: 10 }} />}
        {eroarePoza && <div className="sub" style={{ color: "var(--rosu)", marginTop: 6 }}>{eroarePoza}</div>}
      </div>

      <div className="camp"><label>Note (opțional)</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex. Total, Angers" />
      </div>

      <button className="btn btn-galben" disabled={!valid || trimit || procesez} onClick={trimite}>
        {trimit ? "Se trimite…" : "Trimite spre aprobare"}
      </button>
    </Foaie>
  );
}

function AprobaAlimentare({ al, camion, onAproba, onClose }) {
  const [litri, setLitri] = useState(al.litri);
  const [cost, setCost] = useState(al.cost);
  const schimbat = Number(litri) !== Number(al.litri) || Number(cost) !== Number(al.cost);

  return (
    <Foaie titlu={`Aprobă alimentarea: ${camion?.nume || ""}`} onClose={onClose}>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="sub" style={{ marginTop: 0 }}>
          {al.nume} a cerut <b className="mono">{al.litri} L</b> · {bani(al.cost)}, {dataRo(al.data)}
          {al.note && <><br />„{al.note}"</>}
        </div>
        {(al.fotoId || al.fotoData) && <Poza fotoId={al.fotoId} fotoData={al.fotoData} />}
      </div>

      <div className="rand2">
        <div className="camp"><label>Litri</label>
          <input type="number" step="0.1" value={litri} onChange={(e) => setLitri(e.target.value)} /></div>
        <div className="camp"><label>Cost (€)</label>
          <input type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
      </div>

      {schimbat && (
        <div className="sub" style={{ color: "var(--galben)", marginBottom: 12 }}>
          Ai schimbat față de ce a cerut — omul vede diferența în istoricul lui.
        </div>
      )}

      <button className="btn btn-galben" onClick={() => onAproba(litri, cost)}>
        Aprobă {litri} L · {bani(cost)}
      </button>
    </Foaie>
  );
}

function AprobaSuplimentare({ sup, angajat, santier, onAproba, onClose }) {
  const [ore, setOre] = useState(sup.ore);
  const [nota, setNota] = useState("");
  const cost = ore * (Number(angajat?.tarifOra) || 0);
  const schimbat = Number(ore) !== Number(sup.ore);

  return (
    <Foaie titlu={`Aprobă: ${sup.nume}`} onClose={onClose}>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="sub" style={{ marginTop: 0 }}>
          A cerut <b className="mono">{sup.ore}h</b> pe {santier?.nume || "—"}, {dataRo(sup.data)}
          {sup.motivCerere && <><br />„{sup.motivCerere}"</>}
        </div>
      </div>

      <div className="camp">
        <label>Câte ore aprobi</label>
        <div className="stepper">
          <button onClick={() => setOre(Math.max(0.5, +(ore - 0.5).toFixed(1)))}>−</button>
          <div>
            <div className="st-nr mono">{ore}</div>
            <div className="st-um">ore</div>
          </div>
          <button onClick={() => setOre(+(ore + 0.5).toFixed(1))}>+</button>
        </div>
      </div>

      {schimbat && (
        <div className="sub" style={{ color: "var(--galben)", marginBottom: 12 }}>
          A cerut {sup.ore}h, aprobi {ore}h — diferența trebuie explicată omului mai jos.
        </div>
      )}

      {cost > 0 && <div className="sub" style={{ marginBottom: 12 }}>Cost: <b>{bani(cost)}</b></div>}

      {schimbat && (
        <div className="camp">
          <label>De ce ai schimbat (îl vede omul)</label>
          <textarea rows={2} value={nota} onChange={(e) => setNota(e.target.value)}
            placeholder="ex. ai stat 3h dar înregistrate erau doar 2h lucrate" />
        </div>
      )}

      <button className="btn btn-galben" onClick={() => onAproba(ore, nota.trim())}>
        Aprobă {ore}h
      </button>
    </Foaie>
  );
}

function FormMaterial({ item, santiere = [], categorii = [], onSalveaza, onClose }) {
  const [f, setF] = useState(item || { nume: "", categorie: "", cant: "", unitate: "buc", minim: "", pret: "", locatie: "" });
  const [dest, setDest] = useState({ santierId: "", fazaId: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const santierAles = santiere.find((x) => x.id === dest.santierId);
  const fazeleLui = Array.isArray(santierAles?.faze) ? santierAles.faze : [];
  const valoare = (Number(f.cant) || 0) * (Number(f.pret) || 0);
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
      <div className="camp"><label>Categorie</label>
        {f.categorie === "__noua__" || (f.categorie && !categorii.includes(f.categorie)) ? (
          <div style={{ display: "flex", gap: 8 }}>
            <input value={f.categorie === "__noua__" ? "" : f.categorie}
              onChange={(e) => setF({ ...f, categorie: e.target.value })}
              placeholder="ex. Zidărie" autoFocus style={{ flex: 1 }} />
            {categorii.length > 0 && (
              <button className="btn btn-mic" onClick={() => setF({ ...f, categorie: categorii[0] })}>
                Anulează
              </button>
            )}
          </div>
        ) : (
          <select value={f.categorie} onChange={set("categorie")}>
            <option value="">— fără categorie —</option>
            {categorii.map((c) => <option key={c}>{c}</option>)}
            <option value="__noua__">+ Categorie nouă…</option>
          </select>
        )}
      </div>
      <div className="camp"><label>Locație</label>
        <input value={f.locatie} onChange={set("locatie")} placeholder="ex. Depozit" /></div>

      {!item && santiere.length > 0 && (
        <>
          <div className="sectiune">Unde a ajuns marfa</div>
          <div className="camp">
            <select value={dest.santierId}
              onChange={(e) => setDest({ santierId: e.target.value, fazaId: "" })}>
              <option value="">🏠 În depozit</option>
              {santiere.map((x) => <option key={x.id} value={x.id}>🏗 Direct pe {x.nume}</option>)}
            </select>
          </div>

          {fazeleLui.length > 0 && (
            <div className="camp">
              <label>Pe ce fază</label>
              <select value={dest.fazaId} onChange={(e) => setDest({ ...dest, fazaId: e.target.value })}>
                <option value="">— nealocat pe fază —</option>
                {fazeleLui.map((fz) => <option key={fz.id} value={fz.id}>{fz.nume}</option>)}
              </select>
            </div>
          )}

          <div className="sub" style={{ marginBottom: 12, lineHeight: 1.55 }}>
            {dest.santierId
              ? <>Marfa nu intră în stoc — se trece direct pe <b>{santierAles?.nume}</b> ca material consumat
                  {valoare > 0 && <>, {bani(valoare)}</>}. Materialul rămâne în listă cu stoc 0, ca să-l poți recomanda data viitoare.</>
              : <>Intră în stoc, la depozit. De acolo îl repartizezi pe șantiere când pleacă.</>}
          </div>
        </>
      )}

      <button className="btn btn-galben"
        onClick={() => f.nume.trim() && onSalveaza({ ...f, cant: Number(f.cant) || 0, pret: Number(f.pret) || 0 }, dest)}>
        Salvează
      </button>
    </Foaie>
  );
}

function FormScula({ item, categorii = [], onSalveaza, onClose }) {
  const [f, setF] = useState(item || { nume: "", cod: "", pret: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Foaie titlu={item ? "Modifică sculă" : "Sculă nouă"} onClose={onClose}>
      <div className="camp"><label>Denumire *</label>
        <input value={f.nume} onChange={set("nume")} placeholder="ex. Flex Makita 230mm" /></div>
      <div className="camp"><label>Categorie</label>
        {f.categorie === "__noua__" || (f.categorie && !categorii.includes(f.categorie)) ? (
          <div style={{ display: "flex", gap: 8 }}>
            <input value={f.categorie === "__noua__" ? "" : f.categorie}
              onChange={(e) => setF({ ...f, categorie: e.target.value })}
              placeholder="ex. Electrice" autoFocus style={{ flex: 1 }} />
            {categorii.length > 0 && (
              <button className="btn btn-mic" onClick={() => setF({ ...f, categorie: categorii[0] })}>
                Anulează
              </button>
            )}
          </div>
        ) : (
          <select value={f.categorie || ""} onChange={set("categorie")}>
            <option value="">— fără categorie —</option>
            {categorii.map((c) => <option key={c}>{c}</option>)}
            <option value="__noua__">+ Categorie nouă…</option>
          </select>
        )}
      </div>
      <div className="rand2">
        <div className="camp"><label>Cod / serie</label>
          <input value={f.cod} onChange={set("cod")} placeholder="ex. SC-014" /></div>
        <div className="camp"><label>Preț achiziție (€)</label>
          <input type="number" step="0.01" value={f.pret} onChange={set("pret")} placeholder="ex. 220" /></div>
      </div>
      <label className="rand-bifa" style={{ marginBottom: 11 }}>
        <input type="checkbox" checked={!!f.comun} onChange={(e) => setF({ ...f, comun: e.target.checked })} />
        <span>Utilaj comun
          <span className="rb-sub">Se mută între echipe — betonieră, excavator, telescopic, dumper, schelă. Orice echipă vede cine îl are acum.</span>
        </span>
      </label>
      <button className="btn btn-galben" onClick={() => f.nume.trim() && onSalveaza({ ...f, pret: Number(f.pret) || 0 })}>Salvează</button>
    </Foaie>
  );
}

function FormEchipa({ item, santiere = [], camioane = [], onSalveaza, onClose }) {
  const [f, setF] = useState(item || { nume: "", santierId: "", camioaneIds: [] });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const comutaCamion = (id) => {
    const l = f.camioaneIds || [];
    setF({ ...f, camioaneIds: l.includes(id) ? l.filter((x) => x !== id) : [...l, id] });
  };
  return (
    <Foaie titlu={item ? "Modifică echipă" : "Echipă nouă"} onClose={onClose}>
      <div className="camp"><label>Nume echipă *</label>
        <input value={f.nume} onChange={set("nume")} placeholder="ex. Echipa 1 — Zidărie" /></div>

      <div className="camp">
        <label>Camion / utilaj alocat</label>
        {camioane.length === 0 ? (
          <div className="sub">Niciun vehicul în evidență — le adaugi din Setări → Camioane.</div>
        ) : (
          camioane.map((c) => (
            <label key={c.id} className="rand-bifa">
              <input type="checkbox" checked={(f.camioaneIds || []).includes(c.id)} onChange={() => comutaCamion(c.id)} />
              <span>{c.nume}<span className="rb-sub">{c.numar || "fără număr"}</span></span>
            </label>
          ))
        )}
      </div>

      <div className="camp">
        <label>Șantier fix (opțional)</label>
        <select value={f.santierId || ""} onChange={set("santierId")}>
          <option value="">— fără, se stabilește prin planing —</option>
          {santiere.map((x) => <option key={x.id} value={x.id}>{x.nume}</option>)}
        </select>
        <div className="sub" style={{ marginTop: 6 }}>
          Dacă echipa merge mereu pe același șantier, alege-l aici — folosește la
          completarea automată a planingului (⚡ din tab-ul Planing).
        </div>
      </div>

      <button className="btn btn-galben" onClick={() => f.nume.trim() && onSalveaza(f)}>Salvează</button>
    </Foaie>
  );
}

function FormAngajat({ item, echipe, esteProprietar, roluriFirma = [], onSalveaza, onClose }) {
  const [f, setF] = useState(item || {
    nume: "", telefon: "", tip: "santier", grad: "Muncitor", echipaId: "",
    dataAngajare: "", tarifOra: "", tarif: "", salariuLunar: "", note: "",
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const eBirou = f.tip === "birou";

  const alegeTip = (tip) => {
    const gradeNoi = tip === "birou" ? GRADE_BIROU : GRADE;
    setF({ ...f, tip, grad: gradeNoi[0], echipaId: "" });
  };

  return (
    <Foaie titlu={item ? "Modifică angajat" : "Angajat nou"} onClose={onClose}>
      <div className="camp">
        <label>Unde lucrează</label>
        <div className="subtab">
          <button className={!eBirou ? "activ" : ""} onClick={() => alegeTip("santier")}>🏗 Pe șantier</button>
          <button className={eBirou ? "activ" : ""} onClick={() => alegeTip("birou")}>🏢 La birou</button>
        </div>
      </div>

      <div className="camp"><label>Nume complet *</label>
        <input value={f.nume} onChange={set("nume")} placeholder="ex. Ionuț Popescu" /></div>

      <div className="rand2">
        <div className="camp"><label>Grad / funcție</label>
          <select value={f.grad} onChange={set("grad")}>
            {(eBirou ? GRADE_BIROU : GRADE).map((g) => <option key={g}>{g}</option>)}
          </select></div>
        {!eBirou && (
          <div className="camp"><label>Echipă</label>
            <select value={f.echipaId || ""} onChange={set("echipaId")}>
              <option value="">Fără echipă</option>
              {echipe.map((e) => <option key={e.id} value={e.id}>{e.nume}</option>)}
            </select></div>
        )}
      </div>

      <div className="rand2">
        <div className="camp"><label>Telefon</label>
          <input value={f.telefon} onChange={set("telefon")} placeholder="06…" /></div>
        <div className="camp"><label>Data angajării</label>
          <input type="date" value={f.dataAngajare} onChange={set("dataAngajare")} /></div>
      </div>

      {eBirou ? (
        <div className="rand2">
          <div className="camp"><label>Salariu lunar (€)</label>
            <input type="number" step="10" value={f.salariuLunar} onChange={set("salariuLunar")} placeholder="ex. 2200" /></div>
          <div className="camp"><label>Detalii plată</label>
            <input value={f.tarif} onChange={set("tarif")} placeholder="ex. net, cu tichete" /></div>
        </div>
      ) : (
        <div className="rand2">
          <div className="camp"><label>Cost orar (€/h) *pentru calcul</label>
            <input type="number" step="0.5" value={f.tarifOra} onChange={set("tarifOra")} placeholder="ex. 22" /></div>
          <div className="camp"><label>Salariu / detalii plată</label>
            <input value={f.tarif} onChange={set("tarif")} placeholder="ex. 2400 €/lună net" /></div>
        </div>
      )}

      {!eBirou && (
        <label className="rand-bifa" style={{ marginBottom: 11 }}>
          <input type="checkbox" checked={f.poateStoc ?? f.grad === "Șef de echipă"}
            onChange={(e) => setF({ ...f, poateStoc: e.target.checked })} />
          <span>Poate scădea materiale din stoc
            <span className="rb-sub">Notează de pe telefonul lui ce s-a consumat pe șantier</span>
          </span>
        </label>
      )}

      <div className="camp"><label>Note{eBirou ? "" : " (calificări, permis, observații)"}</label>
        <textarea rows={2} value={f.note} onChange={set("note")}
          placeholder={eBirou ? "ex. gestionează facturile, e liber vinerea" : "ex. Permis C, CACES nacelă, bun pe finisaje"} /></div>

      {esteProprietar && (
        <div className="camp">
          <label>Rol de firmă (opțional)</label>
          {roluriFirma.length === 0 ? (
            <div className="sub">
              N-ai creat încă niciun rol. Le faci din Setări → Roluri și permisiuni.
            </div>
          ) : (
            <select value={f.rolFirmaId || ""} onChange={(e) => setF({ ...f, rolFirmaId: e.target.value || null })}>
              <option value="">Fără — cont obișnuit</option>
              {roluriFirma.map((r) => <option key={r.id} value={r.id}>{r.nume}</option>)}
            </select>
          )}
          {f.rolFirmaId && (
            <div className="sub" style={{ marginTop: 6 }}>
              Intră cu parola lui, dar ajunge direct în panoul de admin, restrâns la ce-i dă rolul ăsta.
            </div>
          )}
        </div>
      )}

      <button className="btn btn-galben"
        onClick={() => f.nume.trim() && onSalveaza({ ...f, poateStoc: eBirou ? false : (f.poateStoc ?? f.grad === "Șef de echipă") })}>
        Salvează
      </button>
    </Foaie>
  );
}

function FisaAngajat({ angajat, echipe, numeEchipa, pontaj, santiere, roluriFirma = [], doarCitire, onEdit, onMuta, onSterge, onParola, onClose }) {
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
  const eBirou = angajat.tip === "birou";
  return (
    <Foaie titlu={`Fișă: ${angajat.nume}`} onClose={onClose}>
      {eBirou && <div className="fisa-rand"><span className="k">Unde lucrează</span><b>🏢 La birou</b></div>}
      {angajat.rolFirmaId && (
        <div className="fisa-rand"><span className="k">Rol de firmă</span><b style={{ color: "var(--galben)" }}>🔑 {numeRol(roluriFirma, angajat.rolFirmaId)}</b></div>
      )}
      <div className="fisa-rand"><span className="k">Grad</span><b>{angajat.grad || "—"}</b></div>
      {!eBirou && <div className="fisa-rand"><span className="k">Echipă</span><b>{numeEchipa(angajat.echipaId)}</b></div>}
      <div className="fisa-rand"><span className="k">Telefon</span><b className="mono">{angajat.telefon || "—"}</b></div>
      <div className="fisa-rand"><span className="k">Angajat din</span><b>{dataRo(angajat.dataAngajare)}</b></div>
      {eBirou ? (
        <div className="fisa-rand"><span className="k">Salariu lunar</span><b>{angajat.salariuLunar ? bani(angajat.salariuLunar) : "—"}</b></div>
      ) : (
        <div className="fisa-rand"><span className="k">Cost orar</span><b>{angajat.tarifOra ? bani(angajat.tarifOra) + "/h" : "—"}</b></div>
      )}
      <div className="fisa-rand"><span className="k">Plată</span><b>{angajat.tarif || "—"}</b></div>
      {!eBirou && (
        <div className="fisa-rand">
          <span className="k">Poate scădea din stoc</span>
          <b style={{ color: angajat.poateStoc ? "var(--verde)" : "var(--mut)" }}>{angajat.poateStoc ? "Da" : "Nu"}</b>
        </div>
      )}
      <div className="fisa-rand"><span className="k">Cont aplicație</span><b style={{ color: angajat.pin ? "var(--verde)" : "var(--mut)" }}>{angajat.pin ? "Parolă setată" : "Fără parolă"}</b></div>
      {!eBirou && (
        <div className="fisa-rand"><span className="k">Total pontat</span><b className="mono">{totalOre}h · {bani(totalCost)}</b></div>
      )}
      {!eBirou && Object.keys(peSantier).length > 0 && (
        <div className="lista-in-card">
          {Object.entries(peSantier).map(([nume, v]) => (
            <div key={nume}>🏗 {nume} · <b className="mono">{v.ore}h</b> · {bani(v.cost)}</div>
          ))}
        </div>
      )}
      {!eBirou && (() => {
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
      {!eBirou && !doarCitire && (
        <div className="camp" style={{ marginTop: 14 }}>
          <label>Mută rapid în altă echipă</label>
          <select value={angajat.echipaId || ""} onChange={(e) => onMuta(e.target.value || null)}>
            <option value="">Fără echipă</option>
            {echipe.map((e) => <option key={e.id} value={e.id}>{e.nume}</option>)}
          </select>
        </div>
      )}
      {doarCitire && (
        <div className="sub" style={{ margin: "10px 0" }}>
          Doar proprietarul poate modifica sau șterge angajați.
        </div>
      )}
      {!doarCitire && (
      <div className="actiuni">
        <button className="btn btn-mic principal" onClick={onEdit}>Modifică fișa</button>
        <button className="btn btn-mic" onClick={onParola}>{angajat.pin ? "Resetează parola" : "Setează parola"}</button>
        <button className="btn btn-mic pericol" onClick={onSterge}>Șterge angajatul</button>
      </div>
      )}
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


function FormAlimentare({ camion, santiere = [], onSalveaza, onClose }) {
  const [litri, setLitri] = useState("");
  const [cost, setCost] = useState("");
  const [km, setKm] = useState("");
  const [santierId, setSantierId] = useState("");
  const [note, setNote] = useState("");

  const pretLitru = Number(litri) > 0 && Number(cost) > 0 ? (Number(cost) / Number(litri)).toFixed(2) : null;
  const valid = Number(litri) > 0 && Number(cost) > 0;

  return (
    <Foaie titlu={`Alimentare: ${camion.nume}`} onClose={onClose}>
      <div className="rand2">
        <div className="camp"><label>Litri *</label>
          <input type="number" step="0.1" value={litri} onChange={(e) => setLitri(e.target.value)}
            placeholder="ex. 65" autoFocus /></div>
        <div className="camp"><label>Cost total (€) *</label>
          <input type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)}
            placeholder="ex. 112" /></div>
      </div>
      {pretLitru && <div className="sub" style={{ marginTop: -6, marginBottom: 12 }}>≈ {pretLitru} €/litru</div>}

      <div className="camp"><label>Km curent (opțional)</label>
        <input type="number" value={km} onChange={(e) => setKm(e.target.value)} placeholder={camion.km ? String(camion.km) : "ex. 185200"} />
      </div>

      {santiere.length > 0 && (
        <div className="camp">
          <label>Pe ce șantier (opțional)</label>
          <select value={santierId} onChange={(e) => setSantierId(e.target.value)}>
            <option value="">— fără, cost general —</option>
            {santiere.map((x) => <option key={x.id} value={x.id}>{x.nume}</option>)}
          </select>
          <div className="sub" style={{ marginTop: 6 }}>
            Dacă alegi un șantier, costul intră direct în marja lui. Altfel rămâne cheltuială
            generală a firmei.
          </div>
        </div>
      )}

      <div className="camp"><label>Note (opțional)</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex. Total, Angers" />
      </div>

      <button className="btn btn-galben" disabled={!valid}
        onClick={() => valid && onSalveaza({
          data: azi(), tip: `⛽ Alimentare ${litri} L`, cost, km: km || undefined,
          note, santierId: santierId || null,
        })}>
        Salvează
      </button>
    </Foaie>
  );
}

function FormCerere({ eu, santiere = [], materiale = [], tipInitial, onTrimite, onClose }) {
  const esteSefEchipa = eu?.grad === "Șef de echipă";
  const [tip, setTip] = useState(tipInitial || "problema");
  const [text, setText] = useState("");
  const [dataPlaning, setDataPlaning] = useState(aziISO());
  const [oameniCeruti, setOameniCeruti] = useState(1);
  const [dataResurse, setDataResurse] = useState(aziISO());
  const [santierId, setSantierId] = useState(santiere[0]?.id || "");
  const [linii, setLinii] = useState([]);        // materialele cerute
  const [cauta, setCauta] = useState("");
  const [alege, setAlege] = useState(false);     // ecranul de ales din stoc

  const santier = santiere.find((x) => x.id === santierId);
  const gasite = cauta.trim()
    ? materiale.filter((m) => m.nume.toLowerCase().includes(cauta.trim().toLowerCase()))
    : materiale;

  const adaugaDinStoc = (m) => {
    if (linii.some((l) => l.materialId === m.id)) { setAlege(false); setCauta(""); return; }
    setLinii([...linii, { materialId: m.id, nume: m.nume, unitate: m.unitate, cant: 1, stoc: m.cant }]);
    setAlege(false); setCauta("");
  };
  const adaugaLiber = () => {
    if (!cauta.trim()) return;
    setLinii([...linii, { materialId: null, nume: cauta.trim(), unitate: "buc", cant: 1, stoc: null }]);
    setAlege(false); setCauta("");
  };
  const setCant = (i, v) => setLinii(linii.map((l, j) => (j === i ? { ...l, cant: Math.max(0.5, v) } : l)));
  const scoate = (i) => setLinii(linii.filter((_, j) => j !== i));

  /* ecranul de ales material */
  if (alege)
    return (
      <Foaie titlu="Ce vă trebuie?" onClose={() => { setAlege(false); setCauta(""); }}>
        <input className="cautare" placeholder="Caută sau scrie ce vă trebuie…" value={cauta}
          onChange={(e) => setCauta(e.target.value)} autoFocus />
        {gasite.map((m) => (
          <button key={m.id} className="btn btn-mare" onClick={() => adaugaDinStoc(m)}>
            <span>📦 {m.nume}</span>
            <span className="bm-stoc">{m.cant} {m.unitate} în depozit</span>
          </button>
        ))}
        {cauta.trim() && (
          <button className="btn btn-mic" style={{ width: "100%", marginTop: 8 }} onClick={adaugaLiber}>
            + Cere „{cauta.trim()}" (nu e în depozit)
          </button>
        )}
        {!cauta.trim() && materiale.length === 0 && (
          <div className="gol-msg">Nu e nimic în depozit. Scrie mai sus ce vă trebuie.</div>
        )}
      </Foaie>
    );

  const valid = (tip === "problema" || tip === "planing" || tip === "resurse")
    ? text.trim().length > 0
    : (linii.length > 0 || text.trim().length > 0);

  const trimite = () => {
    const listaText = linii.map((l) => `${l.cant} ${l.unitate} ${l.nume}`).join(", ");
    const corp = tip === "necesar"
      ? [listaText, text.trim()].filter(Boolean).join(" — ")
      : text.trim();
    onTrimite({
      tip, text: corp,
      santierId: santierId || null,
      santierNume: santier?.nume || null,
      linii: tip === "necesar" ? linii : [],
      dataCeruta: tip === "planing" ? dataPlaning : tip === "resurse" ? dataResurse : null,
      oameniCeruti: tip === "resurse" ? oameniCeruti : null,
      autorId: eu?.id || null, autorNume: eu?.nume || "Necunoscut",
    });
  };

  return (
    <Foaie titlu="Raportează" onClose={onClose}>
      <div className="subtab">
        <button className={tip === "problema" ? "activ" : ""} onClick={() => setTip("problema")}>⚠ Problemă</button>
        <button className={tip === "necesar" ? "activ" : ""} onClick={() => setTip("necesar")}>📦 Am nevoie de…</button>
        <button className={tip === "planing" ? "activ" : ""} onClick={() => setTip("planing")}>🗓 Planing</button>
        {esteSefEchipa && (
          <button className={tip === "resurse" ? "activ" : ""} onClick={() => setTip("resurse")}>👷 Muncitori</button>
        )}
      </div>

      {santiere.length > 0 && (
        <div className="camp">
          <label>Pe ce șantier</label>
          <select value={santierId} onChange={(e) => setSantierId(e.target.value)}>
            {santiere.map((x) => <option key={x.id} value={x.id}>{x.nume}</option>)}
            <option value="">— altundeva / nu e legat de un șantier —</option>
          </select>
        </div>
      )}

      {tip === "necesar" && (
        <>
          <div className="camp">
            <label>Ce vă trebuie</label>
            {linii.map((l, i) => (
              <div key={i} className="rand-cerere">
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{l.nume}</div>
                  <div className="sub" style={{ marginTop: 1 }}>
                    {l.stoc === null
                      ? "nu e în depozit"
                      : <>în depozit: <b className="mono">{l.stoc} {l.unitate}</b></>}
                  </div>
                </div>
                <div className="rc-cant">
                  <button onClick={() => setCant(i, +(l.cant - 1).toFixed(1))}>−</button>
                  <span className="mono">{l.cant}</span>
                  <button onClick={() => setCant(i, +(l.cant + 1).toFixed(1))}>+</button>
                </div>
                <button className="btn-sterge-plan" onClick={() => scoate(i)}>✕</button>
              </div>
            ))}
            <button className="btn btn-mic" style={{ width: "100%", marginTop: linii.length ? 8 : 0 }}
              onClick={() => setAlege(true)}>
              + Adaugă material
            </button>
          </div>

          <div className="camp">
            <label>Altceva de spus (opțional)</label>
            <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)}
              placeholder="ex. ne ajunge până joi, aduceți dacă se poate mâine" />
          </div>
        </>
      )}

      {tip === "planing" && (
        <div className="camp">
          <label>Pentru ce zi</label>
          <input type="date" value={dataPlaning} onChange={(e) => setDataPlaning(e.target.value)} />
        </div>
      )}

      {tip === "resurse" && (
        <>
          <div className="camp">
            <label>Câți oameni în plus îți trebuie</label>
            <div className="stepper">
              <button onClick={() => setOameniCeruti(Math.max(1, oameniCeruti - 1))}>−</button>
              <div>
                <div className="st-nr mono">{oameniCeruti}</div>
                <div className="st-um">{oameniCeruti === 1 ? "om" : "oameni"}</div>
              </div>
              <button onClick={() => setOameniCeruti(oameniCeruti + 1)}>+</button>
            </div>
          </div>
          <div className="camp">
            <label>De când</label>
            <input type="date" value={dataResurse} onChange={(e) => setDataResurse(e.target.value)} />
          </div>
          <div className="camp">
            <label>De ce ai nevoie de ei</label>
            <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)}
              placeholder="ex. turnare placă joi, ne trebuie mână de lucru în plus o zi" /></div>
        </>
      )}

      {tip === "planing" && (
        <div className="camp">
          <label>Ce ai nevoie legat de planing</label>
          <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)}
            placeholder="ex. Echipa 1 ar trebui mutată luni pe alt șantier, clientul a cerut o zi mai devreme" /></div>
      )}

      {tip === "problema" && (
        <div className="camp">
          <label>Ce s-a întâmplat?</label>
          <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)}
            placeholder="ex. S-a stricat flexul mare, nu mai pornește" />
        </div>
      )}

      <div className="sub" style={{ marginBottom: 12 }}>Mesajul ajunge doar la admin.</div>
      <button className="btn btn-galben" disabled={!valid} onClick={() => valid && trimite()}>
        Trimite
      </button>
    </Foaie>
  );
}

const SECTIUNI_SETARI = [
  ["cifre", "📊", "Cifre și rentabilitate", "marje, aport pe om, pierderi"],
  ["oameni", "👷", "Oameni și echipe", "angajați, fișe, echipe"],
  ["rapoarte", "📄", "Raport lunar", "ore și costuri pe fiecare om"],
  ["dotare", "🧰", "Dotare echipe", "sculele obligatorii, verificări"],
  ["categorii", "🏷️", "Categorii materiale", "adaugă, redenumește, șterge"],
  ["categoriiScule", "🗂️", "Categorii scule", "adaugă, redenumește, șterge"],
  ["cont", "🔑", "Firmă, program, acces", "date firmă, orar, PIN, limbă"],
  ["invitatii", "📨", "Invită muncitorii", "linkuri și parole"],
  ["backup", "💾", "Backup și curățenie", "salvare, restaurare, poze"],
  ["roluri", "🔑", "Roluri și permisiuni", "cine ce poate face în aplicație"],
];

const NUME_ZI = { MO: "Luni", TU: "Marți", WE: "Miercuri", TH: "Joi", FR: "Vineri", SA: "Sâmbătă", SU: "Duminică" };
const SCURT_ZI = { MO: "L", TU: "Ma", WE: "Mi", TH: "J", FR: "V", SA: "S", SU: "D" };

function ProgramLucru({ program, onSchimba }) {
  const p = program || { start: "07:30", final: "16:00", pauza: 60, zile: ["MO","TU","WE","TH","FR"], special: {} };
  const [deschis, setDeschis] = useState(null);

  const set = (k, v) => onSchimba({ ...p, [k]: v });
  const comutaZi = (c) => {
    const zile = p.zile || [];
    set("zile", zile.includes(c) ? zile.filter((x) => x !== c) : [...zile, c]);
  };
  const setSpecial = (c, k, v) =>
    onSchimba({ ...p, special: { ...(p.special || {}), [c]: { ...programZi(p, c), [k]: v, } } });
  const scoateSpecial = (c) => {
    const sp = { ...(p.special || {}) };
    delete sp[c];
    onSchimba({ ...p, special: sp });
    setDeschis(null);
  };
  const adaugaSpecial = (c) => {
    onSchimba({ ...p, special: { ...(p.special || {}), [c]: { start: p.start, final: p.final, pauza: p.pauza } } });
    setDeschis(c);
  };

  const zileActive = (p.zile || []);
  const totalSapt = zileActive.reduce((t, c) => t + oreDinProgram(programZi(p, c)), 0);

  return (
    <>
      <div className="rand2" style={{ marginTop: 12 }}>
        <div className="camp">
          <label>De la ora</label>
          <input type="time" value={p.start} onChange={(e) => set("start", e.target.value)} />
        </div>
        <div className="camp">
          <label>Până la ora</label>
          <input type="time" value={p.final} onChange={(e) => set("final", e.target.value)} />
        </div>
      </div>

      <div className="camp">
        <label>Pauza de masă (nu se plătește)</label>
        <div style={{ display: "flex", gap: 6 }}>
          {[0, 30, 45, 60, 90].map((m) => (
            <button key={m}
              className={"btn btn-mic" + ((p.pauza ?? 60) === m ? " principal" : "")}
              style={{ flex: 1, padding: "10px 0" }}
              onClick={() => set("pauza", m)}>
              {m === 0 ? "fără" : m + " min"}
            </button>
          ))}
        </div>
      </div>

      <div className="camp">
        <label>Zile lucrătoare</label>
        <div style={{ display: "flex", gap: 6 }}>
          {CODURI_ZI.map((c) => (
            <button key={c}
              className={"btn btn-mic" + (zileActive.includes(c) ? " principal" : "")}
              style={{ flex: 1, padding: "10px 0" }}
              onClick={() => comutaZi(c)}>
              {SCURT_ZI[c]}
            </button>
          ))}
        </div>
      </div>

      <div className="sectiune">Zile cu program diferit</div>
      <div className="sub" style={{ marginBottom: 10 }}>
        Dacă vinerea ieșiți mai devreme, pune-i program propriu. Restul zilelor rămân pe cel standard.
      </div>

      {zileActive.map((c) => {
        const pz = programZi(p, c);
        const ore = oreDinProgram(pz);
        return (
          <div className="card" key={c} style={{ padding: "11px 13px" }}>
            <div className="card-rand" style={{ cursor: "pointer" }}
              onClick={() => (pz.special ? setDeschis(deschis === c ? null : c) : adaugaSpecial(c))}>
              <div>
                <div className="titlu" style={{ fontSize: 14 }}>{NUME_ZI[c]}</div>
                <div className="sub">
                  <span className="mono">{pz.start}–{pz.final}</span>
                  {pz.pauza > 0 && <> · pauză {pz.pauza} min</>}
                  {" · "}<b>{ore}h plătite</b>
                </div>
              </div>
              <span className={"chip " + (pz.special ? "alocat" : "gri")}>
                {pz.special ? (deschis === c ? "▲" : "Special") : "Standard"}
              </span>
            </div>

            {pz.special && deschis === c && (
              <div style={{ marginTop: 11 }}>
                <div className="rand2">
                  <div className="camp">
                    <label>De la</label>
                    <input type="time" value={pz.start} onChange={(e) => setSpecial(c, "start", e.target.value)} />
                  </div>
                  <div className="camp">
                    <label>Până la</label>
                    <input type="time" value={pz.final} onChange={(e) => setSpecial(c, "final", e.target.value)} />
                  </div>
                </div>
                <div className="camp">
                  <label>Pauză</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    {[0, 30, 45, 60].map((m) => (
                      <button key={m}
                        className={"btn btn-mic" + (pz.pauza === m ? " principal" : "")}
                        style={{ flex: 1, padding: "9px 0" }}
                        onClick={() => setSpecial(c, "pauza", m)}>
                        {m === 0 ? "fără" : m}
                      </button>
                    ))}
                  </div>
                </div>
                <button className="btn btn-mic" style={{ width: "100%" }} onClick={() => scoateSpecial(c)}>
                  Înapoi la programul standard
                </button>
              </div>
            )}
          </div>
        );
      })}

      {totalSapt > 0 && (
        <div className="rezumat" style={{ marginTop: 10 }}>
          <div>
            <div className="rz-nr mono">{(+totalSapt.toFixed(2)).toString().replace(".00", "")}h</div>
            <div className="rz-lbl">pe săptămână, plătite · {zileActive.length} zile</div>
          </div>
        </div>
      )}
    </>
  );
}

function MotivRefuz({ onTrimite }) {
  const [m, setM] = useState("");
  return (
    <>
      <div className="camp">
        <label>De ce? (îl vede omul)</label>
        <textarea rows={3} value={m} onChange={(e) => setM(e.target.value)}
          placeholder="ex. nu erau aprobate dinainte, vorbim mâine" />
      </div>
      <button className="btn btn-galben" onClick={() => onTrimite(m.trim())}>Trimite refuzul</button>
    </>
  );
}

function FormSuplimentare({ eu, santiere = [], program, onTrimite, onClose }) {
  const [santierId, setSantierId] = useState(santiere[0]?.id || "");
  const [data, setData] = useState(aziISO());
  const [ore, setOre] = useState(2);
  const [motiv, setMotiv] = useState("");
  const santier = santiere.find((x) => x.id === santierId);
  const p = program || {};

  return (
    <Foaie titlu="Ore peste program" onClose={onClose}>
      {(() => {
        const pz = programZi(p, codZiDinData(data));
        return (
          <div className="sub" style={{ marginBottom: 14 }}>
            În ziua aia programul e <b className="mono">{pz.start}–{pz.final}</b>
            {pz.pauza > 0 && <> cu {pz.pauza} min pauză</>} — adică {oreDinProgram(pz)}h.
            Scrie aici doar orele <b>în plus</b>. Șeful trebuie să le aprobe ca să intre la plată.
          </div>
        );
      })()}

      {santiere.length > 0 && (
        <div className="camp">
          <label>Pe ce șantier</label>
          <select value={santierId} onChange={(e) => setSantierId(e.target.value)}>
            {santiere.map((x) => <option key={x.id} value={x.id}>{x.nume}</option>)}
          </select>
        </div>
      )}

      <div className="camp">
        <label>Ziua</label>
        <input type="date" value={data} max={aziISO()} onChange={(e) => setData(e.target.value)} />
      </div>

      <div className="camp">
        <label>Câte ore în plus</label>
        <div className="stepper">
          <button onClick={() => setOre(Math.max(0.5, +(ore - 0.5).toFixed(1)))}>−</button>
          <div>
            <div className="st-nr mono">{ore}</div>
            <div className="st-um">ore</div>
          </div>
          <button onClick={() => setOre(Math.min(12, +(ore + 0.5).toFixed(1)))}>+</button>
        </div>
      </div>

      <div className="camp">
        <label>De ce ai stat peste program</label>
        <textarea rows={3} value={motiv} onChange={(e) => setMotiv(e.target.value)}
          placeholder="ex. am terminat turnarea plăcii, nu se putea lăsa" />
      </div>

      <button className="btn btn-galben" disabled={!santierId || !ore || !motiv.trim()}
        onClick={() => onTrimite({
          angajatId: eu?.id, nume: eu?.nume, santierId, data,
          ore, motivCerere: motiv.trim(),
        })}>
        Trimite spre aprobare
      </button>
    </Foaie>
  );
}

function RaportLunar({ db, bani, dataRo, onRaport }) {
  const azi = new Date();
  const [an, setAn] = useState(azi.getFullYear());
  const [luna, setLuna] = useState(azi.getMonth() + 1);

  const prefix = `${an}-${String(luna).padStart(2, "0")}`;
  const pontLuna = db.pontaj.filter((p) => (p.data || "").startsWith(prefix));
  const oreLuna = pontLuna.reduce((t, p) => t + (Number(p.ore) || 0), 0);
  const costLuna = pontLuna.reduce((t, p) => t + (Number(p.ore) || 0) * (Number(p.tarifOra) || 0), 0);
  const oameniLuna = new Set(pontLuna.map((p) => p.angajatId)).size;

  const numeLuni = ["Ian", "Feb", "Mar", "Apr", "Mai", "Iun", "Iul", "Aug", "Sep", "Oct", "Noi", "Dec"];

  return (
    <>
      <div className="card">
        <div className="titlu">📄 Raport lunar pe fiecare om</div>
        <div className="sub">
          Ore, zile lucrate, suplimentare și cost, defalcate pe fiecare angajat și pe șantierele
          lui. Se deschide ca pagină de tipărit — de acolo alegi „Salvează ca PDF".
        </div>
      </div>

      <div className="camp">
        <label>Luna</label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {numeLuni.map((n, i) => (
            <button key={i} className={"btn btn-mic" + (luna === i + 1 ? " principal" : "")}
              style={{ minWidth: 44 }} onClick={() => setLuna(i + 1)}>{n}</button>
          ))}
        </div>
      </div>
      <div className="camp">
        <label>Anul</label>
        <div style={{ display: "flex", gap: 6 }}>
          {[azi.getFullYear() - 1, azi.getFullYear()].map((a) => (
            <button key={a} className={"btn btn-mic" + (an === a ? " principal" : "")} onClick={() => setAn(a)}>{a}</button>
          ))}
        </div>
      </div>

      <div className="rezumat" style={{ marginTop: 6 }}>
        <div>
          <div className="rz-nr mono">{+oreLuna.toFixed(1)}h</div>
          <div className="rz-lbl">{oameniLuna} {oameniLuna === 1 ? "om" : "oameni"} · {bani(costLuna)}</div>
        </div>
      </div>

      <button className="btn btn-galben" disabled={pontLuna.length === 0}
        onClick={() => onRaport(an, luna)}>
        {pontLuna.length === 0 ? "Nimic pontat în luna asta" : "Deschide raportul (PDF)"}
      </button>
    </>
  );
}

function EditorFaze({ faze, onSchimba }) {
  const [deschis, setDeschis] = useState(null);

  const seteaza = (i, k, v) => {
    const l = [...faze]; l[i] = { ...l[i], [k]: v }; onSchimba(l);
  };
  const adauga = () => {
    onSchimba([...faze, { id: uid(), nume: "", domeniu: DOMENII[0], valoare: "", orePrev: "", materialePrev: [] }]);
    setDeschis(faze.length);
  };
  const scoate = (i) => { onSchimba(faze.filter((_, j) => j !== i)); setDeschis(null); };

  const setMat = (i, j, k, v) => {
    const mats = [...(faze[i].materialePrev || [])];
    mats[j] = { ...mats[j], [k]: v };
    seteaza(i, "materialePrev", mats);
  };
  const adaugaMat = (i) =>
    seteaza(i, "materialePrev", [...(faze[i].materialePrev || []), { nume: "", cant: "", unitate: "buc", pret: "" }]);
  const scoateMat = (i, j) =>
    seteaza(i, "materialePrev", (faze[i].materialePrev || []).filter((_, k) => k !== j));

  const totalMat = (f) =>
    (f.materialePrev || []).reduce((t, m) => t + (Number(m.cant) || 0) * (Number(m.pret) || 0), 0);
  const totalCifrat = faze.reduce((t, f) => t + (Number(f.valoare) || 0), 0);
  const totalOre = faze.reduce((t, f) => t + (Number(f.orePrev) || 0), 0);

  return (
    <>
      {faze.map((f, i) => (
        <div className="card" key={f.id || i} style={{ padding: "12px 13px" }}>
          <div className="card-rand" onClick={() => setDeschis(deschis === i ? null : i)} style={{ cursor: "pointer" }}>
            <div>
              <div className="titlu" style={{ fontSize: 14.5 }}>
                {f.nume || <span style={{ color: "var(--mut)" }}>Fază fără nume</span>}
              </div>
              <div className="sub">
                {f.domeniu} · <b className="mono">{bani(f.valoare)}</b>
                {Number(f.orePrev) > 0 && <> · {f.orePrev}h</>}
                {totalMat(f) > 0 && <> · materiale {bani(totalMat(f))}</>}
              </div>
            </div>
            <span className="chip gri">{deschis === i ? "▲" : "▼"}</span>
          </div>

          {deschis === i && (
            <div style={{ marginTop: 12 }}>
              <div className="camp">
                <label>Numele fazei *</label>
                <input value={f.nume} onChange={(e) => seteaza(i, "nume", e.target.value)}
                  placeholder="ex. Demolare interioară" />
              </div>
              <div className="camp">
                <label>Tip de lucrare</label>
                <select value={f.domeniu} onChange={(e) => seteaza(i, "domeniu", e.target.value)}>
                  {DOMENII.map((d) => <option key={d}>{d}</option>)}
                </select>
              </div>
              <div className="rand2">
                <div className="camp">
                  <label>Cifrat pe fază</label>
                  <input type="number" step="0.01" value={f.valoare}
                    onChange={(e) => seteaza(i, "valoare", e.target.value)} placeholder="ex. 6200" />
                </div>
                <div className="camp">
                  <label>Ore prevăzute</label>
                  <input type="number" value={f.orePrev}
                    onChange={(e) => seteaza(i, "orePrev", e.target.value)} placeholder="ex. 120" />
                </div>
              </div>

              <div className="camp">
                <label>Materiale prevăzute pe fază
                  {totalMat(f) > 0 && <span style={{ color: "var(--galben)" }}> · {bani(totalMat(f))}</span>}
                </label>
                {(f.materialePrev || []).map((m, j) => (
                  <div key={j} className="rand-prev">
                    <input value={m.nume} onChange={(e) => setMat(i, j, "nume", e.target.value)} placeholder="Material" />
                    <input type="number" value={m.cant} onChange={(e) => setMat(i, j, "cant", e.target.value)} placeholder="Cant." />
                    <input value={m.unitate} onChange={(e) => setMat(i, j, "unitate", e.target.value)} placeholder="u.m." />
                    <input type="number" step="0.01" value={m.pret} onChange={(e) => setMat(i, j, "pret", e.target.value)} placeholder="€/u" />
                    <button className="btn btn-mic pericol" onClick={() => scoateMat(i, j)}>✕</button>
                  </div>
                ))}
                <button className="btn btn-mic" style={{ marginTop: 8 }} onClick={() => adaugaMat(i)}>+ Adaugă linie</button>
              </div>

              <button className="btn btn-mic pericol" style={{ width: "100%" }} onClick={() => scoate(i)}>
                Șterge faza
              </button>
            </div>
          )}
        </div>
      ))}

      <button className="btn btn-mic" style={{ width: "100%", marginBottom: 12 }} onClick={adauga}>
        + Adaugă fază
      </button>

      {faze.length > 0 && (
        <div className="rezumat" style={{ marginBottom: 14 }}>
          <div>
            <div className="rz-nr mono">{bani(totalCifrat)}</div>
            <div className="rz-lbl">total cifrat · {faze.length} {faze.length === 1 ? "fază" : "faze"}</div>
          </div>
          {totalOre > 0 && <span className="chip alocat mono">{totalOre}h</span>}
        </div>
      )}
    </>
  );
}

function FormSantier({ item, onSalveaza, onClose }) {
  const [f, setF] = useState(
    item || { nume: "", client: "", adresa: "", dataStart: "", status: "activ",
      adresaFull: "", domeniu: DOMENII[0], valoare: "", orePrev: "", materialePrev: [], faze: [] }
  );
  const [peFaze, setPeFaze] = useState(Array.isArray(item?.faze) && item.faze.length > 0);
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
        <div className="camp"><label>Localitate</label>
          <input value={f.adresa} onChange={set("adresa")} placeholder="ex. Beaucouzé" /></div>
        <div className="camp"><label>Data începerii</label>
          <input type="date" value={f.dataStart} onChange={set("dataStart")} /></div>
      </div>

      <div className="camp">
        <label>Adresa completă (pentru navigare)</label>
        <input value={f.adresaFull || ""} onChange={set("adresaFull")}
          placeholder="ex. 12 rue des Tilleuls, 49070 Beaucouzé" />
        <div className="sub" style={{ marginTop: 6, display: "flex", justifyContent: "space-between",
          alignItems: "center", gap: 10 }}>
          <span>Oamenii apasă un buton și li se deschide în hărți.</span>
          <ButonHarta adresa={f.adresaFull} mic />
        </div>
      </div>

      <div className="sectiune">Devizul — ce ai prevăzut</div>
      <div className="subtab" style={{ marginBottom: 12 }}>
        <button className={!peFaze ? "activ" : ""} onClick={() => setPeFaze(false)}>O sumă</button>
        <button className={peFaze ? "activ" : ""} onClick={() => setPeFaze(true)}>Pe faze</button>
      </div>
      <div className="sub" style={{ marginBottom: 12 }}>
        {peFaze
          ? "Fiecare fază cu prețul ei — demolare, zidărie, tencuială. La pontaj alegi faza, iar marja se calculează separat pe fiecare."
          : "O singură sumă pentru toată lucrarea. Simplu, dar nu vezi care fază te-a costat."}
      </div>
      {peFaze && <EditorFaze faze={f.faze || []} onSchimba={(faze) => setF({ ...f, faze })} />}

      {!peFaze && <div className="rand2">
        <div className="camp"><label>La cât ai cifrat lucrarea (€)</label>
          <input type="number" step="0.01" value={f.valoare} onChange={set("valoare")} placeholder="ex. 18500" /></div>
        <div className="camp"><label>Ore prevăzute</label>
          <input type="number" value={f.orePrev} onChange={set("orePrev")} placeholder="ex. 320" /></div>
      </div>}

      {!peFaze && <div className="camp">
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
      </div>}

      <button className="btn btn-galben" style={{ marginTop: 8 }}
        onClick={() => f.nume.trim() && onSalveaza(
          peFaze
            ? { ...f, faze: (f.faze || []).filter((x) => x.nume.trim()),
                valoare: 0, orePrev: 0, materialePrev: [] }
            : { ...f, faze: [], valoare: Number(f.valoare) || 0, orePrev: Number(f.orePrev) || 0 })}>
        Salvează
      </button>
    </Foaie>
  );
}

function FormConsum({ santier, materiale, onSalveaza, onClose }) {
  const faze = Array.isArray(santier.faze) ? santier.faze : [];
  const [f, setF] = useState({ materialId: "", nume: "", cant: "", unitate: "buc", pret: "",
    data: aziISO(), scadeDinStoc: true, fazaId: faze[0]?.id || "" });
  const mat = materiale.find((m) => m.id === f.materialId);
  const alegeMaterial = (id) => {
    const m = materiale.find((x) => x.id === id);
    setF({ ...f, materialId: id, pret: m ? m.pret : f.pret, unitate: m ? m.unitate : f.unitate });
  };
  const total = (Number(f.cant) || 0) * (Number(f.pret) || 0);
  const valid = (f.materialId || f.nume.trim()) && Number(f.cant) > 0;
  return (
    <Foaie titlu={`Material folosit: ${santier.nume}`} onClose={onClose}>
      {faze.length > 0 && (
        <div className="camp">
          <label>Pe ce fază</label>
          <select value={f.fazaId} onChange={(e) => setF({ ...f, fazaId: e.target.value })}>
            {faze.map((fz) => <option key={fz.id} value={fz.id}>{fz.nume}</option>)}
            <option value="">— nealocat pe fază —</option>
          </select>
        </div>
      )}
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

function FormPontaj({ santier, angajati, echipe, program, pontajExistent = [], santiere = [], onSalveaza, onClose }) {
  const [data, setData] = useState(aziISO());
  const [ore, setOre] = useState(() =>
    String(oreDinProgram(programZi(program, codZiDinData(aziISO()))) || 8).replace(".00", ""));
  const ore1 = Number(ore) || 0;
  const faze = Array.isArray(santier.faze) ? santier.faze : [];
  const [fazaId, setFazaId] = useState(faze[0]?.id || "");
  const fazaAleasa = faze.find((x) => x.id === fazaId);
  const [tip, setTip] = useState(faze[0]?.domeniu || santier.domeniu || DOMENII[0]);
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

  /* ce are deja fiecare pontat în ziua asta, pe orice șantier */
  const dejaAzi = (id) => pontajExistent.filter((p) => p.angajatId === id && p.data === data);
  const oreDejaAzi = (id) => dejaAzi(id).reduce((t, p) => t + (Number(p.ore) || 0), 0);

  const dublate = alesi
    .map((a) => {
      const ore = oreDejaAzi(a.id);
      if (ore === 0) return null;
      const unde = [...new Set(dejaAzi(a.id).map((p) =>
        santiere.find((x) => x.id === p.santierId)?.nume || "alt șantier"))];
      const aici = unde.includes(santier.nume);
      return { a, ore, unde, aici, total: ore + (Number(ore1) || 0) };
    })
    .filter(Boolean);

  const oraNormala = oreDinProgram(programZi(program, codZiDinData(data)));
  const preaMulte = dublate.filter((d) => d.total > oraNormala + 4);

  return (
    <Foaie titlu={`Pontaj: ${santier.nume}`} onClose={onClose}>
      <div className="rand2">
        <div className="camp"><label>Data</label>
          <input type="date" value={data} onChange={(e) => {
            setData(e.target.value);
            const o = oreDinProgram(programZi(program, codZiDinData(e.target.value)));
            if (o) setOre(String(o).replace(".00", ""));
          }} /></div>
        <div className="camp"><label>Ore lucrate (fiecare)</label>
          <input type="number" step="0.5" value={ore} onChange={(e) => setOre(e.target.value)} /></div>
      </div>

      {faze.length > 0 && (
        <div className="camp">
          <label>Pe ce fază au lucrat *</label>
          <select value={fazaId} onChange={(e) => {
            setFazaId(e.target.value);
            const fz = faze.find((x) => x.id === e.target.value);
            if (fz?.domeniu) setTip(fz.domeniu);
          }}>
            {faze.map((fz) => <option key={fz.id} value={fz.id}>{fz.nume}</option>)}
          </select>
          {fazaAleasa && (
            <div className="sub" style={{ marginTop: 6 }}>
              Cifrat {bani(fazaAleasa.valoare)}
              {Number(fazaAleasa.orePrev) > 0 && <> · {fazaAleasa.orePrev}h prevăzute</>}
            </div>
          )}
        </div>
      )}

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
              <span style={{ color: "var(--mut)", fontSize: 12, marginLeft: "auto", textAlign: "right" }}>
                {oreDejaAzi(a.id) > 0
                  ? <b style={{ color: "var(--rosu)" }}>are deja {oreDejaAzi(a.id)}h azi</b>
                  : (Number(a.tarifOra) ? bani(a.tarifOra) + "/h" : "fără cost orar")}
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

      {dublate.length > 0 && (
        <div className="conflict">
          <b>⚠ Sunt deja pontați în ziua asta</b>
          {dublate.map((d, i) => (
            <div key={i} className="cf-rand">
              <b>{d.a.nume}</b> are <b className="mono">{d.ore}h</b> pe{" "}
              {d.unde.join(", ")}
              {d.aici && <span style={{ color: "var(--galben)" }}> (chiar aici)</span>}.
              {" "}Dacă salvezi, ajunge la <b className="mono">{+d.total.toFixed(1)}h</b> în ziua asta.
            </div>
          ))}
          <div className="cf-sfat">
            {preaMulte.length > 0
              ? "Pare o dublare — verifică dacă n-ai pontat deja o dată cu toată echipa."
              : "Dacă e corect (a lucrat pe două șantiere), poți salva liniștit."}
          </div>
          <div className="actiuni">
            <button className="btn btn-mic"
              onClick={() => {
                const nou = { ...sel };
                dublate.forEach((d) => { nou[d.a.id] = false; });
                setSel(nou);
              }}>
              Scoate-i pe cei {dublate.length === 1 ? "deja pontat" : "deja pontați"}
            </button>
          </div>
        </div>
      )}

      {faraTarif.length > 0 && (
        <div className="sub" style={{ color: "var(--rosu)", marginBottom: 10 }}>
          ⚠ {faraTarif.map((a) => a.nume).join(", ")} nu are cost orar setat — orele se pontează, dar costul iese 0. Completează-l din fișă.
        </div>
      )}
      <button className={"btn " + (preaMulte.length > 0 ? "btn-mic pericol" : "btn-galben")}
        style={preaMulte.length > 0 ? { width: "100%", padding: "13px" } : null}
        disabled={alesi.length === 0 || !Number(ore)}
        onClick={() => alesi.length && Number(ore) &&
          onSalveaza(data, alesi.map((a) => ({
            angajatId: a.id, nume: a.nume, ore, tarifOra: a.tarifOra,
            tipMunca: tipulLui(a.id), fazaId: fazaId || null,
          })))}>
        {preaMulte.length > 0
          ? `Pontează oricum (${preaMulte.map((d) => d.a.nume.split(" ")[0]).join(", ")} ar ajunge la ${+preaMulte[0].total.toFixed(1)}h)`
          : `Pontează ${alesi.length > 0 ? `${alesi.length} × ${ore}h` : ""}`}
      </button>
    </Foaie>
  );
}

function DetaliiSantier({ santier, pontaj, consum, bilant, matPrev, orePrevTot, bilanturiFaze = [], onStergePontaj, onStergeConsum, onClose }) {
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
  const orePrev = orePrevTot !== undefined ? orePrevTot : (Number(santier.orePrev) || 0);
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
      {(santier.adresaFull || santier.adresa) && (
        <div className="card" style={{ padding: "12px 13px" }}>
          <div className="card-rand">
            <div>
              <div className="titlu" style={{ fontSize: 14 }}>📍 Adresă</div>
              <div className="sub">{santier.adresaFull || santier.adresa}</div>
            </div>
            <ButonHarta adresa={santier.adresaFull || santier.adresa} mic />
          </div>
        </div>
      )}
      <div className="fisa-rand"><span className="k">Cifrat</span><b className="mono">{bani(bilant.incasat)}</b></div>
      <div className="fisa-rand"><span className="k">Manoperă</span><b className="mono">−{bani(bilant.manopera)}</b></div>
      {bilant.taxe > 0 && (
        <div className="fisa-rand"><span className="k">Taxe pe salarii</span><b className="mono">−{bani(bilant.taxe)}</b></div>
      )}
      <div className="fisa-rand"><span className="k">Materiale</span><b className="mono">−{bani(bilant.materiale)}</b></div>
      {bilant.auto > 0 && (
        <div className="fisa-rand"><span className="k">Auto (combustibil/întreținere)</span><b className="mono">−{bani(bilant.auto)}</b></div>
      )}
      <div className="fisa-rand" style={{ borderBottom: "none", paddingTop: 12 }}>
        <span className="k"><b>Marjă</b></span>
        <b className="mono" style={{ fontSize: 17, color: bilant.marja >= 0 ? "var(--verde)" : "var(--rosu)" }}>
          {bilant.marja < 0 ? "−" : ""}{bani(Math.abs(bilant.marja))}{bilant.procent !== null && ` · ${bilant.procent}%`}
        </b>
      </div>

      {bilanturiFaze.length > 0 && (
        <>
          <div className="sectiune">Pe faze</div>
          {bilanturiFaze.map(({ faza, b }) => (
            <div className="card" key={faza.id} style={{ padding: "12px 13px" }}>
              <div className="card-rand">
                <div>
                  <div className="titlu" style={{ fontSize: 14.5 }}>{faza.nume}</div>
                  <div className="sub">{faza.domeniu} · cifrat {bani(b.incasat)}</div>
                </div>
                <b className="mono" style={{ color: b.marja >= 0 ? "var(--verde)" : "var(--rosu)", whiteSpace: "nowrap" }}>
                  {b.marja < 0 ? "−" : ""}{bani(Math.abs(b.marja))}
                  {b.procent !== null && <span style={{ fontSize: 11, color: "var(--mut)" }}> · {b.procent}%</span>}
                </b>
              </div>
              <div className="plan-real">
                <div className="pr-col">
                  <div className="pr-lbl">Ore</div>
                  <div className="pr-val mono" style={{ color: b.orePrev && b.ore > b.orePrev ? "var(--rosu)" : "var(--text)" }}>{b.ore}h</div>
                  <div className="pr-prev">din {b.orePrev ? b.orePrev + "h" : "—"}</div>
                </div>
                <div className="pr-col">
                  <div className="pr-lbl">Materiale</div>
                  <div className="pr-val mono" style={{ color: b.matPrev && b.materiale > b.matPrev ? "var(--rosu)" : "var(--text)" }}>{bani(b.materiale)}</div>
                  <div className="pr-prev">din {b.matPrev ? bani(b.matPrev) : "—"}</div>
                </div>
                <div className="pr-col">
                  <div className="pr-lbl">Manoperă</div>
                  <div className="pr-val mono">{bani(b.manopera)}</div>
                  <div className="pr-prev">plătită</div>
                </div>
              </div>
            </div>
          ))}
        </>
      )}

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
                  {p.suplimentar && <span className="chip alerta" style={{ marginLeft: 6, fontSize: 10 }}>supl.</span>}
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

function FormPlan({ item, data, santiere, echipe, angajati, planificare, program, onSalveaza, onSterge, onModificaAlta, onSalveazaAlta, onInlocuieste, onImparte, onCere, onClose }) {
  const [f, setF] = useState(
    item || { data, santierId: santiere.filter((s) => s.status !== "finalizat")[0]?.id || "",
      echipaId: "", angajatIds: [],
      oraStart: programZi(program, codZiDinData(data)).start,
      oraFinal: programZi(program, codZiDinData(data)).final, note: "" }
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
      {!x.fotoId && !x.fotoData && x.pozaStearsa && (
        <div className="poza-gol" style={{ padding: 12 }}>Poza a fost ștearsă automat (problemă rezolvată)</div>
      )}
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
