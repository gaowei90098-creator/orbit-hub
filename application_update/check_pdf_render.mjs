import { chromium } from "/Users/gao90098/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const pdfPath = "/Users/gao90098/Desktop/AgentHub/application_update/Orbit_AgentHub_Project_Overview.pdf";
const outDir = "/Users/gao90098/Desktop/AgentHub/application_update/pdf_render_check";
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const page = await browser.newPage({ viewport: { width: 1200, height: 1500 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(pdfPath).href, { waitUntil: "load" });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${outDir}/pdf_open_top.png`, fullPage: false });
await page.mouse.wheel(0, 1100);
await page.waitForTimeout(500);
await page.screenshot({ path: `${outDir}/pdf_open_after_scroll.png`, fullPage: false });
await browser.close();
console.log(outDir);
