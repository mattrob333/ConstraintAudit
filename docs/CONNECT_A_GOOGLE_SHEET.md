# Connect your own Google Sheet as the CRM

The Tier 4 Advisor Cockpit can write each engagement's status back to a Google Sheet you
own — your CRM. You bring the sheet; the app fills it in. This takes about five minutes and
you only do it once.

Everything here is also available in the app under **Settings → My connections → Connect
your CRM**, which does the same steps with a "Test connection" button at the end.

---

## Before you start

Someone needs to have set up the app's Google connection (the `GOOGLE_*` secrets in
`docs/DEPLOYMENT.md`). If that isn't done, the CRM write-back stops at a reviewed intent and
never reaches your sheet. Settings → API keys shows whether Google is connected.

The app writes through **one shared Google identity** (the account whose refresh token is
configured). That is the account you share your sheet with in step 3. Per-advisor Google
sign-in is planned but not built yet, so for now every advisor's write-back goes through that
one identity — which is why you explicitly share the sheet with it.

---

## Step 1 — download the template

In the app: **Settings → Connect your CRM → Download CRM template**. It saves
`tier4-crm-template.csv`.

The template's first row is the exact set of columns the app writes. **Do not rename or
delete these columns** — the app matches on the header text (case-insensitive) and reports
any column it could not find rather than writing to the wrong one. You may add your own extra
columns to the right; the app leaves them untouched.

The columns are:

`Engagement ID`, `Client`, `Website`, `Primary Contact`, `Email`, `Advisor`, `Stage`,
`Status`, `Next Action`, `Due Date`, `Last Contact`, `Call 1`, `Call 2`,
`Readiness Brief status`, `Baseline status`, `Engagement Folder`, `Notes`.

`Engagement ID` is the match key: the app updates the row whose `Engagement ID` matches and
appends a new row when it doesn't, so an engagement never duplicates.

---

## Step 2 — import it into Google Sheets

1. In Google Drive, **New → Google Sheets → blank spreadsheet**.
2. **File → Import → Upload**, choose `tier4-crm-template.csv`.
3. Import location: **Replace current sheet**. Separator: comma. Click **Import data**.
4. Rename the tab (the little sheet name at the bottom) to **`Engagements`** — or note whatever
   name you give it, because you'll enter it in the app in step 4.

The sample row in the template is obviously fake ("SAMPLE — delete this row"). Delete it once
you've confirmed the columns imported correctly.

---

## Step 3 — share the sheet with the app's Google account

The app can only write to a sheet it has access to.

1. Click **Share** (top right of your sheet).
2. Add the app's Google account address — the account behind the configured `GOOGLE_*`
   connection. Whoever set up deployment knows this address; if you're not sure, ask them.
3. Give it **Editor** access (it needs to write rows). Uncheck "Notify people" if you like.
4. Click **Share**.

If you skip this, "Test connection" in the next step will report that the app cannot open the
sheet.

---

## Step 4 — connect it in the app

1. Copy your sheet's URL from the browser address bar. It looks like
   `https://docs.google.com/spreadsheets/d/1AbC...XyZ/edit#gid=0`.
2. In the app: **Settings → Connect your CRM**, paste the whole URL into the sheet field (the
   app pulls the id out of it — you don't need to extract it yourself).
3. Set the tab name to match what you named it in step 2 (default `Engagements`).
4. Click **Save**, then **Test connection**.

A good result reads something like *"Reached the 'Engagements' tab; 17 of 17 expected columns
matched."* If it reports a missing tab, re-check the tab name; if it reports columns not found,
re-check that row 1 still has the template headers; if it can't open the sheet at all, re-check
the share in step 3.

---

## How the write-back actually runs

Connecting the sheet does not, by itself, send anything. When you choose **Prepare CRM
write-back** on an engagement, the app creates a *reviewed intent* — a proposed write you can
see in full first. It only touches your sheet when you **approve** and then **execute** that
intent from the Reviewed actions panel. Nothing is written to your CRM automatically, and the
same engagement updates its own row rather than piling up duplicates.
