const STORAGE_KEY = "wukong-adventure-lang";
const SUPPORTED_LANGUAGES = ["zh", "en"];

const messages = {
  zh: {
    htmlLang: "zh-CN",
    title: "孙悟空大冒险",
    drawerOpen: "显示说明",
    drawerClose: "隐藏说明",
    controlsTitle: "操作说明",
    controlsLine1: "`A / D` 移动，`W` 跳跃，`J` 金箍棒连击，`K` 筋斗突进，`L` 如意横扫",
    controlsLine2: "`Space` 重新开始，`P` 暂停 / 继续",
    objectiveTitle: "目标",
    objectiveText: "清空每一波敌人并推进到裂隙终点。",
    langButton: "EN",
    languageName: "中文",
    canvasAriaLabel: "孙悟空大冒险 游戏画布",
    heroName: "孙悟空",
    hudHero: "主角",
    hudWave: "波次",
    hudKills: "击破",
    hudHp: "血量",
    hudEnergy: "能量",
    skillK: "筋斗突进",
    skillL: "如意横扫",
    msgRiftOpened: "裂隙开启",
    msgWaveIncoming: (wave) => `第 ${wave} 波来袭`,
    msgAdvance: "向前推进至终点",
    msgDefeat: "英雄倒下，按 Space 重开",
    msgVictory: "裂隙肃清完成",
    overlayPausedTitle: "已暂停",
    overlayPausedSubtitle: "按 P 继续战斗",
    overlayDefeatTitle: "战斗失败",
    overlayDefeatSubtitle: "按 Space 立刻重开",
    overlayVictoryTitle: "裂隙肃清完成",
    overlayVictorySubtitle: "按 Space 再战一轮",
    overlayLoadingTitle: "加载贴图中",
    overlayLoadingSubtitle: "请稍候",
  },
  en: {
    htmlLang: "en",
    title: "Wukong Adventure",
    drawerOpen: "Show Info",
    drawerClose: "Hide Info",
    controlsTitle: "Controls",
    controlsLine1: "`A / D` Move, `W` Jump, `J` Staff Combo, `K` Somersault Dash, `L` Ruyi Sweep",
    controlsLine2: "`Space` Restart, `P` Pause / Resume",
    objectiveTitle: "Objective",
    objectiveText: "Clear every wave and push to the exit.",
    langButton: "中",
    languageName: "English",
    canvasAriaLabel: "Wukong Adventure game canvas",
    heroName: "Wukong",
    hudHero: "Hero",
    hudWave: "Wave",
    hudKills: "Kills",
    hudHp: "HP",
    hudEnergy: "Energy",
    skillK: "Somersault Dash",
    skillL: "Ruyi Sweep",
    msgRiftOpened: "The Rift Opens",
    msgWaveIncoming: (wave) => `Wave ${wave} Incoming`,
    msgAdvance: "Advance to the exit",
    msgDefeat: "The hero has fallen. Press Space to restart",
    msgVictory: "Rift Purged",
    overlayPausedTitle: "Paused",
    overlayPausedSubtitle: "Press P to resume",
    overlayDefeatTitle: "Defeated",
    overlayDefeatSubtitle: "Press Space to restart",
    overlayVictoryTitle: "Rift Purged",
    overlayVictorySubtitle: "Press Space to play again",
    overlayLoadingTitle: "Loading Sprites",
    overlayLoadingSubtitle: "Please wait",
  },
};

let currentLanguage = resolveInitialLanguage();
const listeners = new Set();

function resolveInitialLanguage() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (SUPPORTED_LANGUAGES.includes(stored)) return stored;
  const browserLanguage = (navigator.language || navigator.languages?.[0] || "en").toLowerCase();
  return browserLanguage.startsWith("zh") ? "zh" : "en";
}

export function getLanguage() {
  return currentLanguage;
}

export function setLanguage(language) {
  if (!SUPPORTED_LANGUAGES.includes(language) || language === currentLanguage) return;
  currentLanguage = language;
  localStorage.setItem(STORAGE_KEY, language);
  listeners.forEach((listener) => listener(language));
}

export function toggleLanguage() {
  setLanguage(currentLanguage === "zh" ? "en" : "zh");
}

export function onLanguageChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function t(key, ...args) {
  const table = messages[currentLanguage] ?? messages.en;
  const value = table[key];
  if (typeof value === "function") return value(...args);
  return value ?? key;
}

export function applyDomTranslations() {
  document.documentElement.lang = t("htmlLang");
  document.title = t("title");

  for (const node of document.querySelectorAll("[data-i18n]")) {
    node.textContent = t(node.dataset.i18n);
  }

  for (const node of document.querySelectorAll("[data-i18n-aria-label]")) {
    node.setAttribute("aria-label", t(node.dataset.i18nAriaLabel));
  }

  const languageButton = document.querySelector("[data-lang-toggle]");
  if (languageButton) {
    languageButton.textContent = t("langButton");
    languageButton.title = t("languageName");
    languageButton.setAttribute("aria-label", t("languageName"));
  }

  const drawerButton = document.querySelector("[data-drawer-toggle]");
  const drawerPanel = document.querySelector("[data-drawer-panel]");
  if (drawerButton && drawerPanel) {
    const isOpen = !drawerPanel.hasAttribute("hidden");
    drawerButton.textContent = isOpen ? t("drawerClose") : t("drawerOpen");
  }
}

export function initI18n() {
  applyDomTranslations();
  onLanguageChange(() => applyDomTranslations());
}
