import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const require = createRequire(path.join(root, "client", "package.json"));
const { chromium } = require("playwright");
const outDir = path.join(root, "demo-recordings");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join(outDir, `live-demo-${timestamp}`);
const appUrl = process.env.DEMO_URL ?? "https://client-alpha-seven-64.vercel.app";

async function waitAndShot(page, name) {
  await page.screenshot({ path: path.join(runDir, `${name}.png`), fullPage: true });
}

async function main() {
  await fs.mkdir(runDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    recordVideo: {
      dir: runDir,
      size: { width: 1440, height: 1000 },
    },
    permissions: ["camera", "microphone"],
  });

  const page = await context.newPage();
  page.setDefaultTimeout(30_000);

  const roomName = `Recorded demo ${Date.now()}`;
  const prompt =
    "Build a polished landing page for Build Room. Hero headline: Database is the Arena. Add three feature cards for Live State, AI Agents, and Verified Benchmarks.";

  console.log(`[demo] open ${appUrl}`);
  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Create & join/i }).waitFor();
  await waitAndShot(page, "01-lobby-loaded");

  console.log("[demo] create Free Build room");
  await page.getByPlaceholder("e.g. Ada Lovelace").fill("Judge Demo");
  await page.getByRole("textbox", { name: /Describe the web app/i }).fill(prompt);
  await page.getByRole("textbox").nth(2).fill(roomName);
  await waitAndShot(page, "02-lobby-filled");
  await page.getByRole("button", { name: /Create & join/i }).click();

  console.log("[demo] wait for build room");
  await page.getByText("index.html", { exact: true }).waitFor();
  await page.getByText("style.css", { exact: true }).waitFor();
  await page.getByText("app.js", { exact: true }).waitFor();
  await waitAndShot(page, "03-room-created");

  console.log("[demo] open index.html and save a visible edit");
  await page.getByText("index.html", { exact: true }).click();
  const editor = page.locator("textarea").last();
  await editor.waitFor();
  const original = await editor.inputValue();
  const updated = original.replace(
    /Build Room|Maincloud Pair Test|Hello, SpacetimeDB|Live demo/i,
    "Database is the Arena"
  );
  const fallback = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Database is the Arena</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <main class="hero">
      <p class="eyebrow">Live SpacetimeDB demo</p>
      <h1>Database is the Arena</h1>
      <p>Humans and AI agents build on one shared artifact, live.</p>
      <section class="cards">
        <article>Live state</article>
        <article>AI agents</article>
        <article>Verified benchmarks</article>
      </section>
    </main>
    <script src="app.js"></script>
  </body>
</html>`;
  await editor.fill(updated === original ? fallback : updated);
  await waitAndShot(page, "04-editor-modified");

  await page.getByRole("button", { name: /^Save$/i }).click();
  await page.waitForTimeout(2500);
  await page.getByText(/Database is the Arena/i).first().waitFor();
  await waitAndShot(page, "05-preview-updated");

  console.log("[demo] verify saved text still visible after reload");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText(/Database is the Arena/i).first().waitFor();
  await waitAndShot(page, "06-reloaded-state-persists");

  const video = await page.video();
  await context.close();
  await browser.close();

  const rawVideo = await video.path();
  const finalVideo = path.join(runDir, "build-room-real-demo.webm");
  await fs.rename(rawVideo, finalVideo);

  console.log(JSON.stringify({
    ok: true,
    appUrl,
    roomName,
    runDir,
    video: finalVideo,
    screenshots: [
      "01-lobby-loaded.png",
      "02-lobby-filled.png",
      "03-room-created.png",
      "04-editor-modified.png",
      "05-preview-updated.png",
      "06-reloaded-state-persists.png",
    ].map((name) => path.join(runDir, name)),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
