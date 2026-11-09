CREATE TABLE app_meta (id TEXT PRIMARY KEY NOT NULL, schema_version INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 0, generation TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE data_records (dataset TEXT NOT NULL, store TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), PRIMARY KEY(dataset,store,id));
--> statement-breakpoint
CREATE INDEX records_item ON data_records(dataset,store,json_extract(body,'$.itemId'));
--> statement-breakpoint
CREATE INDEX records_normalized ON data_records(dataset,store,json_extract(body,'$.normalized'));
--> statement-breakpoint
CREATE INDEX records_created ON data_records(dataset,store,json_extract(body,'$.createdAt'),id);
--> statement-breakpoint
CREATE INDEX records_review ON data_records(dataset,store,json_extract(body,'$.nextReview'),id);
--> statement-breakpoint
CREATE INDEX records_at ON data_records(dataset,store,json_extract(body,'$.at'));
--> statement-breakpoint
CREATE TABLE write_guard (id TEXT PRIMARY KEY NOT NULL, valid INTEGER NOT NULL CHECK(valid=1));
--> statement-breakpoint
CREATE TABLE transfer_jobs (id TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)));
