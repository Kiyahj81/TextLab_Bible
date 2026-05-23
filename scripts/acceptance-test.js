const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const project = process.cwd();
const appUrl = process.env.TEXTLAB_ACCEPTANCE_URL ?? "http://127.0.0.1:3000";
const screenshotsDir = path.join(os.tmpdir(), "textlab-browser-qa");
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForServer(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${appUrl}/read`);
      if (response.ok) return;
    } catch {
      // Wait for Next to start serving; ECONNREFUSED is expected during boot.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error("Next server did not become ready");
}

async function run() {
  await fs.mkdir(screenshotsDir, { recursive: true });

  const result = {
    passed: false,
    url: appUrl,
    desktopViewport: "1365x900",
    mobileViewport: "390x844",
    screenshotsDir,
    interactions: [],
    consoleMessages: [],
    failedResponses: [],
    screenshots: []
  };

  const next = spawn(process.execPath, [
    path.join(project, "node_modules", "next", "dist", "bin", "next"),
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3000"
  ], {
    cwd: project,
    env: { ...process.env, NODE_OPTIONS: "--use-system-ca", TEXTLAB_ASSISTANT_DISABLE_LIVE: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const logs = [];
  next.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  next.stderr.on("data", (chunk) => logs.push(chunk.toString()));

  let browser;

  try {
    await waitForServer();
    browser = await chromium.launch({ executablePath: edgePath, headless: true, args: ["--disable-extensions"] });

    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1365, height: 900 } });
    const page = await context.newPage();

    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) {
        result.consoleMessages.push(`${message.type()}: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => result.consoleMessages.push(`pageerror: ${error.message}`));
    page.on("response", (response) => {
      if (response.status() >= 400) {
        result.failedResponses.push(`${response.status()} ${response.url()}`);
      }
    });

    async function screenshot(name) {
      const file = path.join(screenshotsDir, `${name}.png`);
      await page.screenshot({ path: file, fullPage: false });
      result.screenshots.push(file);
    }

    await page.goto(`${appUrl}/read`);
    assert((await page.title()).includes("TextLab Bible"), "page title did not match");
    await page.getByRole("heading", { name: "Reader" }).waitFor();
    await page.getByRole("heading", { name: "John 1:1", exact: true }).waitFor();
    await screenshot("01-read");

    await page.getByRole("button", { name: "λόγος" }).first().click();
    await page.getByText("Morphology", { exact: true }).waitFor();
    await page.getByText("N-NSM").waitFor();
    result.interactions.push("Clicked λόγος token and saw morphology N-NSM popover.");
    await screenshot("02-popover");

    await page.getByRole("button", { name: "Highlight", exact: true }).click();
    await page.getByText("Highlight saved.").waitFor();
    result.interactions.push("Highlighted selected token and saw Highlight saved.");
    await page.getByRole("button", { name: "Close" }).click();

    const john11Article = page.locator("article").filter({ has: page.getByRole("heading", { name: "John 1:1", exact: true }) });
    await john11Article.getByPlaceholder("Write a brief note").fill("QA acceptance note on John 1:1");
    await john11Article.getByRole("button", { name: "Save note" }).click();
    await page.getByText("Note saved.").waitFor();
    result.interactions.push("Saved a verse note and saw Note saved.");

    await page.getByRole("button", { name: "λόγος" }).first().click();
    await page.getByRole("link", { name: "Search lemma" }).click();
    await page.waitForURL(/\/search/);
    await page.getByText('40 results for "λόγος"').waitFor();
    await page.getByText("John 1:1").first().waitFor();
    result.interactions.push('Search lemma opened /search and showed 40 λόγος results.');
    await page.getByRole("button", { name: "Save search" }).click();
    await page.getByText("Search saved.").waitFor();
    await page.getByRole("link", { name: /lemma: λόγος/ }).first().waitFor();
    result.interactions.push("Saved the lemma search and saw it listed in saved searches.");
    await screenshot("03-search-lemma");

    await page.goto(`${appUrl}/assistant`);
    await page.getByRole("heading", { name: "AI Study Assistant" }).waitFor();
    await page.locator("textarea").first().fill("Show me every use of λόγος in John 1 and summarize the pattern.");
    await page.getByRole("button", { name: "Ask assistant" }).click();
    await page.locator("pre").filter({ hasText: "Textual observations: I found 40 occurrences" }).waitFor({
      timeout: 30000
    });
    await page.getByText("Local fallback").waitFor();
    await page.getByText("gpt-5.3-chat-latest").waitFor();
    await page.getByText('searchLemma({"lemma":"λόγος","book":"John"})').waitFor();
    await page.getByText("John 1:1, SBLGNT").first().waitFor();
    await page.getByRole("button", { name: "Save generated note" }).click();
    await page.getByText("Generated note saved.").waitFor();
    await page.getByText("Show me every use of λόγος in John 1").first().waitFor();
    result.interactions.push("Saved the assistant answer as generated study-note history.");

    const markdownValue = await page.locator("textarea[readonly]").inputValue();
    assert(markdownValue.includes("# Lemma Study"), "markdown export text area did not include Lemma Study");
    result.interactions.push("Assistant returned retrieval-first answer, trace, citations, and Markdown content.");
    await screenshot("04-assistant-answer");

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export Markdown" }).click();
    const download = await downloadPromise;
    const downloadPath = path.join(screenshotsDir, "textlab-study-note.md");
    await download.saveAs(downloadPath);
    const markdown = await fs.readFile(downloadPath, "utf8");
    assert(markdown.includes("# Lemma Study"), "downloaded markdown missing title");
    assert(markdown.includes("John 1:1, SBLGNT"), "downloaded markdown missing citation");
    result.interactions.push("Export Markdown downloaded a study note with title and citation.");

    const notesResponse = await page.request.get(`${appUrl}/api/notes`);
    const notesJson = await notesResponse.json();
    assert(
      notesJson.notes.some((note) => note.body === "QA acceptance note on John 1:1"),
      "saved note was not returned by notes API"
    );
    result.interactions.push("Saved note persisted and was returned by /api/notes.");
    result.finalUrl = page.url();
    result.title = await page.title();

    await context.close();

    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto(`${appUrl}/read`);
    await mobilePage.getByRole("heading", { name: "Reader" }).waitFor();
    await mobilePage.getByRole("heading", { name: "John 1:1", exact: true }).waitFor();
    const hasHorizontalOverflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert(!hasHorizontalOverflow, "mobile /read page has horizontal overflow");
    const mobileShot = path.join(screenshotsDir, "05-mobile-read.png");
    await mobilePage.screenshot({ path: mobileShot, fullPage: false });
    result.screenshots.push(mobileShot);
    result.interactions.push("Mobile /read smoke check rendered without horizontal overflow.");
    await mobileContext.close();

    const nonFaviconFailures = result.failedResponses.filter((message) => !message.includes("favicon.ico"));
    assert(nonFaviconFailures.length === 0, `failed responses found: ${nonFaviconFailures.join("; ")}`);

    const relevantConsole = result.consoleMessages.filter(
      (message) =>
        !message.includes("Failed to load resource") &&
        !(message.includes("hydration-mismatch") && message.includes('caret-color:"transparent"'))
    );
    assert(relevantConsole.length === 0, `console errors/warnings found: ${relevantConsole.join("; ")}`);

    result.nextLogTail = logs.join("").split(/\r?\n/).slice(-30);
    result.passed = true;
    await fs.writeFile(path.join(screenshotsDir, "result.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    result.error = error.stack || String(error);
    result.nextLogTail = logs.join("").split(/\r?\n/).slice(-30);
    await fs.writeFile(path.join(screenshotsDir, "result.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    next.kill();
  }
}

run();
