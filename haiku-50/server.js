// haiku 50 backend!! сделал за вечер пока хозяин спал, у меня вроде работает
// запускать: node server.js (лапками неудобно но можно)

var http = require("http");
var https = require("https");
var fs = require("fs");

// все тексты и конфигурация AI — в отдельном файле
var CONFIG = require("./prompts");

var PORT = process.env.PORT || 3000;

// ключ читаем из .env, чтобы не светить в репозитории
// скопируй .env.example в .env и вставь туда свой ключ
var OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) {
  console.log("⚠️  OPENAI_API_KEY не найден в переменных окружения. Создай .env из .env.example");
  OPENAI_KEY = ""; // сервер запустится, но генерация через AI будет падать с ошибкой
}

var HISTORY = []; // in-memory история (до 500, потом сдвиг)

// rate limiter: 10 запросов с одного IP в минуту
var RATE_LIMIT_MAP = new Map();
var RATE_LIMIT_WINDOW_MS = 60_000; // 1 минута
var RATE_LIMIT_MAX = 10;           // макс запросов в окно

// периодическая чистка RATE_LIMIT_MAP от записей, чьё окно истекло
// предотвращает утечку памяти при большом количестве уникальных IP
var RATE_LIMIT_CLEANUP_MS = 5 * 60 * 1000; // 5 минут
setInterval(function () {
  var cutoff = Date.now() - RATE_LIMIT_WINDOW_MS - 5000; // +5s запас
  RATE_LIMIT_MAP.forEach(function (entry, ip) {
    if (entry.windowStart < cutoff) RATE_LIMIT_MAP.delete(ip);
  });
}, RATE_LIMIT_CLEANUP_MS);

// ловим rejected promises — тоже логируем stack trace и завершаем процесс
process.on("unhandledRejection", function (reason) {
  console.error("❌ Необработанный reject промиса:", reason);
  if (reason && reason.stack) console.error("Stack trace:", reason.stack);
  process.exit(1);
});

// логируем неожиданную ошибку со stack trace и завершаем процесс
// сервер с неопределённым состоянием продолжать работу опасно
process.on("uncaughtException", function (err) {
  console.error("❌ Непойманная ошибка:", err);
  console.error("Stack trace:", err && err.stack);
  process.exit(1);
});

// вспомогательная: отправить JSON-ответ
function jsonResponse(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data));
}

// вспомогательная: ответ с ошибкой
function errorResponse(res, status, message) {
  jsonResponse(res, status, { success: false, error: message, source: "error" });
}

// rate limiter: проверяет, не превышен ли лимит для данного IP
// возвращает true, если запрос надо отклонить (ответ уже отправлен)
function isRateLimited(ip, res) {
  var now = Date.now();
  var entry = RATE_LIMIT_MAP.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    // новое окно
    RATE_LIMIT_MAP.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    errorResponse(res, 429, "Too many requests. Try again later.");
    console.log("⛔ Rate limit hit for", ip, "-", entry.count, "requests in window");
    return true;
  }
  return false;
}

// вспомогательная: успешный ответ с хайку
function successResponse(res, lines, words, language, spice) {
  // сохраняем в историю в формате, совместимом с клиентом
  var now = new Date();
  var timeLabel = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
  HISTORY.push({
    id: Date.now(),
    lines: lines,
    langLabel: language,
    spice: spice,
    timeLabel: timeLabel
  });
  // лимит 500, сдвигаем старые
  if (HISTORY.length > 500) HISTORY = HISTORY.slice(-500);
  console.log("generated!!! total:", HISTORY.length);

  jsonResponse(res, 200, { success: true, lines: lines, source: "openai" });
}

// ── нормализация сырого ответа AI ──
// модель часто оборачивает текст в ```, добавляет «Вот ваше хайку:» и т.д.
function normalizuj(text) {
  if (!text) return [];
  // срезаем markdown-блоки ```text … ```, ``` … ``` и подобные
  text = text.replace(/```[\w]*\s*/gi, "").replace(/```/g, "");
  // срезаем пояснения до и после — ищем первую и последнюю строки хайку
  var lines = text.split("\n")
    .map(function (l) { return l.trim(); })
    .filter(Boolean);
  // убираем строки, похожие на пояснения: начинаются с «Вот», «Here's», «Sure», «Of course»,
  // «Конечно», «Voici», «Aquí», «Ecco», «Вот», «当然», заканчиваются на : или —
  var haikuLines = [];
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i];
    // срезаем нумерацию, кавычки, дефисы, звёздочки в начале строки
    l = l.replace(/^[\s\-–—\d.)»«"''*•·]+/, "").trim();
    // срезаем заведомо не-хайку: заголовки, пояснения, переводы
    var preamble = /^(вот|here'?s|sure|of course|конечно|voici|aquí|ecco|当然|नमस्ते|i('d| would)|попробую|вот ваше)/i;
    var suffix = /[:—–]$/;
    if (preamble.test(l) || suffix.test(l)) continue;
    // строка с двоеточием в начале («Хайку:») — срезаем до двоеточия
    l = l.replace(/^[^:]*:\s*/, "").trim();
    if (l) haikuLines.push(l);
  }
  return haikuLines.slice(0, 3);
}

// ── два слоя промпта: базовый + острота ──
function sdelatHaiku(words, language, spice, res) {
  // слой 1 — база: язык, слова, формат
  var basePrompt = CONFIG.BASE_PROMPT_TEMPLATE
    .replace("{language}", language)
    .replace("{keywords}", words.join(", "));

  // слой 2 — острота (0–6)
  var prompt = basePrompt + (spice > 0 ? CONFIG.SPICE_LAYER[spice] + "\n" : "");

  // безопасность + формат — всегда
  prompt += CONFIG.SAFETY_INSTRUCTION + "\n" + CONFIG.FORMAT_INSTRUCTION;

  var body = JSON.stringify({
    model: CONFIG.AI_MODEL,
    messages: [{ role: "user", content: prompt }],
  });

  var attemptCount = 0;
  var MAX_ATTEMPTS = 2;

  function otslat() {
    attemptCount++;
    var r = https.request(
      {
        hostname: "api.openai.com",
        path: "/v1/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + OPENAI_KEY,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      function (resp) {
        var data = "";
        resp.on("data", function (chunk) { data += chunk; });
        resp.on("end", function () {
          try {
            var parsed = JSON.parse(data);
            if (parsed.error) {
              errorResponse(res, 502, "OpenAI API error: " + (parsed.error.message || "unknown"));
              return;
            }
            var text = parsed.choices[0].message.content;

            // нормализуем: срезаем markdown-обёртку, пояснения, нумерацию
            var lines = normalizuj(text);

            // если после нормализации не ровно 3 строки — пробуем ещё раз с жёстким промптом
            if (lines.length !== 3) {
              if (attemptCount < MAX_ATTEMPTS) {
                // повтор с требованием исправить формат
                body = JSON.stringify({
                  model: CONFIG.AI_MODEL,
                  messages: [
                    { role: "user", content: prompt },
                    { role: "assistant", content: text },
                    { role: "user", content: CONFIG.CORRECTION_PROMPT },
                  ]
                });
                otslat();
                return;
              }
              errorResponse(res, 502, "AI returned " + lines.length + " lines instead of 3 — try again");
              return;
            }

            successResponse(res, lines, words, language, spice);
          } catch (e) {
            errorResponse(res, 502, "Failed to parse AI response");
          }
        });
      }
    );
    r.setTimeout(30000, function () {
      if (!res.headersSent) errorResponse(res, 504, "AI request timed out");
      r.destroy();
    });
    r.on("error", function (err) {
      if (res.headersSent) return;
      errorResponse(res, 502, "Network error calling AI: " + (err.message || "unknown"));
    });
    r.write(body);
    r.end();
  }

  otslat();
}

var server = http.createServer(function (req, res) {
  // POST — генерация хайку
  if (req.method == "POST" && (req.url == "/generate-haiku" || req.url == "/generateHaiku" || req.url == "/generate")) {
    // rate limit: проверяем IP перед обработкой платного запроса
    var clientIP = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
    if (isRateLimited(clientIP, res)) return;

    var raw = "";
    var bodySize = 0;
    var MAX_BODY_SIZE = 1024 * 1024; // 1 MB
    var requestAborted = false;

    req.on("data", function (chunk) {
      if (requestAborted) return;
      bodySize += chunk.length;
      if (bodySize > MAX_BODY_SIZE) {
        requestAborted = true;
        errorResponse(res, 413, "Request body too large");
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on("end", function () {
      if (requestAborted) return; // тело превысило лимит, ответ уже отправлен
      var body;
      try {
        body = JSON.parse(raw);
      } catch (e) {
        errorResponse(res, 400, "Invalid JSON in request body");
        return;
      }

      // ── валидация (дублирует фронтенд — бэкенд последняя защита) ──

      // words: массив из 3–7 непустых строк
      var words = body.words;
      if (!Array.isArray(words)) {
        errorResponse(res, 400, "Provide 3 to 7 keywords as an array");
        return;
      }
      words = words
        .map(function (w) { return String(w).trim(); })
        .filter(Boolean);
      if (words.length < 3) {
        errorResponse(res, 400, "Provide at least 3 keywords or phrases");
        return;
      }
      if (words.length > 7) {
        errorResponse(res, 400, "Too many keywords — maximum 7 allowed");
        return;
      }

      // language: строка, один из 12 поддерживаемых языков (не дефолтим!)
      var language = typeof body.language === "string" ? body.language.trim() : "";
      if (!language || CONFIG.SUPPORTED_LANGS.indexOf(language) === -1) {
        errorResponse(res, 400, "Choose a generation language");
        return;
      }

      // wasabiLevel: целое число 0–6
      var spice = body.wasabiLevel;
      if (typeof spice !== "number" || isNaN(spice) || spice !== Math.floor(spice) || spice < 0 || spice > 6) {
        errorResponse(res, 400, "Wasabi level must be a whole number from 0 to 6");
        return;
      }

      sdelatHaiku(words, language, spice, res);
    });
    return;
  }

  // GET /history — история генераций (в формате клиента, newest first)
  if (req.url == "/history") {
    var slice = HISTORY.slice(-100).reverse();
    jsonResponse(res, 200, slice);
    return;
  }

  // статика
  var file = req.url == "/" ? "index.html" : req.url.slice(1);
  var type = "text/html";
  if (file.indexOf(".css") > -1) type = "text/css";
  if (file.indexOf(".js") > -1) type = "text/javascript";
  if (file.indexOf(".svg") > -1) type = "image/svg+xml";

  try {
    var data = fs.readFileSync(__dirname + "/" + file);
    res.writeHead(200, { "Content-Type": type + "; charset=utf-8" });
    res.end(data);
  } catch (e) {
    // 404 для ненайденных файлов
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
});

server.listen(PORT, function () {
  console.log("haiku 50 server: http://localhost:" + PORT + " поехали");
});
