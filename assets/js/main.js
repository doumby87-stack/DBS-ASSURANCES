/* DBS-ASSURANCES — interactions du site */
(function () {
  "use strict";

  // Coordonnées utilisées par le formulaire de devis
  var WHATSAPP = "2250749360702";
  var EMAIL = "dbs.conseils1@gmail.com";

  /* ---------- En-tête : ombre au défilement ---------- */
  var header = document.querySelector(".site-header");
  function onScroll() {
    if (header) header.classList.toggle("is-scrolled", window.scrollY > 8);
  }
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ---------- Menu mobile ---------- */
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("site-nav");
  function setMenu(open) {
    if (!toggle) return;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute("aria-label", open ? "Fermer le menu" : "Ouvrir le menu");
    document.body.classList.toggle("nav-open", open);
  }
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      setMenu(toggle.getAttribute("aria-expanded") !== "true");
    });
    nav.addEventListener("click", function (e) {
      if (e.target.closest("a")) setMenu(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") setMenu(false);
    });
    var desktop = window.matchMedia("(min-width: 1061px)");
    if (desktop.addEventListener) {
      desktop.addEventListener("change", function (m) { if (m.matches) setMenu(false); });
    }
  }

  /* ---------- Apparition des blocs au défilement ---------- */
  var reveals = document.querySelectorAll("[data-reveal]");
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if ("IntersectionObserver" in window && !reduced) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.06 });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("is-visible"); });
  }

  /* ---------- Année du pied de page ---------- */
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });

  /* ---------- Formulaire de devis ---------- */
  var form = document.getElementById("devis-form");
  if (!form) return;

  var fields = form.elements;
  var hint = document.getElementById("h-besoin");
  var status = form.querySelector(".form-status");

  // Ce qu'il est utile de préciser selon l'assurance choisie
  var HINTS = {
    "Automobile & 2-roues": "marque, modèle, année, puissance fiscale (CV), usage (personnel, professionnel, livraison…), valeur du véhicule et garanties souhaitées.",
    "Multirisque habitation": "propriétaire ou locataire, type de logement (appartement, villa…), nombre de pièces, commune et valeur approximative de vos biens.",
    "Multirisque professionnelle": "activité, adresse et surface des locaux, valeur du matériel et du stock.",
    "Responsabilité civile": "activité concernée, nombre d'employés, chiffre d'affaires approximatif, ou responsabilité civile familiale.",
    "Individuelle accident": "personnes à couvrir (vous, votre famille, vos employés, vos chauffeurs) et capitaux souhaités.",
    "Flotte & transport routier": "nombre et types de véhicules (tracteurs, semi-remorques, remorques, motos…), usage et zones de circulation. Vous pourrez ensuite nous envoyer la liste complète en fichier Excel.",
    "Transport de marchandises": "nature des marchandises, trajets habituels et valeur moyenne transportée.",
    "Incendie & risques divers": "biens à assurer (bâtiment, entrepôt, stock, équipements), adresse et valeurs.",
    "Chantier & construction": "nature et montant des travaux, maître d'ouvrage, lieu et durée du chantier, garanties demandées dans l'appel d'offres.",
    "Industrie, PME/PMI & bris de machines": "activité, adresse et surface des locaux, valeur des bâtiments, des machines et du stock.",
    "Assurance agricole": "type de culture, superficie en hectares et localisation de la plantation.",
    "RC événement": "type d'événement, date, lieu et nombre de participants attendus.",
    "Autre besoin": "décrivez votre situation, nous vous orientons vers la bonne solution."
  };

  function updateHint() {
    if (!hint) return;
    hint.textContent = "À préciser : " + (HINTS[fields.type.value] || HINTS["Autre besoin"]);
  }
  fields.type.addEventListener("change", updateHint);
  updateHint();

  // Les boutons « Demander un devis » des cartes présélectionnent l'assurance
  document.querySelectorAll("[data-devis]").forEach(function (el) {
    el.addEventListener("click", function () {
      var value = el.getAttribute("data-devis");
      var exists = Array.prototype.some.call(fields.type.options, function (o) { return o.value === value; });
      if (exists) {
        fields.type.value = value;
        updateHint();
      }
    });
  });

  /* Validation */
  function setError(input, message) {
    var error = document.getElementById("e-" + input.name);
    input.setAttribute("aria-invalid", message ? "true" : "false");
    if (error) error.textContent = message || "";
    return !message;
  }

  function validate() {
    var first = null;
    function check(input, message) {
      if (!setError(input, message) && !first) first = input;
    }
    var nom = fields.nom.value.trim();
    var digits = fields.tel.value.replace(/\D/g, "");
    var email = fields.email.value.trim();

    check(fields.nom, nom.length < 2 ? "Indiquez votre nom ou celui de votre entreprise." : "");
    check(fields.tel, digits.length < 8 || digits.length > 15 ? "Indiquez un numéro valide, par exemple 07 49 36 07 02." : "");
    check(fields.email, email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? "Cette adresse e-mail semble incomplète." : "");
    check(fields.consent, fields.consent.checked ? "" : "Cochez cette case pour que nous puissions vous répondre.");

    if (first) first.focus();
    return !first;
  }

  ["nom", "tel", "email"].forEach(function (name) {
    fields[name].addEventListener("input", function () {
      if (this.getAttribute("aria-invalid") === "true") setError(this, "");
    });
  });
  fields.consent.addEventListener("change", function () {
    if (this.checked) setError(this, "");
  });

  /* Message envoyé à l'agence */
  function buildMessage() {
    var profil = form.querySelector('input[name="profil"]:checked');
    var lines = [
      "Bonjour DBS-ASSURANCES,",
      "",
      "Je souhaite recevoir un devis.",
      "• Assurance : " + fields.type.value,
      "• Profil : " + (profil ? profil.value : "-"),
      "• Nom : " + fields.nom.value.trim(),
      "• Téléphone : " + fields.tel.value.trim()
    ];
    if (fields.email.value.trim()) lines.push("• E-mail : " + fields.email.value.trim());
    if (fields.ville.value.trim()) lines.push("• Commune / ville : " + fields.ville.value.trim());
    if (fields.besoin.value.trim()) lines.push("", "Mon besoin :", fields.besoin.value.trim());
    lines.push("", "(Demande envoyée depuis le site DBS-ASSURANCES)");
    return lines.join("\n");
  }

  // Bouton utilisé pour envoyer (WhatsApp ou e-mail), y compris sur les navigateurs sans event.submitter
  var lastChannel = "whatsapp";
  form.querySelectorAll('button[type="submit"]').forEach(function (button) {
    button.addEventListener("click", function () { lastChannel = button.value; });
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (status) status.textContent = "";
    if (!validate()) return;

    var channel = (e.submitter && e.submitter.value) || lastChannel;
    var message = buildMessage();

    if (channel === "email") {
      var subject = "Demande de devis – " + fields.type.value;
      window.location.href = "mailto:" + EMAIL +
        "?subject=" + encodeURIComponent(subject) +
        "&body=" + encodeURIComponent(message);
      if (status) status.textContent = "Votre messagerie s'ouvre avec la demande pré-remplie : il ne reste qu'à l'envoyer.";
    } else {
      var url = "https://wa.me/" + WHATSAPP + "?text=" + encodeURIComponent(message);
      var win = window.open(url, "_blank");
      if (win) {
        try { win.opener = null; } catch (err) { /* sans effet */ }
      } else {
        window.location.href = url;
      }
      if (status) status.textContent = "WhatsApp s'ouvre avec votre demande pré-remplie : il ne reste qu'à l'envoyer.";
    }
  });
})();
