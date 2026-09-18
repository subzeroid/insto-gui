// Takes the README picture from the real frontend: a development server with the
// mocked bridge (`?mock=1`), rendered in headless Chromium. No packaged app, no
// token, no account and nothing from the machine it runs on ends up in the image.
import { chromium } from "playwright";
import { rename, rm } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

const url = process.argv[2] ?? "http://127.0.0.1:1420/?mock=1";
const out = process.argv[3] ?? "docs/screenshot.png";
const width = Number(process.argv[4] ?? 1200);
const height = Number(process.argv[5] ?? 800);
// The saved comparison of the selected account: the last thing the watches view
// paints, so waiting for it means every read behind it has already landed.
const readySelector = process.argv[6] ?? ".snapshot-history .changes";
// Selecting a watch is what opens that comparison; the list is keyboard- and
// click-driven, so the picture needs the same click a user would make.
const selectSelector = process.argv[7] ?? ".watch-list [role='option']";
const extension = extname(out) || ".png";
const temporaryOut = join(
  dirname(out),
  `.${basename(out)}.${process.pid}.${Date.now()}.tmp${extension}`,
);

const browser = await chromium.launch();
try {
  const pageErrors = [];
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 2,
  });

  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
    console.error("[pageerror]", err.message);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      console.error(`[console.${msg.type()}]`, msg.text());
    }
  });

  await page.goto(url, { waitUntil: "networkidle" });
  if (selectSelector !== "-") {
    await page.locator(selectSelector).first().click();
  }
  await page.locator(readySelector).first().waitFor({ state: "visible" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  await page.screenshot({ path: temporaryOut });
  if (pageErrors.length > 0) {
    throw new Error(`Screenshot aborted after ${pageErrors.length} page error(s)`);
  }
  await rename(temporaryOut, out);
  console.log("saved", out);
} finally {
  try {
    await browser.close();
  } finally {
    await rm(temporaryOut, { force: true });
  }
}
