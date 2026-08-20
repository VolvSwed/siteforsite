import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDatabase } from "./database.js";
import { cleanEmail, cleanText, cleanUrl } from "./validation.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const COOKIE_NAME = "vyraz_admin";
const SESSION_SECONDS = 60 * 60 * 8;
const SETTINGS_KEYS = ["brand_name", "hero_title", "hero_highlight", "hero_description", "contact_email"];
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

function loadEnvFile(filePath = path.join(ROOT, ".env")) {
  return readFile(filePath, "utf8").then((content) => {
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || match[1] in process.env) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      process.env[match[1]] = value;
    }
  }).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}

function securityHeaders() {
  return {
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; connect-src 'self'; style-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "geolocation=(), camera=(), microphone=()",
    "X-Frame-Options": "DENY",
  };
}

function sendJson(response, data, status = 200, headers = {}) {
  response.writeHead(status, { ...securityHeaders(), "Content-Type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(data));
}

async function readJson(request) {
  const declaredLength = Number(request.headers["content-length"] || 0);
  if (declaredLength > 25_000) throw Object.assign(new Error("Слишком большой запрос."), { status: 413 });
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 25_000) throw Object.assign(new Error("Слишком большой запрос."), { status: 413 });
  }
  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw Object.assign(new Error("Ожидался корректный JSON."), { status: 400 });
  }
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest();
}

function safeEqual(left, right) {
  return timingSafeEqual(hash(left), hash(right));
}

function sign(value, secret) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function parseCookies(request) {
  return Object.fromEntries((request.headers.cookie || "").split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    return index === -1 ? [part, ""] : [part.slice(0, index), part.slice(index + 1)];
  }));
}

function isSecureRequest(request, trustProxy) {
  return Boolean(request.socket.encrypted) || (trustProxy && request.headers["x-forwarded-proto"] === "https");
}

function sessionCookie(request, value, maxAge, trustProxy) {
  const secure = isSecureRequest(request, trustProxy) ? "; Secure" : "";
  return `${COOKIE_NAME}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Strict${secure}`;
}

function isAuthenticated(request, password) {
  if (!password) return false;
  const value = parseCookies(request)[COOKIE_NAME];
  if (!value) return false;
  const [rawExpires, signature] = value.split(".");
  const expires = Number(rawExpires);
  if (!Number.isInteger(expires) || expires < Math.floor(Date.now() / 1000) || !signature) return false;
  return safeEqual(signature, sign(rawExpires, password));
}

function requestOrigin(request, options) {
  const protocol = isSecureRequest(request, options.trustProxy) ? "https" : "http";
  const host = options.trustProxy && request.headers["x-forwarded-host"] ? request.headers["x-forwarded-host"] : request.headers.host;
  return `${protocol}://${host}`;
}

function sameOrigin(request, options) {
  const origin = request.headers.origin;
  if (!origin) return request.headers["sec-fetch-site"] !== "cross-site";
  const allowed = new Set([requestOrigin(request, options)]);
  if (options.publicOrigin) allowed.add(options.publicOrigin.replace(/\/$/, ""));
  return allowed.has(origin);
}

function createRateLimiter() {
  const buckets = new Map();
  return (key, limit, windowMs) => {
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    bucket.count += 1;
    if (buckets.size > 2000) {
      for (const [entryKey, entry] of buckets) if (entry.resetAt <= now) buckets.delete(entryKey);
    }
    return bucket.count <= limit;
  };
}

function clientIp(request, trustProxy) {
  if (trustProxy && request.headers["x-forwarded-for"]) return String(request.headers["x-forwarded-for"]).split(",")[0].trim();
  return request.socket.remoteAddress || "unknown";
}

async function serveStatic(request, response, pathname, publicDir) {
  let relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  if (pathname === "/admin" || pathname === "/admin/") relativePath = "admin.html";
  try { relativePath = decodeURIComponent(relativePath); } catch { return sendJson(response, { error: "Некорректный адрес." }, 400); }
  const absolutePath = path.resolve(publicDir, relativePath);
  if (!absolutePath.startsWith(`${path.resolve(publicDir)}${path.sep}`)) return sendJson(response, { error: "Доступ запрещён." }, 403);
  try {
    const file = await stat(absolutePath);
    if (!file.isFile()) throw Object.assign(new Error(), { code: "ENOENT" });
    const extension = path.extname(absolutePath).toLowerCase();
    const cache = extension === ".html" ? "no-cache" : "public, max-age=3600";
    response.writeHead(200, { ...securityHeaders(), "Content-Type": MIME_TYPES[extension] || "application/octet-stream", "Content-Length": file.size, "Cache-Control": cache });
    if (request.method === "HEAD") return response.end();
    createReadStream(absolutePath).pipe(response);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    sendJson(response, { error: "Страница не найдена." }, 404);
  }
}

export async function createApplication(config = {}) {
  const options = {
    publicDir: config.publicDir || PUBLIC_DIR,
    dataFile: config.dataFile || process.env.DATA_FILE || path.join(ROOT, "data", "vyraz.sqlite"),
    adminPassword: config.adminPassword ?? process.env.ADMIN_PASSWORD ?? "",
    publicOrigin: config.publicOrigin ?? process.env.PUBLIC_ORIGIN ?? "",
    trustProxy: config.trustProxy ?? process.env.TRUST_PROXY === "1",
  };
  const database = createDatabase(options.dataFile);
  const allowRequest = createRateLimiter();

  async function api(request, response, url) {
    if (request.method !== "GET" && !sameOrigin(request, options)) return sendJson(response, { error: "Запрос отклонён." }, 403);
    const ip = clientIp(request, options.trustProxy);

    if (url.pathname === "/api/content" && request.method === "GET") {
      return sendJson(response, database.publicContent(), 200, { "Cache-Control": "no-store" });
    }

    if (url.pathname === "/api/contact" && request.method === "POST") {
      if (!allowRequest(`contact:${ip}`, 10, 60 * 60 * 1000)) return sendJson(response, { error: "Слишком много запросов. Попробуйте позже." }, 429);
      const body = await readJson(request);
      if (cleanText(body.website, 200)) return sendJson(response, { ok: true }, 202);
      const record = {
        name: cleanText(body.name, 80), email: cleanEmail(body.email), company: cleanText(body.company, 120),
        project: cleanText(body.project, 80), budget: cleanText(body.budget, 80), message: cleanText(body.message, 2000),
      };
      if (record.name.length < 2 || !record.email || record.project.length < 2 || record.message.length < 10) return sendJson(response, { error: "Проверьте имя, email и описание задачи." }, 400);
      return sendJson(response, { ok: true, id: database.insertLead(record) }, 201);
    }

    if (url.pathname === "/api/reviews" && request.method === "POST") {
      if (!allowRequest(`review:${ip}`, 5, 60 * 60 * 1000)) return sendJson(response, { error: "Слишком много запросов. Попробуйте позже." }, 429);
      const body = await readJson(request);
      if (cleanText(body.website, 200)) return sendJson(response, { ok: true }, 202);
      const record = { name: cleanText(body.name, 80), email: cleanEmail(body.email), rating: Number(body.rating), text: cleanText(body.text, 1200) };
      if (record.name.length < 2 || !record.email || !Number.isInteger(record.rating) || record.rating < 1 || record.rating > 5 || record.text.length < 10) return sendJson(response, { error: "Проверьте имя, email, оценку и текст отзыва." }, 400);
      return sendJson(response, { ok: true, id: database.insertPublicReview(record), status: "pending" }, 201);
    }

    if (url.pathname === "/api/admin/login" && request.method === "POST") {
      if (!options.adminPassword || options.adminPassword.length < 12) return sendJson(response, { error: "ADMIN_PASSWORD не настроен на хостинге." }, 503);
      if (!allowRequest(`login:${ip}`, 10, 15 * 60 * 1000)) return sendJson(response, { error: "Слишком много попыток. Попробуйте через 15 минут." }, 429);
      const body = await readJson(request);
      if (!safeEqual(typeof body.password === "string" ? body.password : "", options.adminPassword)) return sendJson(response, { error: "Неверный пароль." }, 401);
      const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
      return sendJson(response, { ok: true }, 200, { "Set-Cookie": sessionCookie(request, `${expires}.${sign(String(expires), options.adminPassword)}`, SESSION_SECONDS, options.trustProxy) });
    }

    if (url.pathname === "/api/admin/logout" && request.method === "POST") return sendJson(response, { ok: true }, 200, { "Set-Cookie": sessionCookie(request, "", 0, options.trustProxy) });
    if (!url.pathname.startsWith("/api/admin/") || !isAuthenticated(request, options.adminPassword)) return sendJson(response, { error: "Требуется вход в админку." }, 401);

    if (url.pathname === "/api/admin/data" && request.method === "GET") {
      return sendJson(response, database.adminData(), 200, { "Cache-Control": "no-store" });
    }

    if (url.pathname === "/api/admin/settings" && request.method === "PUT") {
      const body = await readJson(request);
      const limits = { brand_name: 40, hero_title: 120, hero_highlight: 120, hero_description: 600, contact_email: 160 };
      const settings = Object.fromEntries(SETTINGS_KEYS.map((key) => [key, cleanText(body[key], limits[key])]));
      if (!settings.brand_name || !settings.hero_title || !settings.hero_highlight || settings.hero_description.length < 10) return sendJson(response, { error: "Заполните название, заголовок и описание." }, 400);
      if (settings.contact_email && !cleanEmail(settings.contact_email)) return sendJson(response, { error: "Публичный email указан неверно." }, 400);
      database.saveSettings(settings);
      return sendJson(response, { ok: true });
    }

    const collectionRoute = url.pathname.match(/^\/api\/admin\/(leads|works|reviews)(?:\/(\d+))?$/);
    if (!collectionRoute) return sendJson(response, { error: "Маршрут не найден." }, 404);
    const [, collection, rawId] = collectionRoute;
    const id = rawId ? Number(rawId) : null;

    if (collection === "leads" && id && request.method === "PUT") {
      const body = await readJson(request);
      if (!["new", "in_progress", "done"].includes(body.status)) return sendJson(response, { error: "Недопустимый статус." }, 400);
      const found = database.updateLead(id, body.status);
      return found ? sendJson(response, { ok: true }) : sendJson(response, { error: "Запись не найдена." }, 404);
    }

    if (collection === "works" && ["POST", "PUT"].includes(request.method) && (request.method === "POST" || id)) {
      const body = await readJson(request);
      const record = {
        title: cleanText(body.title, 120), category: cleanText(body.category, 80), description: cleanText(body.description, 1000),
        url: cleanUrl(body.url), accent: ["paper", "blue", "red", "acid"].includes(body.accent) ? body.accent : "paper",
        sort_order: Math.max(-999, Math.min(999, Number.parseInt(body.sort_order, 10) || 0)), published: Boolean(body.published),
      };
      if (record.title.length < 2 || record.category.length < 2 || record.description.length < 10 || record.url === null) return sendJson(response, { error: "Проверьте название, категорию, описание и ссылку." }, 400);
      record.published = record.published ? 1 : 0;
      const savedId = database.saveWork(record, id);
      return savedId ? sendJson(response, { ok: true, id: savedId }, id ? 200 : 201) : sendJson(response, { error: "Запись не найдена." }, 404);
    }

    if (collection === "reviews" && ["POST", "PUT"].includes(request.method) && (request.method === "POST" || id)) {
      const body = await readJson(request);
      const record = { name: cleanText(body.name, 80), email: cleanEmail(body.email), rating: Number(body.rating), text: cleanText(body.text, 1200), status: ["pending", "approved", "rejected"].includes(body.status) ? body.status : "pending" };
      if (record.name.length < 2 || !record.email || !Number.isInteger(record.rating) || record.rating < 1 || record.rating > 5 || record.text.length < 10) return sendJson(response, { error: "Проверьте имя, email, оценку и текст." }, 400);
      const savedId = database.saveReview(record, id);
      return savedId ? sendJson(response, { ok: true, id: savedId }, id ? 200 : 201) : sendJson(response, { error: "Запись не найдена." }, 404);
    }

    if (id && request.method === "DELETE") {
      const deleted = database.delete(collection, id);
      return deleted ? sendJson(response, { ok: true }) : sendJson(response, { error: "Запись не найдена." }, 404);
    }
    return sendJson(response, { error: "Метод не поддерживается." }, 405);
  }

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", requestOrigin(request, options));
      if (url.pathname.startsWith("/api/")) return await api(request, response, url);
      if (!["GET", "HEAD"].includes(request.method)) return sendJson(response, { error: "Метод не поддерживается." }, 405);
      return await serveStatic(request, response, url.pathname, options.publicDir);
    } catch (error) {
      console.error(error);
      return sendJson(response, { error: error.status && error.status < 500 ? error.message : "Внутренняя ошибка сервера." }, error.status || 500);
    }
  });
  return { server, database };
}

export async function start() {
  await loadEnvFile();
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || "0.0.0.0";
  const { server, database } = await createApplication();
  server.listen(port, host, () => {
    console.log(`VYRAZ запущен: http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
    console.log(`Данные: ${database.filePath}`);
    if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12) console.warn("ADMIN_PASSWORD не задан: вход в админку отключён.");
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) start();
