"use client";

import { useEffect } from "react";

/**
 * The crash screen an advisor may be looking at with a client watching.
 *
 * Two deliberate choices:
 *  - Styles are inline, not from globals.css. If the stylesheet is what failed, a class-based
 *    fallback renders as unstyled wreckage on a shared screen.
 *  - No stack trace, no error message, no digest is shown. A client should never see internals,
 *    and an advisor cannot act on them mid-call. The detail goes to the console for later.
 */
export default function EngagementError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Advisor cockpit crashed:", error);
  }, [error]);

  return (
    <main style={styles.page}>
      <div style={styles.card}>
        <p style={styles.eyebrow}>Something went wrong on this screen</p>
        <h1 style={styles.heading}>Nothing has been lost.</h1>
        <p style={styles.body}>
          Every approved document, transcript and evidence quote is already saved against this
          engagement. This screen stopped rendering — the record behind it did not change.
        </p>
        <p style={styles.body}>
          If a client is watching, it is worth saying plainly that a screen needs reloading. Then
          try again, or go back to the engagement list and reopen the engagement.
        </p>
        <div style={styles.actions}>
          <button onClick={reset} style={styles.primary} type="button">
            Try this screen again
          </button>
          {/*
            A plain anchor, not next/link, on purpose. `reset()` above is the soft retry; this is
            the escape hatch for when the client-side router is itself part of what broke, so it
            has to be a full document load rather than a client-side navigation.
          */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" style={styles.secondary}>
            Back to engagements
          </a>
        </div>
        <p style={styles.footnote}>
          The technical detail is in the browser console for whoever picks this up later.
        </p>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "32px",
    background: "#f4f3ee",
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
  card: {
    maxWidth: "560px",
    background: "#ffffff",
    border: "1px solid #d8d6cc",
    borderRadius: "18px",
    padding: "40px",
  },
  eyebrow: {
    margin: "0 0 12px",
    fontSize: "12px",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "#6b6a63",
  },
  heading: { margin: "0 0 20px", fontSize: "32px", lineHeight: 1.15, color: "#16281f" },
  body: { margin: "0 0 16px", fontSize: "16px", lineHeight: 1.6, color: "#3a3a35" },
  actions: { display: "flex", gap: "12px", flexWrap: "wrap", margin: "28px 0 20px" },
  primary: {
    padding: "12px 20px",
    borderRadius: "10px",
    border: "none",
    background: "#16281f",
    color: "#ffffff",
    fontSize: "15px",
    cursor: "pointer",
  },
  secondary: {
    padding: "12px 20px",
    borderRadius: "10px",
    border: "1px solid #d8d6cc",
    background: "#ffffff",
    color: "#16281f",
    fontSize: "15px",
    textDecoration: "none",
  },
  footnote: { margin: 0, fontSize: "13px", color: "#6b6a63" },
};
