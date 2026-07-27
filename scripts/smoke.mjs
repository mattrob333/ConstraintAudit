#!/usr/bin/env node
/**
 * Post-deploy smoke test for the Tier 4 Advisor Cockpit.
 *
 *   node scripts/smoke.mjs https://cockpit.example.com
 *
 * Run this against a real deployment, from a machine that is *not* signed in to it. It answers four
 * questions, in order, in plain language:
 *
 *   1. Is the app up and can it reach its database?          (GET /api/health)
 *   2. Does the site itself load?                            (GET /)
 *   3. Does it require a login before handing out client data? (GET /api/engagements, no credentials)
 *   4. Is the integrations endpoint reachable?               (GET /api/integrations)
 *
 * Check 3 is the important one. This app has no login screen of its own — the login belongs to
 * Cloudflare Access, in front of it. If Access is missing, the app does not break; it quietly treats
 * every visitor on the internet as the same advisor, with read and write access to every
 * engagement. This script exists mostly to catch that.
 *
 * Zero dependencies. Plain Node 22, global fetch. Exits non-zero if any check fails.
 */

const DEFAULT_TIMEOUT_MS = 15_000;
/** Cloudflare Access hosts its sign-in page here; landing on it means Access is in front. */
const ACCESS_LOGIN_HOST_SUFFIX = ".cloudflareaccess.com";
const MAX_BODY_SNIPPET = 200;

/* ------------------------------------------------------------------ arguments */

function usage() {
  return [
    "Usage: node scripts/smoke.mjs <deployment-url> [--timeout <seconds>]",
    "",
    "Example: node scripts/smoke.mjs https://cockpit.example.com",
  ].join("\n");
}

function parseArgs(argv) {
  let target = "";
  let timeoutMs = DEFAULT_TIMEOUT_MS;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--timeout") {
      const seconds = Number(argv[i + 1]);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        return { error: "--timeout needs a number of seconds, for example --timeout 30" };
      }
      timeoutMs = Math.round(seconds * 1000);
      i += 1;
      continue;
    }
    if (arg.startsWith("-")) return { error: `Unknown option: ${arg}` };
    if (target) return { error: "Give exactly one deployment URL." };
    target = arg;
  }

  if (!target) return { error: "No deployment URL given." };

  // Accept "cockpit.example.com" as well as a full URL; https is the only sensible default.
  const withScheme = /^https?:\/\//i.test(target) ? target : `https://${target}`;
  let base;
  try {
    base = new URL(withScheme);
  } catch {
    return { error: `That does not look like a URL: ${target}` };
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    return { error: `Only http and https URLs are supported (got ${base.protocol}).` };
  }

  return { base: base.origin + base.pathname.replace(/\/+$/, ""), timeoutMs };
}

/* ------------------------------------------------------------------- fetching */

/**
 * Digs the useful error code out of a fetch failure. Undici wraps the real cause one level down,
 * and when a hostname has several addresses it wraps an AggregateError of one cause per address.
 */
function networkErrorCode(error) {
  const cause = error?.cause;
  if (Array.isArray(cause?.errors)) {
    const inner = cause.errors.find((item) => item?.code);
    if (inner) return inner.code;
  }
  return cause?.code ?? error?.code ?? "";
}

/** Turns a thrown fetch error into a sentence a non-developer can act on. */
function describeNetworkError(error, timeoutMs) {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") {
    return `no response within ${Math.round(timeoutMs / 1000)} seconds (the server may be down or very slow)`;
  }
  const code = networkErrorCode(error);
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return "that hostname does not resolve (check the URL for a typo)";
  }
  if (code === "ECONNREFUSED") return "the server refused the connection";
  if (code === "ECONNRESET") return "the connection was closed unexpectedly";
  if (code === "CERT_HAS_EXPIRED") return "the site's TLS certificate has expired";
  if (String(code).startsWith("ERR_TLS") || String(code).includes("CERT")) {
    return `the TLS certificate could not be verified (${code})`;
  }
  // `error.message` is always the useless "fetch failed"; the cause carries the real reason.
  const detail = error?.cause?.message || error?.message;
  return detail ? `request failed (${detail})` : "request failed";
}

/**
 * One HTTP GET. Never throws — every outcome is returned as a plain object, so a wrong URL or a
 * timeout produces a readable failure line instead of a stack trace.
 */
async function get(url, { timeoutMs, accept }) {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: accept ? { accept } : {},
      signal: AbortSignal.timeout(timeoutMs),
    });

    const contentType = response.headers.get("content-type") ?? "";
    let text = "";
    try {
      text = await response.text();
    } catch {
      text = "";
    }

    let json = null;
    if (contentType.includes("json")) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }

    let finalHost = "";
    try {
      finalHost = new URL(response.url || url).host;
    } catch {
      finalHost = "";
    }

    return {
      networkError: null,
      status: response.status,
      contentType,
      text,
      json,
      finalUrl: response.url || url,
      // True when Cloudflare Access bounced us to its own sign-in page.
      viaAccessLogin: finalHost.endsWith(ACCESS_LOGIN_HOST_SUFFIX),
    };
  } catch (error) {
    return { networkError: describeNetworkError(error, timeoutMs), status: 0 };
  }
}

function snippet(text) {
  if (!text) return "";
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_BODY_SNIPPET ? `${flat.slice(0, MAX_BODY_SNIPPET)}...` : flat;
}

/** Explains an unexpected body without dumping HTML at the reader. */
function describeUnexpectedBody(result) {
  if (result.contentType.includes("html")) return "the server returned a web page, not data";
  if (!result.contentType) return "the server returned no content type";
  return `the server returned ${result.contentType.split(";")[0]}, not JSON`;
}

/* -------------------------------------------------------------------- results */

const results = [];

function record(severity, title, lines) {
  const detail = (Array.isArray(lines) ? lines : [lines]).filter(Boolean);
  results.push({ severity, title, detail });
  const label = severity === "pass" ? "PASS" : severity === "warn" ? "WARN" : "FAIL";
  console.log(`[${label}] ${title}`);
  for (const line of detail) console.log(`       ${line}`);
}

/* --------------------------------------------------------------------- checks */

/** 1. Health: is the Worker up, and can it reach D1? Also tells us the auth mode it thinks it is in. */
async function checkHealth(base, timeoutMs) {
  const url = `${base}/api/health`;
  const result = await get(url, { timeoutMs, accept: "application/json" });

  if (result.networkError) {
    record("fail", "Health check (/api/health)", [`Could not reach ${url}: ${result.networkError}.`]);
    return { authMode: null, reachedApp: false };
  }

  if (result.viaAccessLogin) {
    // /api/health is meant to answer without credentials; behind an Access policy covering the
    // whole hostname it cannot. Not a failure of the app, but the monitor needs to know.
    record("warn", "Health check (/api/health)", [
      "Cloudflare Access intercepted this request and returned its sign-in page.",
      "The app is protected, but an uptime monitor cannot read the health endpoint from outside.",
      "To monitor it, add an Access bypass policy for the path /api/health.",
    ]);
    return { authMode: null, reachedApp: false, behindAccess: true };
  }

  if (result.status === 404) {
    record("fail", "Health check (/api/health)", [
      "The deployment returned 404 — it does not have a health endpoint.",
      "This build is probably older than the deployed code you expected. Redeploy and try again.",
    ]);
    return { authMode: null, reachedApp: true };
  }

  if (!result.json) {
    record("fail", "Health check (/api/health)", [
      `HTTP ${result.status}, but ${describeUnexpectedBody(result)}.`,
      "Check that the URL points at the cockpit deployment and not at another site.",
      snippet(result.text) ? `Response began: ${snippet(result.text)}` : "",
    ]);
    return { authMode: null, reachedApp: true };
  }

  const body = result.json;
  const dbReachable = body?.database?.reachable === true;
  const authMode = typeof body?.auth?.mode === "string" ? body.auth.mode : null;
  const healthy = body?.ok === true && dbReachable && result.status === 200;

  if (healthy) {
    record("pass", "Health check (/api/health)", [
      "The app is up and its database is reachable.",
      authMode ? `It reports its login mode as: ${authMode}` : "",
    ]);
  } else if (!dbReachable) {
    record("fail", "Health check (/api/health)", [
      `HTTP ${result.status}. The app is running but cannot reach its database.`,
      "Check the D1 binding in wrangler.jsonc (env.production -> d1_databases) and that the",
      "database id is the real one, not the generated placeholder. See docs/DEPLOYMENT.md Step 1.",
    ]);
  } else {
    record("fail", "Health check (/api/health)", [
      `HTTP ${result.status}. The app reported that it is not healthy.`,
    ]);
  }

  return { authMode, reachedApp: true };
}

/** 2. The site itself loads. */
async function checkRootPage(base, timeoutMs) {
  const result = await get(`${base}/`, { timeoutMs, accept: "text/html" });

  if (result.networkError) {
    record("fail", "Home page loads (/)", [`Could not reach ${base}/: ${result.networkError}.`]);
    return;
  }

  if (result.viaAccessLogin) {
    record("pass", "Home page loads (/)", [
      "Cloudflare Access showed its sign-in page instead of the app.",
      "That is the correct behaviour for a visitor who is not signed in.",
    ]);
    return;
  }

  if (result.status === 200 && result.contentType.includes("html")) {
    record("pass", "Home page loads (/)", ["HTTP 200 and the page is HTML."]);
    return;
  }

  record("fail", "Home page loads (/)", [
    `HTTP ${result.status}${result.contentType ? ` (${result.contentType.split(";")[0]})` : ""}.`,
    "Expected an HTML page. If the status is 500, check `npx wrangler tail` for the error.",
  ]);
}

/**
 * 3. The check that matters: an anonymous request must not be handed a list of engagements.
 *
 * Read together with the auth mode from /api/health, this separates three very different states
 * that all look identical from a browser you happen to be signed in to.
 */
async function checkEngagementsRequireAuth(base, timeoutMs, authMode) {
  const title = "Client data requires a login (/api/engagements)";
  const result = await get(`${base}/api/engagements`, { timeoutMs, accept: "application/json" });

  if (result.networkError) {
    record("fail", title, [`Could not reach the endpoint: ${result.networkError}.`]);
    return { wideOpen: false };
  }

  if (result.viaAccessLogin) {
    record("pass", title, [
      "Cloudflare Access stopped the request before it reached the app and asked for a sign-in.",
      "This is the strongest possible result: unauthenticated visitors never touch client data.",
    ]);
    return { wideOpen: false };
  }

  if (result.status === 401 || result.status === 403) {
    const note =
      authMode === "denied"
        ? "Warning: the app reports login mode 'denied', which means nobody can sign in either. " +
          "Exactly one of CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD is set. Set both, or unset both."
        : authMode === "local-fallback"
          ? "Unexpected: the app reports login mode 'local-fallback', which normally lets anyone in. " +
            "Something else is refusing the request — confirm you are testing the right deployment."
          : "";
    record(note ? "warn" : "pass", title, [
      `HTTP ${result.status}. The app refused an anonymous request, as it should.`,
      note,
    ]);
    return { wideOpen: false };
  }

  const returnedList = Array.isArray(result.json?.engagements);
  if (result.status === 200 && returnedList) {
    // The failure this whole script exists to catch.
    const count = result.json.engagements.length;
    record("fail", title, [
      "ANYONE WITH THIS URL CAN READ YOUR CLIENT DATA.",
      `An anonymous request returned a list of engagements (${count} record${count === 1 ? "" : "s"}).`,
      authMode === "local-fallback"
        ? "The app reports login mode 'local-fallback': every visitor is treated as the same single"
        : `The app reports login mode '${authMode ?? "unknown"}', yet the data came back anyway —`,
      authMode === "local-fallback"
        ? "advisor and can read, edit and export every engagement in the database."
        : "something is reaching the Worker without passing through Access (a workers.dev URL, perhaps).",
      "Fix: follow Step 6 of docs/DEPLOYMENT.md (Cloudflare Access + REQUIRE_ADVISOR_AUTH=1),",
      "set \"workers_dev\": false, and remove any real client data until this check passes.",
    ]);
    return { wideOpen: true };
  }

  if (result.status === 200) {
    record("warn", title, [
      `HTTP 200, but ${describeUnexpectedBody(result)}.`,
      "The request was not refused. Verify by hand what this endpoint returns to a stranger.",
      snippet(result.text) ? `Response began: ${snippet(result.text)}` : "",
    ]);
    return { wideOpen: false };
  }

  record("warn", title, [
    `HTTP ${result.status} — neither a refusal nor a list of engagements.`,
    "No client data leaked, but this is not the expected 401. Check `npx wrangler tail`.",
  ]);
  return { wideOpen: false };
}

/** 4. Integrations endpoint is alive, and reports configuration when our credentials allow it. */
async function checkIntegrations(base, timeoutMs) {
  const title = "Integrations endpoint (/api/integrations)";
  const result = await get(`${base}/api/integrations`, { timeoutMs, accept: "application/json" });

  if (result.networkError) {
    record("fail", title, [`Could not reach the endpoint: ${result.networkError}.`]);
    return;
  }

  if (result.viaAccessLogin || result.status === 401 || result.status === 403) {
    record("pass", title, [
      "Reachable, and it correctly refuses to describe the deployment to an anonymous visitor.",
      "Sign in and open /api/integrations in a browser to see which integrations are configured.",
    ]);
    return;
  }

  if (result.status === 200 && Array.isArray(result.json?.integrations)) {
    const list = result.json.integrations;
    const configured = list
      .filter((item) => item?.status === "configured" || item?.status === "connected" || item?.status === "ready")
      .map((item) => item?.name ?? item?.id)
      .filter(Boolean);
    record("pass", title, [
      `Reachable. ${list.length} integrations reported.`,
      configured.length
        ? `Configured and ready: ${configured.join(", ")}.`
        : "None are configured yet — the core workflow runs without them.",
      "Note: this returned data without a login, which is consistent with the warning above.",
    ]);
    return;
  }

  record("fail", title, [
    `HTTP ${result.status}${result.json ? "" : ` — ${describeUnexpectedBody(result)}`}.`,
    "Expected either a list of integrations or a 401.",
  ]);
}

/* ----------------------------------------------------------------------- main */

function printSummary(base, wideOpen, authMode) {
  const failed = results.filter((r) => r.severity === "fail");
  const warned = results.filter((r) => r.severity === "warn");
  const passed = results.filter((r) => r.severity === "pass");

  console.log("");
  console.log("-".repeat(72));
  console.log(`Summary for ${base}`);
  console.log(`  ${passed.length} passed, ${warned.length} warning(s), ${failed.length} failed`);
  console.log("");

  if (wideOpen) {
    console.log("!!  THIS DEPLOYMENT IS OPEN TO THE PUBLIC  !!");
    console.log("");
    console.log("  An anonymous request was handed a list of engagements. Anyone who learns this");
    console.log("  URL can read, change and export every client record in it.");
    console.log("");
    console.log("  Do not put real client data in this deployment until Step 6 of");
    console.log("  docs/DEPLOYMENT.md (Cloudflare Access) is finished and this check passes.");
  } else if (failed.length) {
    console.log("  Something is wrong with this deployment. See the FAIL lines above.");
  } else if (warned.length) {
    console.log("  Working, with points to look at. See the WARN lines above.");
  } else {
    console.log("  All checks passed. The app is up, its database is reachable, and an");
    console.log("  anonymous visitor cannot read client data.");
  }

  if (authMode === "local-fallback" && !wideOpen) {
    console.log("");
    console.log("  Note: the app reports login mode 'local-fallback'. If this deployment is");
    console.log("  reachable from the public internet, set up Cloudflare Access and");
    console.log("  REQUIRE_ADVISOR_AUTH=1 before using it for real work.");
  }

  console.log("-".repeat(72));
  return failed.length === 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return 0;
  }
  if (args.error) {
    console.error(args.error);
    console.error("");
    console.error(usage());
    return 2;
  }

  const { base, timeoutMs } = args;
  console.log("Tier 4 Advisor Cockpit — smoke test");
  console.log(`Target: ${base}`);
  console.log(`Timeout: ${Math.round(timeoutMs / 1000)}s per request`);
  console.log("");

  const health = await checkHealth(base, timeoutMs);
  await checkRootPage(base, timeoutMs);
  const auth = await checkEngagementsRequireAuth(base, timeoutMs, health.authMode);
  await checkIntegrations(base, timeoutMs);

  return printSummary(base, auth.wideOpen, health.authMode) ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    // Last-resort guard: the checks above are meant to handle their own failures.
    console.error(`Smoke test could not run: ${error?.message ?? error}`);
    process.exitCode = 2;
  });
