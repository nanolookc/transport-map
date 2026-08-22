ALTER TABLE "stop_segment_travel_times"
  ALTER COLUMN "id" TYPE bigint;
--> statement-breakpoint
ALTER SEQUENCE "stop_segment_travel_times_id_seq" AS bigint;
