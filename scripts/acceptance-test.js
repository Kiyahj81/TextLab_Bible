const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const net = require("node:net");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const project = process.cwd();
// Use `localhost` (not 127.0.0.1) so the page origin matches the host
// Auth.js puts into the sign-in form's `action` attribute — otherwise
// the CSP `form-action 'self'` directive blocks the submit.
const appUrl = process.env.TEXTLAB_ACCEPTANCE_URL ?? "http://localhost:3000";
const screenshotsDir = path.join(os.tmpdir(), "textlab-browser-qa");
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Fail fast if PostgreSQL is not reachable. Without this, the acceptance
// test starts Next, then hits a generic readiness timeout in waitForServer
// because Prisma queries hang — the developer has to dig through logs to
// realize Docker isn't running. Failing early surfaces the real cause.
async function preflightDatabase() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error("DATABASE_URL is not set. Configure it in .env before running the acceptance test.");
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`DATABASE_URL is not a valid URL: ${raw}`);
  }

  const host = parsed.hostname || "localhost";
  const port = Number(parsed.port) || 5432;

  await new Promise((resolve, reject) => {
    const socket = net.connect({ host, port, timeout: 3000 });
    socket.once("connect", () => { socket.end(); resolve(); });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error(`PostgreSQL preflight failed: timed out connecting to ${host}:${port} after 3000ms. Is Docker running?`));
    });
    socket.once("error", (err) => {
      reject(new Error(`PostgreSQL preflight failed: cannot reach ${host}:${port} (${err.code ?? err.message}). Is Docker running?`));
    });
  });
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

// Drives the auto-generated Auth.js sign-in page to authenticate as a
// test user via the dev Credentials provider. The provider is only
// available when AUTH_DEV_ENABLED=1 is set in the Next process env (we
// set this in the spawn() block below). After this returns, the page
// context holds a valid session cookie, so subsequent goto() calls land
// on the real page instead of redirecting to sign-in.
async function signInAsTestUser(page) {
  await page.goto(`${appUrl}/api/auth/signin`);
  await page.locator('input[name="email"]').fill("acceptance@textlab.test");
  await page.locator('input[name="name"]').fill("Acceptance Tester");
  // Auth.js v5 renders one submit button per provider, labeled
  // "Sign in with {provider name}" — our provider name is "Dev login".
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/api/auth")),
    page.getByRole("button", { name: /Sign in with Dev login/i }).click()
  ]);
}

async function run() {
  await preflightDatabase();
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
    "localhost",
    "--port",
    "3000"
  ], {
    cwd: project,
    env: {
      ...process.env,
      NODE_OPTIONS: "--use-system-ca",
      TEXTLAB_ASSISTANT_DISABLE_LIVE: "1",
      // Enables the dev-only Credentials provider so the acceptance test
      // can sign in without a real OAuth integration. NEVER set this in
      // production.
      AUTH_DEV_ENABLED: "1"
    },
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

    // Sign in via the dev Credentials provider before exercising any
    // protected page. /read, /search, /notes, and /assistant all require
    // auth since Sprint 2.
    await signInAsTestUser(page);
    result.interactions.push("Signed in via dev credentials provider.");

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
    await page.getByRole("heading", { name: "Assistant", exact: true }).waitFor();
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
    // Mobile context is fresh — needs its own session.
    await signInAsTestUser(mobilePage);
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
        // Tolerate hydration-mismatch warnings that are only about input style attributes —
        // these are browser autofill / extension injections (e.g. caret-color, empty style={{}}),
        // not real app bugs. Same noise that drove the earlier caret-color filter.
        !(message.includes("hydration-mismatch") &&
          (message.includes('caret-color:"transparent"') || message.includes("style={{}}")))
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
    await fs.writeFile(path.join(screenshotsDir, "next-full.log"), logs.join(""));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    next.kill();
  }
}

run();
