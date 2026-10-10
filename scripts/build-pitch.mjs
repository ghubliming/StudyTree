/**
 * Renders the investor deck (public/pitch/index.html) to
 * public/pitch/StudyTree-Pitch-Deck.pdf, one 16:9 page per slide.
 *   CHROME_PATH=/path/to/chrome npm run pitch
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = path.join(root, "public/pitch/index.html");
const out = path.join(root, "public/pitch/StudyTree-Pitch-Deck.pdf");

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" });
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(html).href, { waitUntil: "load", timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: out, width: "1280px", height: "720px", printBackground: true, preferCSSPageSize: true });
  console.log(`Wrote ${path.relative(root, out)}`);
} finally {
  await browser.close();
}
