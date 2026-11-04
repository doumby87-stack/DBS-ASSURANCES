// Menu mobile : ouverture et fermeture au clic, à la touche Échap et en suivant un lien ;
// le focus entre dans le menu et revient sur le bouton ; la page derrière ne défile plus.

const bouton = document.querySelector<HTMLButtonElement>("[data-bouton-menu]");
const menu = document.querySelector<HTMLElement>("[data-menu-mobile]");

if (bouton && menu) {
  const elementsFocusables = () =>
    Array.from(menu.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"));

  const ouvrir = (ouvert: boolean, rendreLeFocus = true) => {
    bouton.setAttribute("aria-expanded", String(ouvert));
    bouton.setAttribute("aria-label", ouvert ? "Fermer le menu" : "Ouvrir le menu");
    bouton.querySelector("svg")?.replaceWith(icone(ouvert ? "croix" : "menu"));
    document.documentElement.classList.toggle("menu-ouvert", ouvert);
    if (ouvert) {
      menu.setAttribute("data-ouvert", "");
      elementsFocusables()[0]?.focus();
    } else {
      menu.removeAttribute("data-ouvert");
      if (rendreLeFocus) bouton.focus();
    }
  };

  bouton.addEventListener("click", () => ouvrir(bouton.getAttribute("aria-expanded") !== "true"));
  menu.addEventListener("click", (evenement) => {
    if ((evenement.target as Element).closest("a")) ouvrir(false, false);
  });
  document.addEventListener("keydown", (evenement) => {
    if (bouton.getAttribute("aria-expanded") !== "true") return;
    if (evenement.key === "Escape") {
      ouvrir(false);
      return;
    }
    // Le focus reste dans le menu (et sur le bouton qui le ferme) tant qu'il est ouvert
    if (evenement.key === "Tab") {
      const cycle = [bouton, ...elementsFocusables()];
      const position = cycle.indexOf(document.activeElement as HTMLElement);
      const suivant = evenement.shiftKey
        ? cycle[(position - 1 + cycle.length) % cycle.length]
        : cycle[(position + 1) % cycle.length];
      evenement.preventDefault();
      suivant?.focus();
    }
  });
  window.matchMedia("(min-width: 1081px)").addEventListener("change", (requete) => {
    if (requete.matches) ouvrir(false, false);
  });
}

function icone(nom: "menu" | "croix"): SVGSVGElement {
  const traces = {
    menu: ["M4 6h16", "M4 12h16", "M4 18h16"],
    croix: ["M18 6 6 18", "m6 6 12 12"],
  }[nom];
  const espace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(espace, "svg");
  svg.setAttribute("class", "icone");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const d of traces) {
    const chemin = document.createElementNS(espace, "path");
    chemin.setAttribute("d", d);
    svg.append(chemin);
  }
  return svg;
}
