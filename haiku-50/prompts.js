// ── конфигурация AI (модель, промпты, тексты) ──
// менять всё можно здесь — код server.js не трогать

// модель OpenAI
var AI_MODEL = "gpt-5-nano-2025-08-07";

// слой 1 — база: язык, слова, формат
// {language} и {keywords} подставляются в рантайме
var BASE_PROMPT_TEMPLATE =
  "Write a three-line haiku in {language}.\n" +
  "Keywords: {keywords}.\n" +
  "Be brief, poetic. No titles, no explanations before or after the haiku.\n";

// слой 2 — острота: уровень 0 (пусто) → 6 (максимум)
var SPICE_LAYER = [
  "",                                                                          // 0 — только база
  "Mood: gentle and quiet.",                                                   // 1
  "Mood: slightly unexpected, subtle irony.",                                  // 2
  "Mood: playful, with a humorous twist.",                                     // 3
  "Mood: bold and sharp, an absurd image.",                                    // 4
  "Mood: very spicy, chaotic, grotesque and funny.",                           // 5
  "Mood: maximum heat — absurd, surreal, dark-humored, yet still a haiku.",    // 6
];

// безопасность — всегда в конце промпта
var SAFETY_INSTRUCTION =
  "No profanity, no aggression, no prohibited content.";

// финальный повтор — всегда после safety
var FORMAT_INSTRUCTION =
  "Return ONLY three lines of haiku, nothing else.";

// correction-prompt для retry, когда модель не отдала ровно 3 строки
var CORRECTION_PROMPT =
  "That is not valid. Return EXACTLY three lines, one per line. No markdown, no explanations, no numbering, no preamble, no translation.";

// список поддерживаемых языков (метки — как в LANGS на фронтенде)
var SUPPORTED_LANGS = [
  "Japanese", "English", "Spanish", "French", "German", "Italian",
  "Portuguese", "Russian", "Chinese", "Korean", "Arabic", "Hindi"
];

// экспорт (CommonJS — server.js использует var/require)
module.exports = {
  AI_MODEL: AI_MODEL,
  BASE_PROMPT_TEMPLATE: BASE_PROMPT_TEMPLATE,
  SPICE_LAYER: SPICE_LAYER,
  SAFETY_INSTRUCTION: SAFETY_INSTRUCTION,
  FORMAT_INSTRUCTION: FORMAT_INSTRUCTION,
  CORRECTION_PROMPT: CORRECTION_PROMPT,
  SUPPORTED_LANGS: SUPPORTED_LANGS,
};
