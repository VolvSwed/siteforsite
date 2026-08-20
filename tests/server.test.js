import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { createApplication } from "../src/server.js";

test("Node server accepts a lead and protects admin data", async () => {
  const directory = mkdtempSync(path.join(process.cwd(), "data", "test-server-"));
  const { server, database } = await createApplication({ dataFile: path.join(directory, "test.sqlite"), adminPassword: "testing-password-123" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const homeResponse = await fetch(origin);
    assert.equal(homeResponse.status, 200);
    assert.match(await homeResponse.text(), /VYRAZ\.BY/);
    assert.equal((await fetch(`${origin}/admin`)).status, 200);

    const leadResponse = await fetch(`${origin}/api/contact`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ name: "Иван", email: "ivan@example.by", project: "Сайт", message: "Нужен новый сайт для компании." }),
    });
    assert.equal(leadResponse.status, 201);

    const reviewResponse = await fetch(`${origin}/api/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ name: "Анна", email: "anna@example.by", rating: 5, text: "Отличная и аккуратная работа." }),
    });
    assert.equal(reviewResponse.status, 201);
    const publicContent = await (await fetch(`${origin}/api/content`)).json();
    assert.equal(publicContent.reviews.length, 0);
    assert.equal((await fetch(`${origin}/api/admin/data`)).status, 401);

    const loginResponse = await fetch(`${origin}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ password: "testing-password-123" }),
    });
    assert.equal(loginResponse.status, 200);
    const cookie = loginResponse.headers.get("set-cookie").split(";")[0];
    const adminResponse = await fetch(`${origin}/api/admin/data`, { headers: { Cookie: cookie } });
    assert.equal(adminResponse.status, 200);
    const adminData = await adminResponse.json();
    assert.equal(adminData.leads.length, 1);
    assert.equal(adminData.reviews[0].email, "anna@example.by");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
