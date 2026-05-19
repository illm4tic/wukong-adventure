import "./styles.css";
import { initUi } from "./ui.js";
import { initSkillBar } from "./skillbar.js";
import "./game.js";

initUi();
window.__skillBar = initSkillBar();
