-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('STAFF', 'INSTRUCTOR');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('BOOKED', 'WAITLISTED', 'CANCELLED', 'ATTENDED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "BookingEventType" AS ENUM ('CREATED', 'STATUS_CHANGED', 'NOTE_ADDED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "membership_expires_on" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "discipline" TEXT NOT NULL,
    "default_duration_minutes" INTEGER NOT NULL,
    "default_capacity" INTEGER NOT NULL,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "class_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "booked_count" INTEGER NOT NULL DEFAULT 0,
    "primary_instructor_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_instructors" (
    "session_id" UUID NOT NULL,
    "instructor_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_instructors_pkey" PRIMARY KEY ("session_id","instructor_id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "seq" SERIAL NOT NULL,
    "session_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "status" "BookingStatus" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "seq" SERIAL NOT NULL,
    "booking_id" UUID NOT NULL,
    "type" "BookingEventType" NOT NULL,
    "from_status" "BookingStatus",
    "to_status" "BookingStatus",
    "note" TEXT,
    "actor_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_alert_dismissals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "member_id" UUID NOT NULL,
    "membership_expires_on" DATE NOT NULL,
    "dismissed_by_id" UUID NOT NULL,
    "dismissed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_alert_dismissals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "members_membership_expires_on_idx" ON "members"("membership_expires_on");

-- CreateIndex
CREATE INDEX "class_sessions_class_id_starts_at_idx" ON "class_sessions"("class_id", "starts_at");

-- CreateIndex
CREATE INDEX "class_sessions_primary_instructor_id_starts_at_idx" ON "class_sessions"("primary_instructor_id", "starts_at");

-- CreateIndex
CREATE INDEX "class_sessions_starts_at_idx" ON "class_sessions"("starts_at");

-- CreateIndex
CREATE INDEX "session_instructors_instructor_id_idx" ON "session_instructors"("instructor_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_seq_key" ON "bookings"("seq");

-- CreateIndex
CREATE INDEX "bookings_session_id_status_seq_idx" ON "bookings"("session_id", "status", "seq");

-- CreateIndex
CREATE INDEX "bookings_member_id_idx" ON "bookings"("member_id");

-- CreateIndex
CREATE INDEX "bookings_status_created_at_idx" ON "bookings"("status", "created_at");

-- CreateIndex
CREATE INDEX "bookings_created_at_idx" ON "bookings"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "booking_events_seq_key" ON "booking_events"("seq");

-- CreateIndex
CREATE INDEX "booking_events_booking_id_seq_idx" ON "booking_events"("booking_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "membership_alert_dismissals_member_id_membership_expires_on_key" ON "membership_alert_dismissals"("member_id", "membership_expires_on");

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_primary_instructor_id_fkey" FOREIGN KEY ("primary_instructor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_instructors" ADD CONSTRAINT "session_instructors_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "class_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_instructors" ADD CONSTRAINT "session_instructors_instructor_id_fkey" FOREIGN KEY ("instructor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "class_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_alert_dismissals" ADD CONSTRAINT "membership_alert_dismissals_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_alert_dismissals" ADD CONSTRAINT "membership_alert_dismissals_dismissed_by_id_fkey" FOREIGN KEY ("dismissed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Hand-written section — invariants the Prisma DSL cannot express.
-- Inventory and rationale: docs/schema.md. Each constraint is integration-
-- tested in tests/integration/constraints.test.ts; if a future generated
-- migration ever drops one of these, that suite fails in CI.
-- ============================================================================

-- btree_gist lets a GiST exclusion constraint mix equality (uuid) with
-- range overlap (&&).
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- ---------------------------------------------------------------------------
-- Case-insensitive uniqueness (I1, I2). Structural, not app discipline:
-- a raw-SQL seed inserting 'Studio A' next to 'studio a' would silently split
-- the room in two and disable overlap detection between the halves. The app
-- additionally normalizes to lowercase before writing, for display sanity.
-- (These replace plain @unique in the Prisma schema, which is byte-sensitive.)
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "users_email_ci_unique" ON "users" (lower("email"));
CREATE UNIQUE INDEX "members_email_ci_unique" ON "members" (lower("email"));
CREATE UNIQUE INDEX "rooms_name_ci_unique" ON "rooms" (lower("name"));

-- ---------------------------------------------------------------------------
-- Value sanity (I3) + ends_at consistency (I4)
-- ---------------------------------------------------------------------------
ALTER TABLE "classes"
  ADD CONSTRAINT "classes_default_duration_positive" CHECK ("default_duration_minutes" > 0),
  ADD CONSTRAINT "classes_default_capacity_nonnegative" CHECK ("default_capacity" >= 0);

-- ends_at is stored, not generated: index expressions must be IMMUTABLE and
-- timestamptz + interval is only STABLE. The CHECK ties it to starts+duration
-- (minute-only intervals are timezone-independent, so this is sound).
ALTER TABLE "class_sessions"
  ADD CONSTRAINT "class_sessions_duration_positive" CHECK ("duration_minutes" > 0),
  ADD CONSTRAINT "class_sessions_capacity_nonnegative" CHECK ("capacity" >= 0),
  -- The hard overbooking backstop (I13): booked_count is maintained by the
  -- booking service inside the per-session locked transaction; this bound
  -- makes an over-capacity increment (or shrinking capacity below the current
  -- booked count) fail at the database no matter what the application does.
  ADD CONSTRAINT "class_sessions_booked_count_within_capacity"
    CHECK ("booked_count" >= 0 AND "booked_count" <= "capacity"),
  ADD CONSTRAINT "class_sessions_ends_at_consistent"
    CHECK ("ends_at" = "starts_at" + make_interval(mins => "duration_minutes"));

-- ---------------------------------------------------------------------------
-- Physical-world exclusivity (I5, I6): a room hosts one session at a time and
-- a primary instructor teaches one session at a time. Half-open ranges [ )
-- make back-to-back sessions legal. These double as the concurrency backstop
-- for recurring generation: a race that slips past the app check loses here.
-- Co-instructor conflicts cannot be exclusion-constrained across the join
-- table; the service layer owns those (documented in docs/schema.md).
-- ---------------------------------------------------------------------------
ALTER TABLE "class_sessions"
  ADD CONSTRAINT "class_sessions_room_no_overlap"
    EXCLUDE USING gist ("room_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&),
  ADD CONSTRAINT "class_sessions_primary_instructor_no_overlap"
    EXCLUDE USING gist ("primary_instructor_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&);

-- ---------------------------------------------------------------------------
-- One ACTIVE booking per member per session (I7). Partial: cancelled and
-- settled bookings stay behind as history, and a member may rebook after
-- cancelling.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "bookings_one_active_per_member_session"
  ON "bookings" ("member_id", "session_id")
  WHERE "status" IN ('BOOKED', 'WAITLISTED');

-- ---------------------------------------------------------------------------
-- Event shape matches event type (I10).
-- ---------------------------------------------------------------------------
ALTER TABLE "booking_events"
  ADD CONSTRAINT "booking_events_shape_matches_type" CHECK (
    ("type" = 'CREATED'        AND "from_status" IS NULL     AND "to_status" IS NOT NULL) OR
    ("type" = 'STATUS_CHANGED' AND "from_status" IS NOT NULL AND "to_status" IS NOT NULL) OR
    ("type" = 'NOTE_ADDED'     AND "from_status" IS NULL     AND "to_status" IS NULL AND "note" IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- Goal 9: booking_events is append-only (I8). Triggers reject every UPDATE,
-- DELETE and TRUNCATE, from any code path including raw SQL and Prisma's
-- update/delete APIs (a cascaded TRUNCATE from a referencing table is caught
-- too — verified). Honest limit: the table OWNER can drop or disable the
-- trigger or ALTER the table, and on managed free tiers the app user owns the
-- schema — so this stops every application bug, not a hostile DBA. Booking
-- status itself stays app-trusted state; the ledger makes an out-of-band
-- status flip tamper-EVIDENT (status vs the last event's to_status).
-- (Integration tests reset state via session_replication_role = 'replica':
-- the GUC exists on every Postgres, but setting it needs superuser, which the
-- dockerised dev/CI user has and managed production users do not.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION forbid_booking_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'booking_events is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER booking_events_no_update_delete
  BEFORE UPDATE OR DELETE ON "booking_events"
  FOR EACH ROW EXECUTE FUNCTION forbid_booking_event_mutation();

CREATE TRIGGER booking_events_no_truncate
  BEFORE TRUNCATE ON "booking_events"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_booking_event_mutation();

-- ---------------------------------------------------------------------------
-- Booking identity is frozen (I9): status may change; who booked what, when,
-- and the waitlist position may not — otherwise the immutable timeline would
-- describe a booking that no longer means the same thing.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION forbid_booking_identity_change() RETURNS trigger AS $$
BEGIN
  IF NEW."id"         IS DISTINCT FROM OLD."id"
  OR NEW."member_id"  IS DISTINCT FROM OLD."member_id"
  OR NEW."session_id" IS DISTINCT FROM OLD."session_id"
  OR NEW."seq"        IS DISTINCT FROM OLD."seq"
  OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'booking identity columns (id, member_id, session_id, seq, created_at) are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bookings_identity_frozen
  BEFORE UPDATE ON "bookings"
  FOR EACH ROW EXECUTE FUNCTION forbid_booking_identity_change();

-- ---------------------------------------------------------------------------
-- Bookings are cancelled, never deleted (Goal 9): a deleted booking would
-- vacate its timeline slot. The FK RESTRICT from booking_events already blocks
-- deletion once an event exists; this closes the corner where a row created
-- without its CREATED event (raw SQL, buggy path) would be silently deletable.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION forbid_booking_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'bookings are cancelled, never deleted (%)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bookings_no_delete
  BEFORE DELETE ON "bookings"
  FOR EACH ROW EXECUTE FUNCTION forbid_booking_delete();

CREATE TRIGGER bookings_no_truncate
  BEFORE TRUNCATE ON "bookings"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_booking_delete();
