const COOKIE_NAME = "vyraz_admin";
const SESSION_SECONDS = 60 * 60 * 8;
const SETTINGS_KEYS = ["brand_name", "hero_title", "hero_highlight", "hero_description", "contact_email"];
const encoder = new TextEncoder();

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      let response;
      if (url.pathname.startsWith("/api/")) {
        response = await routeApi(request, env, url);
      } else if (url.pathname === "/admin" || url.pathname === "/admin/") {
        const assetUrl = new URL(request.url);
        assetUrl.pathname = "/admin.html";
        response = await env.ASSETS.fetch(new Request(assetUrl, request));
      } else {
        response = await env.ASSETS.fetch(request);
      }
      return withSecurityHeaders(response);
    } catch (error) {
      console.error(error);
      return withSecurityHeaders(json({ error: "Внутренняя ошибка сервера." }, 500));
    }
  },
};

async function routeApi(request, env, url) {
  if (request.method !== "GET" && !sameOrigin(request, url)) {
    return json({ error: "Запрос отклонён." }, 403);
  }

  if (url.pathname === "/api/content" && request.method === "GET") return publicContent(env);
  if (url.pathname === "/api/contact" && request.method === "POST") return createLead(request, env);
  if (url.pathname === "/api/reviews" && request.method === "POST") return createPublicReview(request, env);
  if (url.pathname === "/api/admin/login" && request.method === "POST") return login(request, env);
  if (url.pathname === "/api/admin/logout" && request.method === "POST") return logout();

  if (url.pathname.startsWith("/api/admin/")) {
    if (!(await isAuthenticated(request, env))) return json({ error: "Требуется вход в админку." }, 401);
    return routeAdmin(request, env, url);
  }
  return json({ error: "Маршрут не найден." }, 404);
}

async function publicContent(env) {
  const [settingsRows, worksResult, reviewsResult] = await env.DB.batch([
    env.DB.prepare("SELECT key, value FROM site_settings"),
    env.DB.prepare("SELECT id, title, category, description, url, accent FROM works WHERE published = 1 ORDER BY sort_order ASC, id DESC"),
    env.DB.prepare("SELECT id, name, rating, text, created_at FROM reviews WHERE status = 'approved' ORDER BY id DESC LIMIT 30"),
  ]);
  const settings = Object.fromEntries(settingsRows.results.map((row) => [row.key, row.value]));
  return json({ settings, works: worksResult.results, reviews: reviewsResult.results }, 200, { "Cache-Control": "public, max-age=30" });
}

async function createLead(request, env) {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  if (cleanText(body.website, 200)) return json({ ok: true }, 202);

  const name = cleanText(body.name, 80);
  const email = cleanEmail(body.email);
  const company = cleanText(body.company, 120);
  const project = cleanText(body.project, 80);
  const budget = cleanText(body.budget, 80);
  const message = cleanText(body.message, 2000);
  if (name.length < 2 || !email || project.length < 2 || message.length < 10) {
    return json({ error: "Проверьте имя, email и описание задачи." }, 400);
  }
  await env.DB.prepare(
    "INSERT INTO leads (name, email, company, project, budget, message) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(name, email, company, project, budget, message).run();
  return json({ ok: true }, 201);
}

async function createPublicReview(request, env) {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  if (cleanText(body.website, 200)) return json({ ok: true }, 202);

  const name = cleanText(body.name, 80);
  const email = cleanEmail(body.email);
  const rating = Number(body.rating);
  const text = cleanText(body.text, 1200);
  if (name.length < 2 || !email || !Number.isInteger(rating) || rating < 1 || rating > 5 || text.length < 10) {
    return json({ error: "Проверьте имя, email, оценку и текст отзыва." }, 400);
  }
  await env.DB.prepare(
    "INSERT INTO reviews (name, email, rating, text, status) VALUES (?, ?, ?, ?, 'pending')",
  ).bind(name, email, rating, text).run();
  return json({ ok: true, status: "pending" }, 201);
}

async function login(request, env) {
  if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 12) {
    return json({ error: "ADMIN_PASSWORD не настроен на хостинге." }, 503);
  }
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const password = typeof body.password === "string" ? body.password : "";
  if (!(await safeEqual(password, env.ADMIN_PASSWORD))) return json({ error: "Неверный пароль." }, 401);

  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const signature = await sign(String(expires), env.ADMIN_PASSWORD);
  return json({ ok: true }, 200, {
    "Set-Cookie": `${COOKIE_NAME}=${expires}.${signature}; Max-Age=${SESSION_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Strict`,
  });
}

function logout() {
  return json({ ok: true }, 200, {
    "Set-Cookie": `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`,
  });
}

async function routeAdmin(request, env, url) {
  if (url.pathname === "/api/admin/data" && request.method === "GET") return adminData(env);
  if (url.pathname === "/api/admin/works" && request.method === "POST") return saveWork(request, env);
  if (url.pathname === "/api/admin/reviews" && request.method === "POST") return saveReview(request, env);
  if (url.pathname === "/api/admin/settings" && request.method === "PUT") return saveSettings(request, env);

  const match = url.pathname.match(/^\/api\/admin\/(leads|works|reviews)\/(\d+)$/);
  if (!match) return json({ error: "Маршрут не найден." }, 404);
  const [, resource, rawId] = match;
  const id = Number(rawId);
  if (request.method === "DELETE") return deleteResource(env, resource, id);
  if (request.method === "PUT" && resource === "leads") return updateLead(request, env, id);
  if (request.method === "PUT" && resource === "works") return saveWork(request, env, id);
  if (request.method === "PUT" && resource === "reviews") return saveReview(request, env, id);
  return json({ error: "Метод не поддерживается." }, 405);
}

async function adminData(env) {
  const [leads, works, reviews, settingRows] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM leads ORDER BY id DESC"),
    env.DB.prepare("SELECT * FROM works ORDER BY sort_order ASC, id DESC"),
    env.DB.prepare("SELECT * FROM reviews ORDER BY id DESC"),
    env.DB.prepare("SELECT key, value FROM site_settings"),
  ]);
  return json({
    leads: leads.results,
    works: works.results,
    reviews: reviews.results,
    settings: Object.fromEntries(settingRows.results.map((row) => [row.key, row.value])),
  }, 200, { "Cache-Control": "no-store" });
}

async function updateLead(request, env, id) {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  if (!["new", "in_progress", "done"].includes(body.status)) return json({ error: "Недопустимый статус." }, 400);
  const result = await env.DB.prepare("UPDATE leads SET status = ? WHERE id = ?").bind(body.status, id).run();
  return mutationResult(result);
}

async function saveWork(request, env, id = null) {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const title = cleanText(body.title, 120);
  const category = cleanText(body.category, 80);
  const description = cleanText(body.description, 1000);
  const url = cleanUrl(body.url);
  const accent = ["paper", "blue", "red", "acid"].includes(body.accent) ? body.accent : "paper";
  const sortOrder = Math.max(-999, Math.min(999, Number.parseInt(body.sort_order, 10) || 0));
  const published = body.published ? 1 : 0;
  if (title.length < 2 || category.length < 2 || description.length < 10 || url === null) {
    return json({ error: "Проверьте название, категорию, описание и ссылку." }, 400);
  }
  let result;
  if (id) {
    result = await env.DB.prepare(
      "UPDATE works SET title = ?, category = ?, description = ?, url = ?, accent = ?, sort_order = ?, published = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).bind(title, category, description, url, accent, sortOrder, published, id).run();
  } else {
    result = await env.DB.prepare(
      "INSERT INTO works (title, category, description, url, accent, sort_order, published) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(title, category, description, url, accent, sortOrder, published).run();
  }
  return mutationResult(result, id ? 200 : 201);
}

async function saveReview(request, env, id = null) {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const name = cleanText(body.name, 80);
  const email = cleanEmail(body.email);
  const rating = Number(body.rating);
  const text = cleanText(body.text, 1200);
  const status = ["pending", "approved", "rejected"].includes(body.status) ? body.status : "pending";
  if (name.length < 2 || !email || !Number.isInteger(rating) || rating < 1 || rating > 5 || text.length < 10) {
    return json({ error: "Проверьте имя, email, оценку и текст." }, 400);
  }
  let result;
  if (id) {
    result = await env.DB.prepare(
      "UPDATE reviews SET name = ?, email = ?, rating = ?, text = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).bind(name, email, rating, text, status, id).run();
  } else {
    result = await env.DB.prepare(
      "INSERT INTO reviews (name, email, rating, text, status) VALUES (?, ?, ?, ?, ?)",
    ).bind(name, email, rating, text, status).run();
  }
  return mutationResult(result, id ? 200 : 201);
}

async function saveSettings(request, env) {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const limits = { brand_name: 40, hero_title: 120, hero_highlight: 120, hero_description: 600, contact_email: 160 };
  const values = {};
  for (const key of SETTINGS_KEYS) values[key] = cleanText(body[key], limits[key]);
  if (!values.brand_name || !values.hero_title || !values.hero_highlight || values.hero_description.length < 10) {
    return json({ error: "Заполните название, заголовок и описание." }, 400);
  }
  if (values.contact_email && !cleanEmail(values.contact_email)) return json({ error: "Публичный email указан неверно." }, 400);
  const statements = SETTINGS_KEYS.map((key) => env.DB.prepare(
    "INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
  ).bind(key, values[key]));
  await env.DB.batch(statements);
  return json({ ok: true });
}

async function deleteResource(env, resource, id) {
  const tables = { leads: "leads", works: "works", reviews: "reviews" };
  const table = tables[resource];
  if (!table) return json({ error: "Недопустимый ресурс." }, 400);
  const result = await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
  return mutationResult(result);
}

function mutationResult(result, status = 200) {
  if (!result.meta?.changes) return json({ error: "Запись не найдена." }, 404);
  return json({ ok: true, id: result.meta.last_row_id || undefined }, status);
}

async function isAuthenticated(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (!match) return false;
  const [rawExpires, signature] = match[1].split(".");
  const expires = Number(rawExpires);
  if (!Number.isInteger(expires) || expires < Math.floor(Date.now() / 1000) || !signature) return false;
  return safeEqual(signature, await sign(rawExpires, env.ADMIN_PASSWORD));
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function safeEqual(left, right) {
  const leftDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(String(left))));
  const rightDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(String(right))));
  let difference = 0;
  for (let index = 0; index < leftDigest.length; index += 1) difference |= leftDigest[index] ^ rightDigest[index];
  return difference === 0;
}

function sameOrigin(request, url) {
  const origin = request.headers.get("Origin");
  return !origin || origin === url.origin;
}

async function readJson(request) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > 25_000) return json({ error: "Слишком большой запрос." }, 413);
  try {
    return await request.json();
  } catch {
    return json({ error: "Ожидался корректный JSON." }, 400);
  }
}

export function cleanText(value, limit) {
  return typeof value === "string" ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, limit) : "";
}

export function cleanEmail(value) {
  const email = cleanText(value, 160).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : "";
}

export function cleanUrl(value) {
  const url = cleanText(value, 500);
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; connect-src 'self'; style-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "geolocation=(), camera=(), microphone=()");
  headers.set("X-Frame-Options", "DENY");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
