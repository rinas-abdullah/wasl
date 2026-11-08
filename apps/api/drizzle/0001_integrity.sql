-- Integrity guarantees that cannot be expressed in the Drizzle schema DSL.

CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

-- 1) No two ACTIVE reservations may overlap on the same resource.
--    This is what makes concurrent releases safe: the second transaction fails
--    with SQLSTATE 23P01 (exclusion_violation) and the API returns 409.
ALTER TABLE "resource_reservations"
  ADD CONSTRAINT "reservations_no_overlap"
  EXCLUDE USING gist (
    "resource_type" WITH =,
    "resource_id" WITH =,
    tstzrange("start_at", "end_at", '[)') WITH &&
  ) WHERE ("status" = 'ACTIVE');
--> statement-breakpoint

ALTER TABLE "resource_reservations" ADD CONSTRAINT "reservations_valid_range" CHECK ("end_at" > "start_at");
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_duration_positive" CHECK ("duration_min" > 0);
--> statement-breakpoint
ALTER TABLE "trucks" ADD CONSTRAINT "trucks_service_estimate_positive" CHECK ("service_estimate_min" > 0);
--> statement-breakpoint

-- 2) Audit log is append-only. UPDATE and DELETE are rejected unless the
--    session explicitly sets wasl.audit_purge = 'demo' (used ONLY by the demo
--    reset routine, which deletes rows of the demo organisation).
CREATE OR REPLACE FUNCTION audit_events_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('wasl.audit_purge', true) = 'demo' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_events is append-only (% blocked)', TG_OP USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON "audit_events" FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();
--> statement-breakpoint
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON "audit_events" FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();
