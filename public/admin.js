const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const state = { leads: [], works: [], reviews: [], settings: {} };

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Ошибка запроса.");
    error.status = response.status;
    throw error;
  }
  return data;
}

function globalMessage(text, error = false) {
  const output = $("[data-global-message]");
  output.textContent = text;
  output.style.color = error ? "#ad1e1e" : "#276223";
  if (text) window.setTimeout(() => {
    if (output.textContent === text) output.textContent = "";
  }, 3500);
}

function badge(status) {
  const labels = { new: "Новая", in_progress: "В работе", done: "Закрыта", pending: "На проверке", approved: "Опубликован", rejected: "Отклонён" };
  return node("span", `badge badge--${status}`, labels[status] || status);
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ru-BY", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function actionButton(label, handler, className = "") {
  const button = node("button", className, label);
  button.type = "button";
  button.addEventListener("click", handler);
  return button;
}

function renderLeads() {
  const list = $("[data-leads-list]");
  list.replaceChildren();
  $("[data-leads-count]").textContent = state.leads.filter((lead) => lead.status === "new").length;
  if (!state.leads.length) {
    list.append(node("div", "empty", "Заявок пока нет."));
    return;
  }
  state.leads.forEach((lead) => {
    const card = node("article", "record");
    const top = node("div", "record-top");
    const heading = node("div");
    heading.append(node("p", "record-meta", `${formatDate(lead.created_at)} · ${lead.project}`), node("h3", "", lead.name));
    top.append(heading, badge(lead.status));

    const contact = node("div", "record-contact");
    const email = node("a", "", lead.email);
    email.href = `mailto:${lead.email}`;
    contact.append(email);
    if (lead.company) contact.append(node("span", "", lead.company));
    if (lead.budget) contact.append(node("span", "", lead.budget));

    const message = node("p", "", lead.message);
    const actions = node("div", "record-actions");
    const status = document.createElement("select");
    [["new", "Новая"], ["in_progress", "В работе"], ["done", "Закрыта"]].forEach(([value, label]) => {
      const option = node("option", "", label);
      option.value = value;
      option.selected = value === lead.status;
      status.append(option);
    });
    status.addEventListener("change", () => updateLead(lead.id, status.value));
    actions.append(status, actionButton("Удалить", () => deleteRecord("lead", lead.id), "danger"));
    card.append(top, contact, message, actions);
    list.append(card);
  });
}

function renderWorks() {
  const list = $("[data-works-list]");
  list.replaceChildren();
  if (!state.works.length) {
    list.append(node("div", "empty", "Работ пока нет. Добавьте первый реальный кейс."));
    return;
  }
  state.works.forEach((work) => {
    const card = node("article", "record");
    const top = node("div", "record-top");
    const heading = node("div");
    heading.append(node("p", "record-meta", `${work.category} · порядок ${work.sort_order}`), node("h3", "", work.title));
    top.append(heading, badge(work.published ? "approved" : "rejected"));
    const description = node("p", "", work.description);
    const actions = node("div", "record-actions");
    actions.append(actionButton("Редактировать", () => openWork(work)), actionButton("Удалить", () => deleteRecord("work", work.id), "danger"));
    card.append(top, description);
    if (work.url) {
      const link = node("a", "record-contact", work.url);
      link.href = work.url;
      link.target = "_blank";
      link.rel = "noopener";
      card.append(link);
    }
    card.append(actions);
    list.append(card);
  });
}

function renderReviews() {
  const list = $("[data-reviews-list]");
  list.replaceChildren();
  $("[data-reviews-count]").textContent = state.reviews.filter((review) => review.status === "pending").length;
  if (!state.reviews.length) {
    list.append(node("div", "empty", "Отзывов пока нет."));
    return;
  }
  state.reviews.forEach((review) => {
    const card = node("article", "record");
    const top = node("div", "record-top");
    const heading = node("div");
    heading.append(node("p", "record-meta", `${"★".repeat(review.rating)} · ${formatDate(review.created_at)}`), node("h3", "", review.name));
    top.append(heading, badge(review.status));
    const email = node("a", "record-contact", review.email);
    email.href = `mailto:${review.email}`;
    const text = node("p", "", review.text);
    const actions = node("div", "record-actions");
    if (review.status !== "approved") actions.append(actionButton("Опубликовать", () => quickReview(review, "approved")));
    if (review.status !== "rejected") actions.append(actionButton("Отклонить", () => quickReview(review, "rejected")));
    actions.append(actionButton("Редактировать", () => openReview(review)), actionButton("Удалить", () => deleteRecord("review", review.id), "danger"));
    card.append(top, email, text, actions);
    list.append(card);
  });
}

function renderSettings() {
  const form = $("[data-settings-form]");
  Object.entries(state.settings).forEach(([key, value]) => {
    if (form.elements[key]) form.elements[key].value = value;
  });
}

function renderAll() {
  renderLeads();
  renderWorks();
  renderReviews();
  renderSettings();
}

async function loadData() {
  try {
    const data = await api("/api/admin/data", { method: "GET", headers: {} });
    Object.assign(state, data);
    $("[data-login]").hidden = true;
    $("[data-dashboard]").hidden = false;
    renderAll();
    return true;
  } catch (error) {
    if (error.status !== 401) globalMessage(error.message, true);
    return false;
  }
}

async function updateLead(id, status) {
  try {
    await api(`/api/admin/leads/${id}`, { method: "PUT", body: JSON.stringify({ status }) });
    const lead = state.leads.find((item) => item.id === id);
    lead.status = status;
    renderLeads();
    globalMessage("Статус обновлён.");
  } catch (error) { globalMessage(error.message, true); }
}

async function quickReview(review, status) {
  try {
    await api(`/api/admin/reviews/${review.id}`, { method: "PUT", body: JSON.stringify({ ...review, status }) });
    review.status = status;
    renderReviews();
    globalMessage("Статус отзыва обновлён.");
  } catch (error) { globalMessage(error.message, true); }
}

async function deleteRecord(type, id) {
  const labels = { lead: "заявку", work: "работу", review: "отзыв" };
  if (!window.confirm(`Удалить ${labels[type]}? Это действие нельзя отменить.`)) return;
  const plural = { lead: "leads", work: "works", review: "reviews" }[type];
  try {
    await api(`/api/admin/${plural}/${id}`, { method: "DELETE" });
    state[plural] = state[plural].filter((item) => item.id !== id);
    renderAll();
    globalMessage("Удалено.");
  } catch (error) { globalMessage(error.message, true); }
}

function openWork(work = {}) {
  const form = $("[data-work-form]");
  form.reset();
  form.hidden = false;
  form.elements.id.value = work.id || "";
  form.elements.title.value = work.title || "";
  form.elements.category.value = work.category || "";
  form.elements.description.value = work.description || "";
  form.elements.url.value = work.url || "";
  form.elements.accent.value = work.accent || "paper";
  form.elements.sort_order.value = work.sort_order ?? 0;
  form.elements.published.checked = work.published === undefined ? true : Boolean(work.published);
  $("[data-work-form-title]").textContent = work.id ? "Редактировать работу" : "Новая работа";
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function openReview(review = {}) {
  const form = $("[data-review-editor]");
  form.reset();
  form.hidden = false;
  ["id", "name", "email", "rating", "status", "text"].forEach((key) => {
    if (form.elements[key]) form.elements[key].value = review[key] ?? (key === "rating" ? 5 : key === "status" ? "pending" : "");
  });
  $("[data-review-form-title]").textContent = review.id ? "Редактировать отзыв" : "Новый отзыв";
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function setupTabs() {
  $$('[data-tab]').forEach((button) => button.addEventListener("click", () => {
    const target = button.dataset.tab;
    $$('[data-tab]').forEach((item) => item.classList.toggle("is-active", item === button));
    $$('[data-panel]').forEach((panel) => {
      const active = panel.dataset.panel === target;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
    });
    $("[data-page-title]").textContent = { leads: "Заявки", works: "Работы", reviews: "Отзывы", settings: "Настройки" }[target];
  }));
}

function setupForms() {
  $("[data-login-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = $("button", form);
    const output = $("[data-login-message]");
    button.disabled = true;
    output.textContent = "Проверяю…";
    try {
      await api("/api/admin/login", { method: "POST", body: JSON.stringify({ password: form.elements.password.value }) });
      form.reset();
      output.textContent = "";
      await loadData();
    } catch (error) { output.textContent = error.message; }
    finally { button.disabled = false; }
  });

  $("[data-work-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form));
    payload.sort_order = Number(payload.sort_order);
    payload.published = form.elements.published.checked;
    const id = payload.id;
    delete payload.id;
    try {
      await api(id ? `/api/admin/works/${id}` : "/api/admin/works", { method: id ? "PUT" : "POST", body: JSON.stringify(payload) });
      form.hidden = true;
      await loadData();
      globalMessage("Работа сохранена.");
    } catch (error) { globalMessage(error.message, true); }
  });

  $("[data-review-editor]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form));
    payload.rating = Number(payload.rating);
    const id = payload.id;
    delete payload.id;
    try {
      await api(id ? `/api/admin/reviews/${id}` : "/api/admin/reviews", { method: id ? "PUT" : "POST", body: JSON.stringify(payload) });
      form.hidden = true;
      await loadData();
      globalMessage("Отзыв сохранён.");
    } catch (error) { globalMessage(error.message, true); }
  });

  $("[data-settings-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api("/api/admin/settings", { method: "PUT", body: JSON.stringify(payload) });
      state.settings = payload;
      globalMessage("Настройки сохранены.");
    } catch (error) { globalMessage(error.message, true); }
  });
}

setupTabs();
setupForms();
$("[data-new-work]").addEventListener("click", () => openWork());
$("[data-close-work]").addEventListener("click", () => { $("[data-work-form]").hidden = true; });
$("[data-new-review]").addEventListener("click", () => openReview());
$("[data-close-review]").addEventListener("click", () => { $("[data-review-editor]").hidden = true; });
$("[data-refresh]").addEventListener("click", loadData);
$("[data-logout]").addEventListener("click", async () => {
  await api("/api/admin/logout", { method: "POST" });
  location.reload();
});
loadData();
