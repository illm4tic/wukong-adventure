import { applyDomTranslations, initI18n, toggleLanguage } from "./i18n.js";

export function initUi() {
  initI18n();

  const languageButton = document.querySelector("[data-lang-toggle]");
  if (languageButton) {
    languageButton.addEventListener("click", () => {
      toggleLanguage();
    });
  }

  const drawerButton = document.querySelector("[data-drawer-toggle]");
  const drawerPanel = document.querySelector("[data-drawer-panel]");
  if (drawerButton && drawerPanel) {
    drawerButton.addEventListener("click", () => {
      const isHidden = drawerPanel.hasAttribute("hidden");
      if (isHidden) {
        drawerPanel.removeAttribute("hidden");
        drawerButton.setAttribute("aria-expanded", "true");
      } else {
        drawerPanel.setAttribute("hidden", "");
        drawerButton.setAttribute("aria-expanded", "false");
      }
      applyDomTranslations();
    });
  }
}
