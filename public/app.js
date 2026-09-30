"use strict";

// --- Constantes ---------------------------------------------------------------------------

const ARMES = {
  FLE: { lettre: "F", nom: "Fleuret" },
  EPE: { lettre: "E", nom: "Épée" },
  SAB: { lettre: "S", nom: "Sabre" },
  LAS: { lettre: "L", nom: "Sabre laser" },
  ART: { lettre: "A", nom: "Artistique" },
};
const CATEGORIES = ["M5", "M7", "M9", "M11", "M13", "M15", "M17", "M20", "SENIOR", "V1", "V2", "V3", "V4"];
const SOURCES = { ffe: "FFE", cde91: "CDE 91", idf: "Ligue IDF" };
const TYPES = { tournoi: "Tournoi", epreuve: "Épreuve", championnat: "Championnat" };
const ECHELONS = { departemental: "départemental", regional: "régional", zone: "de zone", national: "national", international: "international" };
const CHAMPS_SIMPLES = ["region", "departement", "ville", "date_debut", "date_fin", "niveau", "equipe"];
const JOURS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];

const $ = (sel) => document.querySelector(sel);
const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const etat = {
  api: "",
  vue: "liste",
  competitions: [],
  moisAffiche: null, // Date (1er du mois) pour la vue Mois
  departements: [],
  requete: 0,
  cibles: [], // calendriers remplaçables (CDE 91, Ligue Fleuret / Épée / Sabre)
};

// --- Stockage local (préférences du testeur) ---------------------------------------------

function lirePref(cle, defaut) {
  try { return localStorage.getItem(cle) ?? defaut; } catch { return defaut; }
}
function ecrirePref(cle, valeur) {
  try { localStorage.setItem(cle, valeur); } catch { /* navigation privée */ }
}

// --- Dates --------------------------------------------------------------------------------

const dateLocale = (iso) => { const [a, m, j] = iso.split("-").map(Number); return new Date(a, m - 1, j); };
const isoLocale = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtJour = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" });
const fmtMois = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });
const fmtLong = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

function periode(c, format = fmtJour) {
  const debut = format.format(dateLocale(c.date_debut));
  return c.date_debut === c.date_fin ? debut : `${debut} → ${format.format(dateLocale(c.date_fin))}`;
}

// --- API ----------------------------------------------------------------------------------

async function appeler(chemin) {
  const r = await fetch(etat.api + chemin, { headers: { Accept: "application/json" } });
  if (!r.ok) {
    let detail = `${r.status} ${r.statusText}`;
    try { detail = (await r.json()).detail || detail; } catch { /* pas du JSON */ }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return r.json();
}

async function connecter() {
  etat.api = $("#api-url").value.trim().replace(/\/+$/, "");
  ecrirePref("api", etat.api);
  const pastille = $("#api-etat");
  pastille.className = "pastille";
  pastille.textContent = "connexion…";
  try {
    const ref = await appeler("/referentiel");
    remplirReferentiel(ref);
    pastille.className = "pastille ok";
    pastille.textContent = "connectée";
  } catch (e) {
    pastille.className = "pastille ko";
    pastille.textContent = "injoignable";
    pastille.title = e.message;
    remplirReferentiel({});
  }
  chargerCalendriers();
  appliquerParametres(new URLSearchParams(location.search));
  await rechercher();
}

// --- Filtres ------------------------------------------------------------------------------

function cases(conteneur, nom, items, puces = false) {
  conteneur.innerHTML = items
    .map(({ code, libelle }) =>
      puces
        ? `<label><input type="checkbox" name="${nom}" value="${esc(code)}"><span>${esc(libelle)}</span></label>`
        : `<label><input type="checkbox" name="${nom}" value="${esc(code)}"> ${esc(libelle)}</label>`)
    .join("");
}

function options(select, items, premier) {
  select.innerHTML = `<option value="">${premier}</option>` +
    items.map(({ code, libelle }) => `<option value="${esc(code)}">${esc(libelle)}</option>`).join("");
}

function remplirReferentiel(ref) {
  cases($("#f-sources"), "source", ref.sources || Object.entries(SOURCES).map(([code, libelle]) => ({ code, libelle })));
  cases($("#f-armes"), "arme", ref.armes || Object.entries(ARMES).map(([code, a]) => ({ code, libelle: a.nom })));
  cases($("#f-categories"), "categorie",
    (ref.categories || CATEGORIES.map((c) => ({ code: c, libelle: c }))).map((c) => ({ code: c.code, libelle: c.code === "SENIOR" ? "Seniors" : c.code })),
    true);
  options($("#f-region"), ref.regions || [], "Toutes");
  etat.departements = ref.departements || [];
  majDepartements();
  options($("#f-niveau"), ref.niveaux || [], "Tous");
}

function majDepartements() {
  const region = $("#f-region").value;
  const courant = $("#f-departement").value;
  options($("#f-departement"), etat.departements.filter((d) => !region || d.region === region), "Tous");
  $("#f-departement").value = courant;
  if ($("#f-departement").value !== courant) $("#f-departement").value = "";
}

function parametres() {
  const form = $("#form-filtres");
  const p = new URLSearchParams();
  for (const nom of ["source", "arme", "categorie"]) {
    const valeurs = [...form.querySelectorAll(`input[name=${nom}]:checked`)].map((i) => i.value);
    if (valeurs.length) p.set(nom, valeurs.join(","));
  }
  for (const nom of CHAMPS_SIMPLES) {
    const v = form.elements[nom].value.trim();
    if (v) p.set(nom, v);
  }
  if ($("#f-officielle").checked) p.set("officielle", "true");
  // Une région + un département : le département suffit (sinon l'API ferait un OU).
  if (p.has("departement")) p.delete("region");
  return p;
}

function appliquerParametres(p) {
  const form = $("#form-filtres");
  for (const nom of ["source", "arme", "categorie"]) {
    const valeurs = (p.get(nom) || "").split(",").filter(Boolean);
    form.querySelectorAll(`input[name=${nom}]`).forEach((i) => { i.checked = valeurs.includes(i.value); });
  }
  if (!p.has("source")) form.querySelectorAll("input[name=source]").forEach((i) => { i.checked = true; });
  $("#f-officielle").checked = p.get("officielle") === "true";
  for (const nom of CHAMPS_SIMPLES) {
    if (nom === "departement") majDepartements();
    form.elements[nom].value = p.get(nom) || "";
  }
  if (p.get("vue")) choisirVue(p.get("vue"), false);
}

// --- Recherche ----------------------------------------------------------------------------

async function rechercher() {
  const p = parametres();
  const numero = ++etat.requete;
  const url = new URL(location.href);
  url.search = p.toString();
  if (etat.vue !== "liste") url.searchParams.set("vue", etat.vue);
  history.replaceState(null, "", url);
  majIcs(p);

  $("#resultats").innerHTML = `<div class="chargement">Chargement…</div>`;
  $("#resume").textContent = "…";
  try {
    const d = await appeler(`/competitions?${p}`);
    if (numero !== etat.requete) return; // une recherche plus récente est partie
    etat.competitions = d.competitions;
    etat.moisAffiche = null;
    afficherSources(d.sources);
    $("#resume").textContent = `${d.count} compétition${d.count > 1 ? "s" : ""}`;
    $("#titre-impression").textContent = titreImpression(p, d.count);
    afficher();
  } catch (e) {
    if (numero !== etat.requete) return;
    $("#resume").textContent = "—";
    $("#sources-etat").innerHTML = "";
    $("#resultats").innerHTML = `<div class="erreur">Erreur : ${esc(e.message)}</div>`;
  }
}

// --- Administration des calendriers PDF (CDE 91, Ligue IDF) ---------------------------------

function jetonAdmin() {
  let jeton = lirePref("jeton-admin", "");
  if (!jeton) jeton = (window.prompt("Jeton d'administration de l'API (CAL_ADMIN_TOKEN du fichier .env) :") || "").trim();
  return jeton;
}

/** Appel d'une route d'administration : jeton demandé si besoin, oublié s'il est refusé. */
async function appelAdmin(chemin, options = {}) {
  const jeton = jetonAdmin();
  if (!jeton) throw new Error("jeton d'administration requis");
  const r = await fetch(etat.api + chemin, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${jeton}` } });
  if (r.status === 401) {
    ecrirePref("jeton-admin", "");
    throw new Error("jeton refusé");
  }
  if (!r.ok) {
    let detail = `${r.status} ${r.statusText}`;
    try { detail = (await r.json()).detail || detail; } catch { /* pas du JSON */ }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  ecrirePref("jeton-admin", jeton);
  return r.json();
}

async function reconstruire() {
  const bouton = $("#reconstruire");
  const statut = $("#reconstruire-etat");
  const libelle = bouton.textContent;
  bouton.disabled = true;
  statut.textContent = "";
  const bilans = [];
  try {
    for (const source of ["cde91", "idf"]) {
      bouton.textContent = `Reconstruction ${SOURCES[source]}…`;
      const d = await appelAdmin(`/calendriers/${source}/refresh`, { method: "POST" });
      bilans.push(`${SOURCES[source]} : ${d.erreur ? `erreur (${d.erreur})` : `${d.nb_evenements} événements`}`);
    }
    statut.textContent = `✓ ${bilans.join(" · ")}`;
    await Promise.all([rechercher(), chargerCalendriers()]);
  } catch (e) {
    statut.textContent = `Échec : ${e.message}${bilans.length ? ` (${bilans.join(" · ")})` : ""}`;
  } finally {
    bouton.disabled = false;
    bouton.textContent = libelle;
  }
}

// --- Remplacement d'un calendrier (fichier déposé ou lien web) --------------------------------

const MODES = { site: "Site", fichier: "Fichier déposé", lien: "Lien web" };
const fmtDateHeure = (iso) => new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });

async function chargerCalendriers() {
  try {
    const calendriers = await appeler("/calendriers");
    etat.cibles = calendriers.flatMap((cal) => (cal.cibles || []).map((c) => ({ ...c, source: cal.source, sourceLibelle: cal.libelle })));
  } catch {
    etat.cibles = [];
  }
  const select = $("#rc-cible");
  const choix = select.value;
  select.innerHTML = etat.cibles
    .map((c) => `<option value="${esc(`${c.source}/${c.cible}`)}">${esc(c.libelle)}</option>`)
    .join("");
  if (choix) select.value = choix;
  $("#rc-etat").innerHTML = etat.cibles.length
    ? `<table class="tableau">
        <thead><tr><th>Calendrier</th><th>Utilisé actuellement</th><th>Origine</th></tr></thead>
        <tbody>${etat.cibles.map((c) => `
          <tr>
            <td>${esc(c.libelle)}</td>
            <td>${c.calendriers.length
              ? c.calendriers.map((f) => `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.nom)}</a>`).join("<br>")
              : "<em>aucun</em>"}</td>
            <td><span class="mode mode-${esc(c.mode)}">${esc(MODES[c.mode] || c.mode)}</span>${c.depuis ? `<br><small>depuis le ${esc(fmtDateHeure(c.depuis))}</small>` : ""}</td>
          </tr>`).join("")}
        </tbody></table>`
    : `<p class="aide">État des calendriers indisponible.</p>`;
  majFormulaireRemplacement();
}

function cibleChoisie() {
  return etat.cibles.find((c) => `${c.source}/${c.cible}` === $("#rc-cible").value);
}

function majFormulaireRemplacement() {
  const parLien = $("#form-remplacer").elements["rc-type"].value === "lien";
  $("#rc-fichier").hidden = parLien;
  $("#rc-lien").hidden = !parLien;
  const cible = cibleChoisie();
  $("#rc-retablir").disabled = !cible || cible.mode === "site";
}

function decrireActuel(cible) {
  const noms = cible.calendriers.map((f) => f.nom).join(", ") || "aucun";
  return `${MODES[cible.mode] || cible.mode} : ${noms}`;
}

async function remplacerCalendrier(e) {
  e.preventDefault();
  const cible = cibleChoisie();
  if (!cible) return;
  const parLien = $("#form-remplacer").elements["rc-type"].value === "lien";
  const corps = new FormData();
  let nouveau;
  if (parLien) {
    const lien = $("#rc-lien").value.trim();
    if (!lien) { $("#rc-statut").textContent = "Indiquez le lien du calendrier PDF."; return; }
    corps.append("lien", lien);
    nouveau = `le lien ${lien}`;
  } else {
    const fichier = $("#rc-fichier").files[0];
    if (!fichier) { $("#rc-statut").textContent = "Choisissez un fichier PDF."; return; }
    corps.append("fichier", fichier, fichier.name);
    nouveau = `le fichier « ${fichier.name} »`;
  }
  const ok = window.confirm(
    `Remplacer « ${cible.libelle} » ?\n\n` +
    `Actuel — ${decrireActuel(cible)}\n` +
    `Nouveau — ${nouveau}\n\n` +
    `L'ancien calendrier sera écrasé. Les autres calendriers ne sont pas modifiés.\n` +
    `Le nouveau calendrier est vérifié avant : s'il ne contient aucune compétition pour « ${cible.libelle} », il est refusé.`,
  );
  if (!ok) return;
  await actionCalendrier(`Remplacement de « ${cible.libelle} »…`, async () => {
    const d = await appelAdmin(`/calendriers/${cible.source}/cibles/${cible.cible}`, { method: "POST", body: corps });
    $("#rc-fichier").value = "";
    $("#rc-lien").value = "";
    return `✓ « ${cible.libelle} » remplacé : ${d.nb_evenements} compétitions lues.`;
  });
}

async function retablirCalendrier() {
  const cible = cibleChoisie();
  if (!cible || cible.mode === "site") return;
  const ok = window.confirm(
    `Revenir au calendrier publié sur le site pour « ${cible.libelle} » ?\n\n` +
    `Actuel — ${decrireActuel(cible)}\n\nLes autres calendriers ne sont pas modifiés.`,
  );
  if (!ok) return;
  await actionCalendrier(`Retour au calendrier du site pour « ${cible.libelle} »…`, async () => {
    const d = await appelAdmin(`/calendriers/${cible.source}/cibles/${cible.cible}`, { method: "DELETE" });
    return d.erreur ? `Site injoignable : ${d.erreur}` : `✓ « ${cible.libelle} » : retour au calendrier du site.`;
  });
}

async function actionCalendrier(message, action) {
  const statut = $("#rc-statut");
  const boutons = $("#form-remplacer").querySelectorAll("button");
  boutons.forEach((b) => { b.disabled = true; });
  statut.textContent = message;
  try {
    statut.textContent = await action();
    await Promise.all([chargerCalendriers(), rechercher()]);
  } catch (err) {
    statut.textContent = `Échec : ${err.message}`;
  } finally {
    boutons.forEach((b) => { b.disabled = false; });
    majFormulaireRemplacement();
  }
}

function afficherSources(sources) {
  $("#sources-etat").innerHTML = Object.entries(sources)
    .map(([code, s]) => {
      const classe = !s.ok && !s.stale ? "ko" : s.stale ? "perime" : "ok";
      const quand = s.fetched_at ? new Date(s.fetched_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "jamais";
      const info = s.message ? ` — ${s.message}` : "";
      return `<span class="${classe}" title="${esc(info)}">${esc(SOURCES[code] || code)} : ${esc(quand)}${s.stale ? " (ancienne version)" : ""}</span>`;
    })
    .join("");
}

function titreImpression(p, n) {
  const morceaux = [];
  if (p.get("officielle")) morceaux.push("officielles");
  if (p.get("arme")) morceaux.push(p.get("arme").split(",").map((a) => ARMES[a]?.nom || a).join(", "));
  if (p.get("categorie")) morceaux.push(p.get("categorie").replaceAll(",", ", "));
  const dep = etat.departements.find((d) => d.code === p.get("departement"));
  if (dep) morceaux.push(dep.libelle);
  const reg = $("#f-region").selectedOptions[0];
  if (p.get("region") && reg) morceaux.push(reg.textContent);
  if (p.get("ville")) morceaux.push(p.get("ville"));
  return `Compétitions d'escrime${morceaux.length ? " – " + morceaux.join(" · ") : ""} (${n})`;
}

// --- Affichage ----------------------------------------------------------------------------

function badgesArmes(armes) {
  return armes
    .map((a) => `<span class="arme" style="background:var(--${a})" title="${esc(ARMES[a]?.nom || a)}">${esc(ARMES[a]?.lettre || a)}</span>`)
    .join("");
}

const ECHELONS_FEMININ = { departemental: "départementale", regional: "régionale", zone: "de zone", national: "nationale", international: "internationale" };

function niveau(c) {
  if (!c.type && !c.echelon) return "";
  if (!c.type) return "Niveau " + (ECHELONS[c.echelon] || c.echelon);
  const echelon = c.type === "epreuve" ? ECHELONS_FEMININ[c.echelon] : ECHELONS[c.echelon];
  return [TYPES[c.type] || c.type, echelon].filter(Boolean).join(" ");
}

function afficher() {
  if (!etat.competitions.length) {
    $("#resultats").innerHTML = `<div class="vide">Aucune compétition pour ces critères.</div>`;
    return;
  }
  if (etat.vue === "mois") afficherMois();
  else afficherListe();
}

function afficherListe() {
  const parMois = new Map();
  for (const c of etat.competitions) {
    const cle = c.date_debut.slice(0, 7);
    if (!parMois.has(cle)) parMois.set(cle, []);
    parMois.get(cle).push(c);
  }
  $("#resultats").innerHTML = [...parMois]
    .map(([cle, liste]) => `
      <h3 class="mois-titre">${esc(fmtMois.format(dateLocale(cle + "-01")))}</h3>
      <ul class="liste">
        ${liste.map((c) => `
          <li data-id="${esc(c.id)}" tabindex="0">
            <div class="quand">${esc(periode(c))}${c.horaire ? `<small class="horaire">${esc(c.horaire)}</small>` : ""}</div>
            <div class="quoi">
              <strong>${esc(c.titre)}</strong>
              <span class="meta">${esc(c.lieu)}${c.departement ? ` (${esc(c.departement)})` : ""} · ${esc(c.categories_libelle || c.categories.join(", "))}${niveau(c) ? ` · ${esc(niveau(c))}` : ""}</span>
            </div>
            <div class="badges">${c.officielle ? `<span class="badge-officielle">officielle</span>` : ""}${badgesArmes(c.armes)}${c.sources.map((s) => `<span class="source">${esc(SOURCES[s] || s)}</span>`).join("")}</div>
          </li>`).join("")}
      </ul>`)
    .join("");
}

function afficherMois() {
  if (!etat.moisAffiche) {
    const aujourdhui = isoLocale(new Date());
    const prochaine = etat.competitions.find((c) => c.date_fin >= aujourdhui) || etat.competitions[0];
    const d = dateLocale(prochaine.date_debut);
    etat.moisAffiche = new Date(d.getFullYear(), d.getMonth(), 1);
  }
  const premier = etat.moisAffiche;
  const debutGrille = new Date(premier);
  debutGrille.setDate(1 - ((premier.getDay() + 6) % 7)); // lundi précédent
  const aujourdhui = isoLocale(new Date());

  let grille = JOURS.map((j) => `<div class="jour-nom">${j}</div>`).join("");
  for (let i = 0; i < 42; i++) {
    const jour = new Date(debutGrille);
    jour.setDate(debutGrille.getDate() + i);
    if (i >= 35 && jour.getMonth() !== premier.getMonth()) break;
    const iso = isoLocale(jour);
    const evts = etat.competitions.filter((c) => c.date_debut <= iso && iso <= c.date_fin);
    const classes = ["case", jour.getMonth() !== premier.getMonth() && "hors", iso === aujourdhui && "aujourdhui"].filter(Boolean).join(" ");
    grille += `<div class="${classes}"><span class="num">${jour.getDate()}</span>${evts
      .map((c) => `<button type="button" class="evt" data-id="${esc(c.id)}" style="border-left-color:var(--${c.armes[0] || "FLE"})"
          title="${esc(`${c.titre} – ${c.lieu}`)}">${esc(c.lieu)} · ${esc(c.titre)}</button>`)
      .join("")}</div>`;
  }
  $("#resultats").innerHTML = `
    <div class="calendrier-nav">
      <button type="button" data-mois="-1" aria-label="Mois précédent">‹</button>
      <h3>${esc(fmtMois.format(premier))}</h3>
      <button type="button" data-mois="1" aria-label="Mois suivant">›</button>
    </div>
    <div class="grille">${grille}</div>`;
}

function choisirVue(vue, rafraichir = true) {
  etat.vue = vue === "mois" ? "mois" : "liste";
  document.querySelectorAll(".onglets button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.vue === etat.vue)));
  if (rafraichir) {
    const url = new URL(location.href);
    if (etat.vue === "liste") url.searchParams.delete("vue"); else url.searchParams.set("vue", etat.vue);
    history.replaceState(null, "", url);
    afficher();
  }
}

// --- Détail -------------------------------------------------------------------------------

function lienGoogleEvenement(c) {
  const fin = dateLocale(c.date_fin);
  fin.setDate(fin.getDate() + 1);
  const dates = `${c.date_debut.replaceAll("-", "")}/${isoLocale(fin).replaceAll("-", "")}`;
  const details = [c.categories_libelle && `Catégories : ${c.categories_libelle}`, c.horaire && `Horaire : ${c.horaire}`, c.url]
    .filter(Boolean).join("\n");
  const p = new URLSearchParams({ action: "TEMPLATE", text: c.titre, dates, location: c.lieu, details });
  return `https://calendar.google.com/calendar/render?${p}`;
}

async function ouvrirDetail(id) {
  const dialogue = $("#detail");
  const base = etat.competitions.find((c) => c.id === id);
  $("#detail-contenu").innerHTML = `<p>Chargement…</p>`;
  dialogue.showModal();
  let c = base;
  let erreur = "";
  try {
    c = await appeler(`/competitions/${encodeURIComponent(id)}`);
    if (base) c = { ...c, sources: base.sources, horaire: c.horaire || base.horaire };
  } catch (e) {
    erreur = e.message;
  }
  if (!c) {
    $("#detail-contenu").innerHTML = `<p class="erreur">${esc(erreur)}</p>`;
    return;
  }
  const lignes = [
    ["Date", periode(c, fmtLong)],
    ["Lieu", `${c.lieu}${c.departement ? ` (${c.departement})` : ""}`],
    ["Armes", c.armes.map((a) => ARMES[a]?.nom || a).join(", ")],
    ["Catégories", c.categories_libelle || c.categories.join(", ")],
    ["Niveau", niveau(c)],
    ["Officielle", c.officielle ? "oui" : "non"],
    ["Horaire", c.horaire],
    ["Sources", c.sources.map((s) => SOURCES[s] || s).join(" + ")],
  ].filter(([, v]) => v);
  const note = c.note_organisation
    ? `<a class="bouton" href="${esc(c.note_organisation)}" target="_blank" rel="noopener">Note d'organisation (PDF)</a>`
    : c.id.startsWith("ffe-") ? `<span class="aide">Note d'organisation pas encore publiée</span>` : "";
  $("#detail-contenu").innerHTML = `
    <h3>${badgesArmes(c.armes)} ${esc(c.titre)}</h3>
    <dl>${lignes.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
    ${erreur ? `<p class="erreur">Détail indisponible : ${esc(erreur)}</p>` : ""}
    <div class="liens">
      ${note}
      ${c.site_web ? `<a class="bouton" href="${esc(c.site_web)}" target="_blank" rel="noopener">Site de l'organisateur</a>` : ""}
      ${c.id.startsWith("ffe-") && c.url ? `<a class="bouton" href="${esc(c.url)}" target="_blank" rel="noopener">Fiche FFE</a>` : ""}
      ${(c.calendriers || []).map((cal) => `<a class="bouton" href="${esc(cal.url)}" target="_blank" rel="noopener">${esc(cal.libelle)} (PDF)</a>`).join("")}
      <a class="bouton" href="${esc(lienGoogleEvenement(c))}" target="_blank" rel="noopener">Ajouter à Google Agenda</a>
    </div>`;
}

// --- Abonnement .ics ----------------------------------------------------------------------

function majIcs(p) {
  const q = new URLSearchParams(p);
  q.set("nom", titreImpression(p, 0).replace(/ \(0\)$/, ""));
  const url = `${etat.api}/competitions.ics?${q}`;
  $("#ics-url").value = url;
  $("#ics-telecharger").href = url;
  $("#ics-google").href = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(url.replace(/^https?:/, "webcal:"))}`;
}

// --- Événements ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  $("#api-url").value = new URLSearchParams(location.search).get("api") || lirePref("api", window.CALENDRIER_API || "http://127.0.0.1:8765");

  $("#form-api").addEventListener("submit", (e) => { e.preventDefault(); connecter(); });
  $("#form-filtres").addEventListener("submit", (e) => { e.preventDefault(); rechercher(); });
  $("#f-region").addEventListener("change", majDepartements);
  $("#reinitialiser").addEventListener("click", () => { appliquerParametres(new URLSearchParams()); rechercher(); });
  $("#imprimer").addEventListener("click", () => window.print());
  $("#reconstruire").addEventListener("click", reconstruire);
  $("#form-remplacer").addEventListener("submit", remplacerCalendrier);
  $("#form-remplacer").addEventListener("change", majFormulaireRemplacement);
  $("#rc-retablir").addEventListener("click", retablirCalendrier);
  $("#ics-copier").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("#ics-url").value); $("#ics-copier").textContent = "Copié !"; }
    catch { $("#ics-url").select(); }
    setTimeout(() => { $("#ics-copier").textContent = "Copier"; }, 1500);
  });
  document.querySelectorAll(".onglets button").forEach((b) => b.addEventListener("click", () => choisirVue(b.dataset.vue)));

  $("#resultats").addEventListener("click", (e) => {
    const nav = e.target.closest("[data-mois]");
    if (nav) {
      etat.moisAffiche = new Date(etat.moisAffiche.getFullYear(), etat.moisAffiche.getMonth() + Number(nav.dataset.mois), 1);
      afficherMois();
      return;
    }
    const cible = e.target.closest("[data-id]");
    if (cible) ouvrirDetail(cible.dataset.id);
  });
  $("#resultats").addEventListener("keydown", (e) => {
    const cible = e.target.closest("li[data-id]");
    if (cible && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); ouvrirDetail(cible.dataset.id); }
  });
  $("#detail").addEventListener("click", (e) => { if (e.target === $("#detail")) $("#detail").close(); });

  connecter();
});
