import { chromium } from "/Users/gao90098/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = "/Users/gao90098/Desktop/AgentHub/application_update";
const htmlPath = path.join(root, "orbit_overview.html");
const pdfPath = path.join(root, "Orbit_AgentHub_Project_Overview.pdf");
const previewPath = path.join(root, "orbit_overview_preview.png");

await mkdir(root, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const page = await browser.newPage({ viewport: { width: 1280, height: 1800 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
await page.emulateMedia({ media: "print" });
await page.pdf({
  path: pdfPath,
  format: "A4",
  printBackground: true,
  preferCSSPageSize: true,
});
await page.screenshot({ path: previewPath, fullPage: true });
await browser.close();

console.log(JSON.stringify({ pdfPath, previewPath }, null, 2));
