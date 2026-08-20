const visitSlogans = [
  "Понятно. Выразительно. По делу.",
  "Сделано здесь — заметно везде.",
  "Меньше шума. Больше результата.",
  "От идеи до запуска — одним маршрутом.",
  "Технологии с человеческим лицом.",
];

const select = (selector, scope = document) => scope.querySelector(selector);
const selectAll = (selector, scope = document) => [...scope.querySelectorAll(selector)];

function pickVisitSlogan() {
  let previous = -1;
  try { previous = Number.parseInt(localStorage.getItem("vyraz-slogan") || "-1", 10); } catch {}
  const choices = visitSlogans.map((_, index) => index).filter((index) => index !== previous);
  const index = choices[Math.floor(Math.random() * choices.length)] ?? 0;
  try { localStorage.setItem("vyraz-slogan", String(index)); } catch {}
  const element = select("[data-visit-slogan]");
  if (!element) return;
  element.replaceChildren();
  visitSlogans[index].split(" ").forEach((word, wordIndex) => {
    const span = document.createElement("span");
    span.className = "slogan-word";
    span.style.animationDelay = `${wordIndex * 70}ms`;
    span.textContent = word;
    element.append(span, document.createTextNode(" "));
  });
}

function setFormMessage(form, message, type = "success") {
  const output = select("[data-form-message]", form);
  if (!output) return;
  output.textContent = message;
  output.classList.toggle("error", type === "error");
}

async function request(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  const response = await fetch(url, {
    ...options,
    headers,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Не удалось выполнить запрос.");
  return data;
}

function createWorkCard(work) {
  const article = document.createElement("article");
  article.className = "work-card reveal";
  article.dataset.accent = work.accent || "paper";

  const meta = document.createElement("p");
  meta.className = "work-meta";
  meta.textContent = work.category;

  const title = document.createElement("h3");
  title.textContent = work.title;

  const description = document.createElement("p");
  description.textContent = work.description;

  article.append(meta, title, description);
  if (work.url) {
    const link = document.createElement("a");
    link.href = work.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "work-link";
    link.setAttribute("aria-label", `Открыть проект «${work.title}»`);
    link.textContent = "↗";
    article.append(link);
  }
  return article;
}

function createReviewCard(review) {
  const article = document.createElement("article");
  article.className = "review-card reveal";

  const stars = document.createElement("p");
  stars.className = "review-stars";
  stars.setAttribute("aria-label", `${review.rating} из 5`);
  stars.textContent = "★".repeat(review.rating) + "☆".repeat(5 - review.rating);

  const text = document.createElement("blockquote");
  text.textContent = `«${review.text}»`;

  const name = document.createElement("p");
  name.className = "review-author";
  name.textContent = review.name;

  article.append(stars, text, name);
  return article;
}

function applySettings(settings = {}) {
  selectAll("[data-brand]").forEach((item) => {
    item.textContent = settings.brand_name || "VYRAZ";
  });
  const title = select("[data-hero-title]");
  const highlight = select("[data-hero-highlight]");
  const description = select("[data-hero-description]");
  if (title && settings.hero_title) title.textContent = settings.hero_title;
  if (highlight && settings.hero_highlight) highlight.textContent = settings.hero_highlight;
  if (description && settings.hero_description) description.textContent = settings.hero_description;

  const emailWrap = select("[data-public-email-wrap]");
  const emailLink = select("[data-public-email]");
  if (settings.contact_email && emailWrap && emailLink) {
    emailWrap.hidden = false;
    emailLink.href = `mailto:${settings.contact_email}`;
    emailLink.textContent = settings.contact_email;
  } else if (emailWrap) {
    emailWrap.hidden = true;
  }
}

async function loadContent() {
  try {
    const { settings, works, reviews } = await request("/api/content", { method: "GET", headers: {} });
    applySettings(settings);

    const worksGrid = select("[data-works-grid]");
    if (worksGrid && works.length) {
      worksGrid.replaceChildren(...works.map(createWorkCard));
    }

    const reviewsGrid = select("[data-reviews-grid]");
    if (reviewsGrid && reviews.length) {
      reviewsGrid.replaceChildren(...reviews.map(createReviewCard));
    }
    setupReveal();
  } catch (error) {
    console.warn("Контент временно недоступен:", error.message);
  }
}

function setupForms() {
  const contactForm = select("[data-contact-form]");
  contactForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = select('button[type="submit"]', contactForm);
    button.disabled = true;
    setFormMessage(contactForm, "Отправляю…", "pending");
    try {
      const payload = Object.fromEntries(new FormData(contactForm));
      await request("/api/contact", { method: "POST", body: JSON.stringify(payload) });
      contactForm.reset();
      setFormMessage(contactForm, "Запрос принят. Я отвечу на указанный email.");
    } catch (error) {
      setFormMessage(contactForm, error.message, "error");
    } finally {
      button.disabled = false;
    }
  });

  const reviewForm = select("[data-review-form]");
  reviewForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = select('button[type="submit"]', reviewForm);
    button.disabled = true;
    setFormMessage(reviewForm, "Отправляю…", "pending");
    try {
      const payload = Object.fromEntries(new FormData(reviewForm));
      payload.rating = Number(payload.rating);
      await request("/api/reviews", { method: "POST", body: JSON.stringify(payload) });
      reviewForm.reset();
      setFormMessage(reviewForm, "Спасибо! Отзыв появится после модерации.");
    } catch (error) {
      setFormMessage(reviewForm, error.message, "error");
    } finally {
      button.disabled = false;
    }
  });
}

function setupReveal() {
  const items = selectAll(".reveal:not([data-reveal-ready])");
  if (!items.length) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    items.forEach((item) => item.classList.add("in-view"));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("in-view");
      observer.unobserve(entry.target);
    }),
    { threshold: 0.12 },
  );
  items.forEach((item) => {
    item.dataset.revealReady = "true";
    observer.observe(item);
  });
}

function setupNavigation() {
  const menuButton = select("[data-menu-button]");
  const nav = select("[data-mobile-nav]");
  menuButton?.addEventListener("click", () => {
    const open = menuButton.getAttribute("aria-expanded") === "true";
    menuButton.setAttribute("aria-expanded", String(!open));
    nav?.classList.toggle("open", !open);
    nav?.setAttribute("aria-hidden", String(open));
  });
  selectAll("a", nav).forEach((link) => link.addEventListener("click", () => {
    menuButton?.setAttribute("aria-expanded", "false");
    nav?.classList.remove("open");
    nav?.setAttribute("aria-hidden", "true");
  }));
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    menuButton?.setAttribute("aria-expanded", "false");
    nav?.classList.remove("open");
    nav?.setAttribute("aria-hidden", "true");
  });
  window.addEventListener("scroll", () => {
    select("[data-header]")?.classList.toggle("scrolled", window.scrollY > 16);
  }, { passive: true });
}

function setupCursor() {
  if (!window.matchMedia("(pointer: fine)").matches) return;
  const ring = select("[data-cursor-ring]");
  const dot = select("[data-cursor-dot]");
  if (!ring || !dot) return;
  window.addEventListener("pointermove", (event) => {
    document.body.classList.add("cursor-active");
    ring.style.transform = `translate3d(${event.clientX - ring.offsetWidth / 2}px, ${event.clientY - ring.offsetHeight / 2}px, 0)`;
    dot.style.transform = `translate3d(${event.clientX - 2.5}px, ${event.clientY - 2.5}px, 0)`;
  }, { passive: true });
  selectAll("a, button, input, textarea, select, [data-tilt]").forEach((element) => {
    element.addEventListener("pointerenter", () => document.body.classList.add("cursor-hover"));
    element.addEventListener("pointerleave", () => document.body.classList.remove("cursor-hover"));
  });
}

function setupScrollProgress() {
  const progress = select("[data-progress]");
  if (!progress) return;
  let scheduled = false;
  const update = () => {
    const distance = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.transform = `scaleX(${distance > 0 ? Math.min(1, window.scrollY / distance) : 0})`;
    scheduled = false;
  };
  window.addEventListener("scroll", () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(update);
  }, { passive: true });
  update();
}

function setupStage() {
  if (!window.matchMedia("(pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const stage = select("[data-stage]");
  const core = select("[data-stage-core]");
  if (!stage || !core) return;
  stage.addEventListener("pointermove", (event) => {
    const rect = stage.getBoundingClientRect();
    core.style.setProperty("--mx", `${((event.clientX - rect.left) / rect.width - .5) * 18}px`);
    core.style.setProperty("--my", `${((event.clientY - rect.top) / rect.height - .5) * 18}px`);
  });
  stage.addEventListener("pointerleave", () => {
    core.style.setProperty("--mx", "0px");
    core.style.setProperty("--my", "0px");
  });
}

function setupTilt() {
  if (!window.matchMedia("(pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  selectAll("[data-tilt]").forEach((card) => {
    card.addEventListener("pointermove", (event) => {
      const rect = card.getBoundingClientRect();
      card.style.setProperty("--ry", `${((event.clientX - rect.left) / rect.width - .5) * 4}deg`);
      card.style.setProperty("--rx", `${((event.clientY - rect.top) / rect.height - .5) * -4}deg`);
    });
    card.addEventListener("pointerleave", () => {
      card.style.setProperty("--rx", "0deg");
      card.style.setProperty("--ry", "0deg");
    });
  });
}

function setupMagnetic() {
  if (!window.matchMedia("(pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  selectAll(".magnetic").forEach((element) => {
    element.addEventListener("pointermove", (event) => {
      const rect = element.getBoundingClientRect();
      const x = (event.clientX - rect.left - rect.width / 2) * .12;
      const y = (event.clientY - rect.top - rect.height / 2) * .12;
      element.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    });
    element.addEventListener("pointerleave", () => { element.style.transform = ""; });
  });
}

pickVisitSlogan();
setupNavigation();
setupCursor();
setupScrollProgress();
setupStage();
setupTilt();
setupMagnetic();
setupForms();
setupReveal();
loadContent();
select("[data-year]").textContent = new Date().getFullYear();
