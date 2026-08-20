import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { createDatabase } from "../src/database.js";

test("SQLite stores leads, reviews, works and settings", () => {
  const directory = mkdtempSync(path.join(process.cwd(), "data", "test-db-"));
  const database = createDatabase(path.join(directory, "test.sqlite"));
  try {
    const leadId = database.insertLead({ name: "Иван", email: "ivan@example.by", company: "Тест", project: "Сайт", budget: "", message: "Нужен новый сайт для компании." });
    assert.equal(database.updateLead(leadId, "in_progress"), true);
    const reviewId = database.insertPublicReview({ name: "Анна", email: "anna@example.by", rating: 5, text: "Отличная и аккуратная работа." });
    const workId = database.saveWork({ title: "Тестовый проект", category: "Сайт", description: "Описание тестового проекта.", url: "https://example.by/", accent: "blue", sort_order: 1, published: 1 });
    database.saveSettings({ ...database.adminData().settings, hero_title: "Новый заголовок" });

    const data = database.adminData();
    assert.equal(data.leads[0].status, "in_progress");
    assert.equal(data.reviews[0].id, reviewId);
    assert.equal(data.works[0].id, workId);
    assert.equal(data.settings.hero_title, "Новый заголовок");
    assert.equal(database.publicContent().works.length, 1);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
