// haiku 50 backend!! сделал за вечер пока хозяин спал, у меня вроде работает
// запускать: node server.js (лапками неудобно но можно)

var http = require("http");
var https = require("https");
var fs = require("fs");

var PORT = process.env.PORT || 3000;

// ключ читаем из .env, чтобы не светить в репозитории
// скопируй .env.example в .env и вставь туда свой ключ
var OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) {
  console.log("⚠️  OPENAI_API_KEY не найден в переменных окружения. Создай .env из .env.example");
  OPENAI_KEY = ""; // сервер запустится, но генерация через AI будет падать с ошибкой
}

// модель OpenAI — вынесена в одну константу
var AI_MODEL = "gpt-5-nano-2025-08-07";

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

// генерация: промпт и модель зависят от остроты (spice)
function sdelatHaiku(words, language, spice, res) {
  var prompt =
    "You are a haiku master. Write one three-line haiku in " + language + ".\n" +
    "Use these images and keywords: " + words.join(", ") + ".\n" +
    (spice > 0 ? "Make it SPICY and absurd, heat " + spice + " of 6.\n" : "") +
    "Return STRICTLY three lines. Each line on its own line. No titles, no numbering, no quotation marks, no explanations, no translation.\n" +
    "Avoid profanity, offensive content, or aggression.";

  var body = JSON.stringify({
    model: AI_MODEL,
    messages: [{ role: "user", content: prompt }],
  });

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
          var lines = (text || "").trim().split("\n").map(function (l) { return l.replace(/^[\s\-\d.)»«"']+/, "").trim(); }).filter(Boolean).slice(0, 3);
          if (lines.length === 0) {
            errorResponse(res, 502, "AI returned empty response");
            return;
          }
          successResponse(res, lines, words, language, spice);
        } catch (e) {
          errorResponse(res, 502, "Failed to parse AI response");
        }
      });
    }
  );
  // таймаут 30 с — если OpenAI не отвечает, отдаём 504 и чистим сокет
  r.setTimeout(30000, function () {
    if (!res.headersSent) errorResponse(res, 504, "AI request timed out");
    r.destroy();
  });
  r.on("error", function (err) {
    if (res.headersSent) return; // уже обработано таймаутом
    errorResponse(res, 502, "Network error calling AI: " + (err.message || "unknown"));
  });
  r.write(body);
  r.end();
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

      // валидация words
      var words = body.words;
      if (!Array.isArray(words) || words.length < 3 || words.length > 7) {
        errorResponse(res, 400, "Provide 3 to 7 keywords as an array");
        return;
      }

      // language — строка. Если не указан, используем переданный или "Japanese" по умолчанию
      var language = typeof body.language === "string" && body.language.trim()
        ? body.language.trim()
        : "Japanese";

      // wasabiLevel 0–6 без капа
      var spice = typeof body.wasabiLevel === "number" && !isNaN(body.wasabiLevel)
        ? Math.max(0, Math.min(6, body.wasabiLevel))
        : 0;

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
