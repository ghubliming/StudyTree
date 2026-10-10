/**
 * Browser smoke test against a running server (npm run build && npm start).
 *   BASE_URL=http://localhost:8787 CHROME_PATH=/path/to/chrome npm run smoke
 * Walks the core demo flow: open sample → topic → ask → branch map → select
 * text → explain → export PDF + study pack. Fails on any page error.
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const base = process.env.BASE_URL ?? "http://localhost:8787";
const out = process.env.SMOKE_OUT ?? "smoke-output";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

const step = async (name, fn) => {
  process.stdout.write(`• ${name} … `);
  await fn();
  await page.screenshot({ path: `${out}/${name.replace(/\W+/g, "-")}.png` });
  console.log("ok");
};

try {
  await step("library", () => page.goto(base).then(() => page.waitForSelector(".dropzone")));
  await step("open sample", async () => {
    await page.getByText("Try the sample").click();
    await page.waitForFunction(() => document.querySelectorAll(".textLayer span").length > 10);
  });
  await step("open topic", async () => {
    await page.locator(".topic-badge").first().click();
    await page.waitForSelector(".disc .msg");
  });
  await step("tree map", async () => {
    await page.getByRole("tab", { name: "Tree map" }).click();
    await page.waitForSelector(".map-node");
    await page.getByRole("tab", { name: "Discussion" }).click();
  });
  await step("ask", async () => {
    await page.locator(".composer textarea").fill("Why is the bias needed?");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => !document.querySelector(".msg-body.caret"), null, { timeout: 120000 });
  });
  await step("select text and explain", async () => {
    const span = page.locator('.page[data-page="1"] .textLayer span').filter({ hasText: "Rosenblatt" }).first();
    const b = await span.boundingBox();
    await page.mouse.move(b.x + 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width - 2, b.y + b.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.locator(".sel-toolbar").getByRole("button", { name: "Explain" }).click();
    await page.waitForFunction(() => !document.querySelector(".msg-body.caret"), null, { timeout: 120000 });
  });
  await step("export", async () => {
    await page.getByRole("button", { name: /Export/ }).click();
    const [pdf] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download PDF/ }).click()]);
    await pdf.saveAs(`${out}/annotated.pdf`);
    const [pack] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download study pack/ }).click()]);
    await pack.saveAs(`${out}/session.studytree`);
  });
} finally {
  await browser.close();
}
if (errors.length) {
  console.error("Page errors:\n" + errors.join("\n"));
  process.exit(1);
}
console.log(`Smoke test passed. Screenshots and exports in ${out}/`);
