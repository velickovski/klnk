ALTER TABLE network_records DROP CONSTRAINT network_records_kind_check;
ALTER TABLE network_records ADD CONSTRAINT network_records_kind_check CHECK(kind IN ('identity','connection','policy','memory','conversation','task','event','reminder','outbox','receipt','preferences','busy','availability'));
CREATE INDEX network_private_availability ON network_records(owner_a,kind) WHERE kind IN ('busy','availability');
