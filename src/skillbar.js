import { onLanguageChange, t } from "./i18n.js";

const skillImageMap = {
  k: new URL("../assets/skills/skill-jdtj.png", import.meta.url).href,
  l: new URL("../assets/skills/skill-ryhs.png", import.meta.url).href,
};

const FRAME_SIZE = 72;
const CENTER = FRAME_SIZE / 2;
const RADIUS = 58;

function polarToCartesian(cx, cy, radius, angle) {
  const radians = (angle - 90) * Math.PI / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  };
}

function buildCooldownSectorPath(progress) {
  if (progress <= 0) return "";
  if (progress >= 0.9999) {
    return `M 0 0 H ${FRAME_SIZE} V ${FRAME_SIZE} H 0 Z`;
  }

  const start = polarToCartesian(CENTER, CENTER, RADIUS, 180);
  const angle = 180 + progress * 360;
  const end = polarToCartesian(CENTER, CENTER, RADIUS, angle);
  const largeArcFlag = progress > 0.5 ? 1 : 0;

  return [
    `M ${CENTER} ${CENTER}`,
    `L ${start.x} ${start.y}`,
    `A ${RADIUS} ${RADIUS} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`,
    "Z",
  ].join(" ");
}

export function initSkillBar() {
  const state = {
    k: { current: 0, max: 2.8 },
    l: { current: 0, max: 6 },
  };

  const updateLanguage = () => {
    const skillNameK = document.querySelector('[data-skill-name="k"]');
    const skillNameL = document.querySelector('[data-skill-name="l"]');
    const skillImageK = document.querySelector('[data-skill-image="k"]');
    const skillImageL = document.querySelector('[data-skill-image="l"]');
    if (skillNameK) skillNameK.textContent = t("skillK");
    if (skillNameL) skillNameL.textContent = t("skillL");
    if (skillImageK) {
      skillImageK.setAttribute("href", skillImageMap.k);
      skillImageK.setAttributeNS("http://www.w3.org/1999/xlink", "href", skillImageMap.k);
    }
    if (skillImageL) {
      skillImageL.setAttribute("href", skillImageMap.l);
      skillImageL.setAttributeNS("http://www.w3.org/1999/xlink", "href", skillImageMap.l);
    }
    renderCooldown("k");
    renderCooldown("l");
  };

  const renderCooldown = (key) => {
    const item = state[key];
    const mask = document.querySelector(`[data-skill-mask="${key}"]`);
    const overlayTime = document.querySelector(`[data-skill-overlay-time="${key}"]`);
    const card = document.querySelector(`[data-skill-card="${key}"]`);
    if (!mask || !overlayTime || !card) return;

    const progress = item.max > 0 ? Math.max(0, Math.min(1, item.current / item.max)) : 0;
    const path = buildCooldownSectorPath(progress);
    mask.setAttribute("d", path);
    mask.style.opacity = progress > 0 ? "0.82" : "0";
    overlayTime.textContent = item.current > 0 ? item.current.toFixed(1) : "";
    overlayTime.style.opacity = item.current > 0 ? "1" : "0";
    card.dataset.cooling = item.current > 0 ? "true" : "false";
  };

  onLanguageChange(updateLanguage);
  updateLanguage();

  return {
    setCooldowns(nextState) {
      if (typeof nextState.k?.current === "number") state.k.current = nextState.k.current;
      if (typeof nextState.k?.max === "number") state.k.max = nextState.k.max;
      if (typeof nextState.l?.current === "number") state.l.current = nextState.l.current;
      if (typeof nextState.l?.max === "number") state.l.max = nextState.l.max;
      renderCooldown("k");
      renderCooldown("l");
    },
  };
}
