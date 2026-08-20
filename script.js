const header = document.querySelector("[data-header]");
const menuButton = document.querySelector(".menu-button");
const mobileMenu = document.querySelector(".mobile-menu");
const glow = document.querySelector(".cursor-glow");
const tiltCard = document.querySelector("[data-tilt]");
const form = document.querySelector("#project-form");
const toast = document.querySelector(".toast");
const sloganRoot = document.querySelector("[data-visit-slogan]");

const visitSlogans = [
  ["Точка, где идея", "становится", "цифровым продуктом."],
  ["Ваш продукт", "заметят", "и запомнят."],
  ["Превращаем сложное", "в ясное", "и красивое."],
  ["Интерфейсы с характером.", "Код со смыслом.", "Запуск без шума."],
  ["От первой мысли", "до работающего", "продукта."],
];

const renderVisitSlogan = () => {
  if (!sloganRoot) return;

  let previousIndex = -1;
  try {
    previousIndex = Number.parseInt(localStorage.getItem("kindot-slogan-index") || "-1", 10);
  } catch {
    previousIndex = -1;
  }

  const available = visitSlogans
    .map((_, index) => index)
    .filter((index) => index !== previousIndex);
  const nextIndex = available[Math.floor(Math.random() * available.length)];

  try {
    localStorage.setItem("kindot-slogan-index", String(nextIndex));
  } catch {
    // The slogan still works when storage is disabled; only visit-to-visit memory is skipped.
  }

  sloganRoot.replaceChildren();
  sloganRoot.setAttribute("aria-label", visitSlogans[nextIndex].join(" "));

  let wordIndex = 0;
  visitSlogans[nextIndex].forEach((text, lineIndex) => {
    const line = document.createElement("span");
    line.className = `slogan-line ${lineIndex === 1 ? "title-accent slogan-accent" : lineIndex === 0 ? "slogan-lead" : "slogan-tail"}`;

    text.split(" ").forEach((word, index, words) => {
      const wordElement = document.createElement("span");
      wordElement.className = "slogan-word";
      wordElement.textContent = word;
      wordElement.style.animationDelay = `${120 + wordIndex * 55}ms`;
      line.appendChild(wordElement);
      if (index < words.length - 1) line.append(" ");
      wordIndex += 1;
    });

    sloganRoot.appendChild(line);
  });
};

renderVisitSlogan();

const updateHeader = () => header?.classList.toggle("scrolled", window.scrollY > 20);
updateHeader();
window.addEventListener("scroll", updateHeader, { passive: true });

const closeMenu = () => {
  menuButton?.setAttribute("aria-expanded", "false");
  mobileMenu?.setAttribute("aria-hidden", "true");
  mobileMenu?.classList.remove("open");
};

menuButton?.addEventListener("click", () => {
  const isOpen = menuButton.getAttribute("aria-expanded") === "true";
  menuButton.setAttribute("aria-expanded", String(!isOpen));
  mobileMenu?.setAttribute("aria-hidden", String(isOpen));
  mobileMenu?.classList.toggle("open", !isOpen);
});

mobileMenu?.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMenu();
});

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("in-view");
      revealObserver.unobserve(entry.target);
    });
  },
  { threshold: 0.12 }
);

document.querySelectorAll(".reveal").forEach((element, index) => {
  element.style.transitionDelay = `${Math.min(index % 4, 3) * 70}ms`;
  revealObserver.observe(element);
});

if (matchMedia("(pointer: fine)").matches) {
  window.addEventListener(
    "pointermove",
    (event) => {
      if (!glow) return;
      glow.style.opacity = "1";
      glow.style.left = `${event.clientX}px`;
      glow.style.top = `${event.clientY}px`;
    },
    { passive: true }
  );

  tiltCard?.addEventListener("pointermove", (event) => {
    const rect = tiltCard.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    tiltCard.style.transform = `perspective(900px) rotateY(${x * 5}deg) rotateX(${y * -5}deg)`;
  });
  tiltCard?.addEventListener("pointerleave", () => {
    tiltCard.style.transform = "perspective(900px) rotateY(0deg) rotateX(0deg)";
  });
}

document.querySelectorAll(".accordion details").forEach((item) => {
  item.addEventListener("toggle", () => {
    if (!item.open) return;
    document.querySelectorAll(".accordion details").forEach((other) => {
      if (other !== item) other.removeAttribute("open");
    });
  });
});

const showToast = (copied) => {
  if (!toast) return;
  const title = toast.querySelector("strong");
  const subtitle = toast.querySelector("span");
  if (title) title.textContent = copied ? "Сообщение скопировано" : "Telegram открыт";
  if (subtitle) subtitle.textContent = copied
    ? "Вставьте его в открывшийся чат"
    : "Отправьте @kindow детали проекта";
  toast.classList.add("visible");
  window.setTimeout(() => toast.classList.remove("visible"), 4200);
};

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const details = String(data.get("details") || "").trim();
  const message = [
    "Здравствуйте! Хочу обсудить проект с KIN.DOT.",
    "",
    `Имя: ${data.get("name")}`,
    `Проект: ${data.get("project")}`,
    `Связь: ${data.get("contact")}`,
    details ? `Задача: ${details}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  let copied = false;
  try {
    await navigator.clipboard.writeText(message);
    copied = true;
  } catch {
    const helper = document.createElement("textarea");
    helper.value = message;
    helper.setAttribute("readonly", "");
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    copied = document.execCommand("copy");
    helper.remove();
  }

  window.open("https://t.me/kindow", "_blank", "noopener,noreferrer");
  showToast(copied);
});

document.querySelectorAll("[data-year]").forEach((element) => {
  element.textContent = String(new Date().getFullYear());
});
