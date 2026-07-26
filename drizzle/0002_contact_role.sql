-- The primary contact's role was previously concatenated into free-text notes, so the
-- named owner required at diagnosis approval had to be re-entered by hand. The store
-- adds this column through its PRAGMA-guarded reconcile path, so this file is a no-op
-- against a database the application has already booted.
ALTER TABLE engagements ADD COLUMN primary_contact_role TEXT NOT NULL DEFAULT '';
