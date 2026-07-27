import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("build contains the Tier 4 audit entry point", async () => {
  const [cockpit, layout] = await Promise.all([
    readFile(new URL("../app/components/AdvisorCockpit.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    access(new URL("../dist/server/index.js", import.meta.url)),
  ]);

  assert.match(layout, /title:\s*"Tier 4 Advisor Cockpit"/);
  assert.match(cockpit, /Fresh engagement/);
  assert.match(cockpit, /External migration/);
  assert.match(cockpit, /Update an engagement/);
  assert.match(cockpit, /Deterministic local mode is ready/);
  assert.doesNotMatch(cockpit, /SkeletonPreview|Your site is taking shape|react-loading-skeleton/);
});

test("the crash screen never shows a client the internals", async () => {
  const crash = await readFile(new URL("../app/error.tsx", import.meta.url), "utf8");
  const rendered = crash.slice(crash.indexOf("return ("));
  // An advisor may be screen-sharing when a render fails. A stack trace, an exception message
  // or a digest on that screen is both alarming to a client and useless to the advisor.
  for (const leak of ["error.message", "error.digest", "error.stack", "{error}", "String(error)"]) {
    assert.equal(rendered.includes(leak), false, `crash screen renders ${leak} to the client`);
  }
  assert.match(crash, /console\.error/);
  // Styles must not depend on the stylesheet that may itself be what failed.
  assert.doesNotMatch(rendered, /className=/);
  assert.match(crash, /reset\(\)|onClick=\{reset\}/);
});

test("keeps frontend workflow gates and accessibility in the owned client surface", async () => {
  const [page, layout, cockpit, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/AdvisorCockpit.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<AdvisorCockpit \/>/);
  assert.match(layout, /title:\s*"Tier 4 Advisor Cockpit"/);
  assert.match(cockpit, /api<\{ engagements: BackendEngagement\[\] \}>\("\/api\/engagements"\)/);
  assert.doesNotMatch(cockpit, /fallbackEngagements|local-\$\{Date\.now/);
  assert.match(cockpit, /Action not completed:/);
  assert.match(cockpit, /normalizeWebsiteInput/);
  assert.match(cockpit, /inputMode="url"/);
  assert.doesNotMatch(cockpit, /type="url"/);
  assert.match(cockpit, /"pending" \| "recorded" \| "not-recorded"/);
  assert.match(cockpit, /Continue without recording/);
  assert.match(cockpit, /Approve send intent/);
  assert.match(cockpit, /aria-controls="primary-navigation"/);
  assert.match(cockpit, /aria-haspopup="menu"/);
  assert.match(cockpit, /aria-modal="true"/);
  assert.match(cockpit, /aria-label="Business Model Canvas"/);
  assert.match(cockpit, /canvas-\$\{area\}/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\.consent-status\.not-recorded/);
  assert.match(css, /"partners partners activities activities value value relationships relationships segments segments"/);
  assert.match(css, /"cost cost cost cost cost revenue revenue revenue revenue revenue"/);
});
