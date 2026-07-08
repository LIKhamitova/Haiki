"use strict";

const LANGS = [
  { code: "ja", label: "Japanese",  native: "日本" },
  { code: "en", label: "English",   native: "English" },
  { code: "es", label: "Spanish",   native: "Español" },
  { code: "fr", label: "French",    native: "Français" },
  { code: "de", label: "German",    native: "Deutsch" },
  { code: "it", label: "Italian",   native: "Italiano" },
  { code: "pt", label: "Portuguese", native: "Português" },
  { code: "ru", label: "Russian",   native: "Русский" },
  { code: "zh", label: "Chinese",   native: "中文" },
  { code: "ko", label: "Korean",    native: "한국어" },
  { code: "ar", label: "Arabic",    native: "العربية" },
  { code: "hi", label: "Hindi",     native: "हिन्दी" },
];

const SPICE = [
  "Calm, traditional, contemplative haiku about nature and transience.",
  "A light, quiet sketch with a gentle mood.",
  "Slightly unexpected, with subtle irony.",
  "Playful, with humor and a surprising twist.",
  "Bold and sharp, with an absurd image.",
  "Very spicy, chaotic, grotesque and funny.",
  "Maximum heat: absurd, chaotic, surreal and dark-humored — yet still three lines of haiku.",
];

const state = {
  keywords: "",
  lang: "",
  spice: 0,
  langOpen: false,
  resultState: "empty",
  errorMsg: "",
  lines: [],
  doneLang: "",
  doneSpice: "",
  history: [],
};

const els = {};

function labelOf(code) {
  const lang = LANGS.find((item) => item.code === code);
  return lang ? lang.label : "";
}

function cap(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function phrases() {
  return state.keywords
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function offlineHaiku(parts, spice) {
  const keywords = parts.map((word) => word.trim()).filter(Boolean);
  if (keywords.length === 0) keywords.push("silence", "wind", "light");

  const at = (index) => keywords[((index % keywords.length) + keywords.length) % keywords.length];
  const joiners = ["drifts past", "and then", "meets the", "beneath a", "folds into"];
  const tails = ["a quiet morning", "the still water", "one slow breath", "the open sky", "evening light"];
  const heat = [
    "",
    "",
    "a sudden grin —",
    "chaos giggles —",
    "wasabi tears —",
    "everything ablaze —",
    "pure delicious mayhem —",
  ];

  const line1 = cap(at(0));
  const line2 = (heat[spice] ? heat[spice] + " " : "") + at(1) + " " + joiners[spice % joiners.length] + " " + at(2);
  const line3 = cap(tails[spice % tails.length]) + (spice >= 5 ? ", " + at(3) + "!" : "");

  return [line1, line2, line3].join("\n");
}

function renderEmpty() {
  els.resultStage.innerHTML = `
    <div class="empty-state">
      <div class="empty-ring"></div>
      <div class="empty-title">No haiku yet</div>
      <div class="empty-copy">Enter your words and press "Generate"</div>
    </div>
  `;
  els.doneMeta.classList.add("is-hidden");
}

function renderLoading() {
  els.resultStage.innerHTML = `
    <div class="loader">
      <div class="loader-ring"></div>
      <div class="loader-text">Composing the lines…</div>
    </div>
  `;
  els.doneMeta.classList.add("is-hidden");
}

function renderError() {
  els.resultStage.innerHTML = `
    <div class="error-state">
      <div class="error-icon">!</div>
      <div class="error-text"></div>
    </div>
  `;
  els.resultStage.querySelector(".error-text").textContent = state.errorMsg;
  els.doneMeta.classList.add("is-hidden");
}

function renderDone() {
  els.resultStage.innerHTML = '<div class="done-state"></div>';
  const wrap = els.resultStage.querySelector(".done-state");

  state.lines.forEach((line) => {
    const item = document.createElement("div");
    item.className = "haiku-line";
    item.textContent = line;
    wrap.append(item);
  });

  els.doneMeta.innerHTML = "";
  const lang = document.createElement("span");
  lang.textContent = state.doneLang;
  const spice = document.createElement("span");
  spice.textContent = state.doneSpice;
  els.doneMeta.append(lang, spice);
  els.doneMeta.classList.remove("is-hidden");
}

function renderResult() {
  if (state.resultState === "loading") renderLoading();
  else if (state.resultState === "error") renderError();
  else if (state.resultState === "done") renderDone();
  else renderEmpty();
}

function renderKeywords() {
  if (els.keywords.value !== state.keywords) {
    els.keywords.value = state.keywords;
  }

  const count = phrases().length;
  els.countLabel.textContent = count === 0
    ? "3–7 needed"
    : count + (count >= 3 && count <= 7 ? " of 3–7 ✓" : " of 3–7");

  // Clear button: enabled only when there's text
  const hasText = state.keywords.trim().length > 0;
  els.clearKeywords.disabled = !hasText;
  els.clearKeywords.setAttribute("aria-disabled", String(!hasText));
}

function renderLanguage() {
  els.languageLabel.textContent = state.lang ? labelOf(state.lang) : "Choose language";
  els.languageButton.classList.toggle("has-value", Boolean(state.lang));
  els.languageButton.setAttribute("aria-expanded", String(state.langOpen));
  els.languageMenu.classList.toggle("is-hidden", !state.langOpen);
  els.languageMenu.innerHTML = "";

  LANGS.forEach((lang) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "language-option";
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(state.lang === lang.code));
    option.setAttribute("aria-disabled", String(Boolean(lang.disabled)));
    option.disabled = Boolean(lang.disabled);
    option.classList.toggle("is-selected", state.lang === lang.code);
    option.classList.toggle("is-disabled", Boolean(lang.disabled));
    option.innerHTML = `<span></span><span class="language-native"></span>`;
    option.children[0].textContent = lang.label;
    option.children[1].textContent = lang.native;
    if (!lang.disabled) {
      option.addEventListener("click", () => {
        state.lang = lang.code;
        state.langOpen = false;
        render();
      });
    }
    els.languageMenu.append(option);
  });
}

function renderWasabi() {
  els.wasabiDots.innerHTML = "";

  for (let index = 0; index < 6; index += 1) {
    const dot = document.createElement("span");
    dot.className = "wasabi-dot";
    dot.classList.toggle("is-active", index < state.spice);
    els.wasabiDots.append(dot);
  }

  els.spiceLabel.textContent = "Heat level: " + state.spice;
  els.spiceLabel.classList.toggle("is-active", state.spice > 0);
  els.spiceMax.classList.toggle("is-hidden", state.spice !== 6);
}

function renderHistory() {
  els.historyCount.textContent = state.history.length > 0 ? state.history.length + " saved" : "";
  els.historyEmpty.classList.toggle("is-hidden", state.history.length > 0);
  els.historyList.classList.toggle("is-hidden", state.history.length === 0);
  els.historyList.innerHTML = "";

  state.history.forEach((item) => {
    const card = document.createElement("div");
    card.className = "history-item";

    const lines = document.createElement("div");
    lines.className = "history-lines";
    item.lines.forEach((line) => {
      const row = document.createElement("div");
      row.textContent = line;
      lines.append(row);
    });

    const tags = document.createElement("div");
    tags.className = "history-tags";
    const lang = document.createElement("span");
    lang.textContent = item.langLabel;
    const spice = document.createElement("span");
    spice.textContent = "wasabi " + item.spice;
    const time = document.createElement("span");
    time.textContent = item.timeLabel;
    tags.append(lang, spice, time);

    card.append(lines, tags);
    els.historyList.append(card);
  });
}

function renderGenerateButton() {
  const loading = state.resultState === "loading";
  els.generateButton.textContent = loading ? "Generating…" : "Generate haiku";
  els.generateButton.disabled = loading;
}

function render() {
  renderResult();
  renderKeywords();
  renderLanguage();
  renderWasabi();
  renderHistory();
  renderGenerateButton();
}

function commitHistory(lines, langLabel, doneLang, spiceSuffix) {
  const date = new Date();
  const timeLabel = String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
  const item = { id: Date.now(), lines, langLabel, spice: state.spice, timeLabel };
  const history = [item, ...state.history].slice(0, 100);
  try { localStorage.setItem("haiku50_history", JSON.stringify(history)); } catch (e) {}
  state.resultState = "done";
  state.lines = lines;
  state.doneLang = doneLang;
  state.doneSpice = "wasabi " + state.spice + spiceSuffix;
  state.history = history;
  render();
}

async function generate() {
  if (state.resultState === "loading") return;

  const parts = phrases();
  if (parts.length < 3) {
    state.resultState = "error";
    state.errorMsg = "Enter 3 to 7 words or short phrases";
    render();
    return;
  }

  if (parts.length > 7) {
    state.resultState = "error";
    state.errorMsg = "Too many — keep it to 7 words or phrases at most";
    render();
    return;
  }

  if (!state.lang) {
    state.resultState = "error";
    state.errorMsg = "Choose a generation language";
    render();
    return;
  }

  const langName = labelOf(state.lang);
  state.resultState = "loading";
  state.errorMsg = "";
  render();

  var controller = new AbortController();
  var timeoutId = setTimeout(function () { controller.abort(); }, 30000);

  try {
    // запрос к серверу — единственный путь к AI
    const resp = await fetch("/generate-haiku", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ words: parts, language: langName, wasabiLevel: state.spice }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const data = await resp.json();

    // сервер вернул ошибку (проблема OpenAI, квота, таймаут)
    if (!data.success) {
      state.resultState = "error";
      state.errorMsg = data.error || "Generation failed";
      render();
      return;
    }

    // успех — парсим строки из ответа
    let lines = (data.lines || [])
      .map((line) => String(line).trim())
      .filter(Boolean)
      .slice(0, 3);

    if (lines.length === 0) {
      state.resultState = "error";
      state.errorMsg = "AI returned an empty response";
      render();
      return;
    }

    commitHistory(lines, langName, langName, "");

  } catch (error) {
    clearTimeout(timeoutId);

    // таймаут — сервер не ответил за 30 с
    if (error.name === "AbortError") {
      state.resultState = "error";
      state.errorMsg = "Request timed out — server did not respond in time";
      render();
      return;
    }

    // сетевая ошибка — сервер недоступен, используем offline-генератор
    const text = offlineHaiku(parts, state.spice);
    let lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 3);

    if (lines.length === 0) {
      lines = ["offline", "mode", "— try again later"];
    }

    commitHistory(lines, langName + " (offline)", langName, " (offline)");
  }
}

function loadHistory() {
  try {
    const raw = localStorage.getItem("haiku50_history");
    if (raw) state.history = JSON.parse(raw);
  } catch (error) {}
}

function bindElements() {
  els.resultStage = document.getElementById("result-stage");
  els.doneMeta = document.getElementById("done-meta");
  els.keywords = document.getElementById("keywords");
  els.countLabel = document.getElementById("count-label");
  els.clearKeywords = document.getElementById("clear-keywords");
  els.languageButton = document.getElementById("language-button");
  els.languageLabel = document.getElementById("language-label");
  els.languageMenu = document.getElementById("language-menu");
  els.languageCard = document.getElementById("language-card");
  els.wasabiButton = document.getElementById("wasabi-button");
  els.wasabiDots = document.getElementById("wasabi-dots");
  els.spiceLabel = document.getElementById("spice-label");
  els.spiceMax = document.getElementById("spice-max");
  els.historyCount = document.getElementById("history-count");
  els.historyEmpty = document.getElementById("history-empty");
  els.historyList = document.getElementById("history-list");
  els.generateButton = document.getElementById("generate-button");
}

function bindEvents() {
  els.keywords.addEventListener("input", (event) => {
    state.keywords = event.target.value;
    renderKeywords();
  });

  els.clearKeywords.addEventListener("click", () => {
    state.keywords = "";
    // синхронизируем textarea, если вдруг рассинхронизировалась
    if (els.keywords.value !== "") els.keywords.value = "";
    renderKeywords();
  });

  els.languageButton.addEventListener("click", () => {
    state.langOpen = !state.langOpen;
    renderLanguage();
  });

  document.addEventListener("click", (event) => {
    if (!els.languageCard.contains(event.target) && state.langOpen) {
      state.langOpen = false;
      renderLanguage();
    }
  });

  els.wasabiButton.addEventListener("click", () => {
    state.spice = state.spice < 6 ? state.spice + 1 : 0;
    renderWasabi();
  });

  els.generateButton.addEventListener("click", generate);
}

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  loadHistory();
  bindEvents();
  render();
});
