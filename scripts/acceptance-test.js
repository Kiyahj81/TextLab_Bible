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
    throw new Error("DATABASE_URL is not set. Configure it in .env.test (a Neon test branch) before running the acceptance test.");
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
      reject(new Error(`PostgreSQL preflight failed: timed out connecting to ${host}:${port} after 3000ms. Is the test database reachable?`));
    });
    socket.once("error", (err) => {
      reject(new Error(`PostgreSQL preflight failed: cannot reach ${host}:${port} (${err.code ?? err.message}). Is the test database reachable?`));
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

// Drives the custom /signin page to authenticate as a test user via the
// dev Credentials provider. The provider is only available when
// AUTH_DEV_ENABLED=1 is set in the Next process env (we set this in the
// spawn() block below). The /signin page is a server component that
// renders the SignInForm client component; it submits to a Server Action
// (POST to the same page URL) that wraps Auth.js signIn() and redirects
// on success. After this returns, the page context holds a valid session
// cookie, so subsequent goto() calls land on the real page instead of
// redirecting to /signin.
async function signInAsTestUser(page) {
  await page.goto(`${appUrl}/signin`);
  await page.locator('input[name="email"]').fill("acceptance@textlab.test");
  await page.locator('input[name="name"]').fill("Acceptance Tester");
  // Custom page renders a single "Sign in" submit button (vs the Auth.js
  // default page's "Sign in with Dev login" per-provider label).
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/signin")),
    page.getByRole("button", { name: /^Sign in$/ }).click()
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

    // Use the canonical passage URL rather than bare `/read`. Saving a note calls
    // router.refresh(); on bare `/read` that refresh re-runs the server component,
    // which now sees the last-passage cookie ReaderLocationMemo just set and
    // redirect()s to `/read?book=John&chapter=1`. That navigation remounts
    // BibleReader and resets its note-status state, so "Note saved." never renders
    // to assert against. The canonical URL keeps refresh in place (no redirect),
    // which is also how the app behaves once a saved passage exists.
    await page.goto(`${appUrl}/read?book=John&chapter=1`);
    assert((await page.title()).includes("TextLab Bible"), "page title did not match");
    // Masthead is an <h1> reading "{book} {chapter}" (ReaderMasthead) — there is
    // no "Reader" heading. Verse references are no longer headings since Phase C;
    // each verse is an <article aria-label="{reference}">.
    await page.getByRole("heading", { level: 1, name: "John" }).waitFor();
    await page.getByRole("article", { name: "John 1:1", exact: true }).waitFor();
    await screenshot("01-read");

    await page.getByRole("button", { name: "λόγος" }).first().click();
    await page.getByText("Morphology", { exact: true }).waitFor();
    await page.getByText("N-NSM").waitFor();
    result.interactions.push("Clicked λόγος token and saw morphology N-NSM popover.");
    await screenshot("02-popover");

    // Highlighting is optimistic since Phase B2 — the UI surfaces only failures,
    // no "Highlight saved." text. Clicking "Highlight" applies the current/default
    // color; assert persistence via the /api/highlights POST (returns 201) instead.
    const [highlightResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/highlights") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Highlight", exact: true }).click()
    ]);
    assert(highlightResponse.ok(), `highlight POST did not succeed (status ${highlightResponse.status()})`);
    result.interactions.push("Highlighted λόγος token; highlight POST persisted (2xx).");
    await page.getByRole("button", { name: "Close" }).click();

    // Per-verse notes are collapsed behind a toggle whose accessible name is
    // "Notes on {reference}" (count-independent, so re-runs stay idempotent even
    // once the toggle reads "Notes (N)"). Expand it before the add-note form's
    // "Write a note" textarea exists.
    const john11Article = page.getByRole("article", { name: "John 1:1", exact: true });
    await john11Article.getByRole("button", { name: /notes on john 1:1/i }).click();
    await john11Article.getByPlaceholder("Write a note", { exact: true }).fill("QA acceptance note on John 1:1");
    await john11Article.getByRole("button", { name: "Save note" }).click();
    await page.getByText("Note saved.").waitFor();
    result.interactions.push("Saved a verse note and saw Note saved.");

    await page.getByRole("button", { name: "λόγος" }).first().click();
    await page.getByRole("link", { name: "Search lemma" }).click();
    await page.waitForURL(/\/search/);
    await page.getByText('40 results for lemma "λόγος" in John').waitFor();
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
    // Deterministic fallback (grounded-core shape): header "Grounded evidence TextLab
    // retrieved for …" followed by lemma hit rows. The retrieval planner scopes
    // "λόγος in John 1" to the named chapter, so the search returns the 4
    // chapter-1 occurrences (three in 1:1, one in 1:14) — not the 40 across the
    // whole book — and 1:14 ("the Word became flesh") is now surfaced.
    const answerPre = page.locator("pre").filter({ hasText: "Grounded evidence TextLab retrieved" });
    await answerPre.waitFor({ timeout: 30000 });
    await answerPre.filter({ hasText: "4 hit(s)" }).waitFor();
    await answerPre.filter({ hasText: "John 1:14" }).waitFor();
    await page.getByText("Local fallback").waitFor();
    // Live synthesis is disabled here, so no routing runs and no model is called: the
    // answer honestly reports modelUsed "none", rendered as the "role — model" label
    // (AiAssistant.tsx: `{modelRole} — {modelUsed}`), i.e. "default — none" — NOT the
    // default model name. Match the exact em-dash separator (not a loose `\S+`) so a
    // formatting regression in that label is still caught.
    await page.getByText(/default\s+—\s+none/).waitFor();
    await page.getByText('searchLemma({"lemma":"λόγος","book":"John","chapter":1})').waitFor();
    await page.getByText("John 1:1, SBLGNT").first().waitFor();
    // Live mode is disabled in acceptance, so this answer comes from the
    // deterministic fallback (grounded by construction) — assert the withheld
    // banner is absent on that path. The live grounding verifier's refusal logic
    // is covered deterministically by the unit/component tests, not here.
    const withheldCount = await page.getByText("Withheld — insufficient evidence").count();
    assert(withheldCount === 0, "deterministic fallback answer showed the grounding-withheld banner");
    result.interactions.push("Deterministic fallback answer was not flagged as withheld.");
    await page.getByRole("button", { name: "Save generated note" }).click();
    await page.getByText("Generated note saved.").waitFor();
    await page.getByText("Show me every use of λόγος in John 1").first().waitFor();
    result.interactions.push("Saved the assistant answer as generated study-note history.");

    const markdownValue = await page.locator("textarea[readonly]").inputValue();
    assert(markdownValue.includes("# TextLab Assistant"), "markdown export text area did not include the assistant title");
    result.interactions.push("Assistant returned retrieval-first answer, trace, citations, and Markdown content.");
    await screenshot("04-assistant-answer");

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export Markdown" }).click();
    const download = await downloadPromise;
    const downloadPath = path.join(screenshotsDir, "textlab-study-note.md");
    await download.saveAs(downloadPath);
    const markdown = await fs.readFile(downloadPath, "utf8");
    assert(markdown.includes("# TextLab Assistant"), "downloaded markdown missing title");
    assert(markdown.includes("John 1:1, SBLGNT"), "downloaded markdown missing citation");
    result.interactions.push("Export Markdown downloaded a study note with title and citation.");

    const notesResponse = await page.request.get(`${appUrl}/api/notes`);
    const notesJson = await notesResponse.json();
    assert(
      notesJson.notes.some((note) => note.body === "QA acceptance note on John 1:1"),
      "saved note was not returned by notes API"
    );
    result.interactions.push("Saved note persisted and was returned by /api/notes.");

    // Phase 4a semantic path, issued LAST so it cannot race the λόγος export above.
    // Await the topical prompt's OWN /api/assistant response — not a stale
    // "Grounded evidence TextLab retrieved" left rendered from the λόγος answer — so this proves the
    // request actually executed the planner (incl. the gated semantic call). When
    // OPENAI_API_KEY is unset the planner gracefully no-ops to deterministic retrieval,
    // but the route still returns 200, so the check holds in both modes.
    await page.locator("textarea").first().fill("What does the New Testament teach about reconciliation?");
    const [topicalResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/assistant") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Ask assistant" }).click()
    ]);
    assert(topicalResponse.status() === 200, "topical assistant request did not return HTTP 200");
    result.interactions.push("Topical prompt (Phase 4a semantic path) completed with a 200 response.");

    result.finalUrl = page.url();
    result.title = await page.title();

    await context.close();

    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mobilePage = await mobileContext.newPage();
    // Mobile context is fresh — needs its own session. Bare `/read` is fine here
    // (unlike the desktop flow): no last-passage cookie yet, so no saved-passage
    // redirect, and this path saves no note, so there is no router.refresh() remount.
    await signInAsTestUser(mobilePage);
    await mobilePage.goto(`${appUrl}/read`);
    await mobilePage.getByRole("heading", { level: 1, name: "John" }).waitFor();
    await mobilePage.getByRole("article", { name: "John 1:1", exact: true }).waitFor();
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
          (message.includes('caret-color:"transparent"') || message.includes("style={{}}"))) &&
        // Tolerate Chrome's preload-timing heuristic for Next dev assets — under
        // dev-server compile latency, CSS is consumed later than Chrome's "few
        // seconds" window. Reproduces on unmodified main; not an app bug.
        !(message.includes("preloaded using link preload") && message.includes("_next/static/"))
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
