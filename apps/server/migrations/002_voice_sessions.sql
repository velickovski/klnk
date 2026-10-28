DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='resources_kind_check' AND pg_get_constraintdef(oid) LIKE '%voice_session%') THEN
    ALTER TABLE resources DROP CONSTRAINT IF EXISTS resources_kind_check;
    ALTER TABLE resources ADD CONSTRAINT resources_kind_check CHECK (kind IN ('profile','contact','memory','mission','attempt','action','voice','calendar','integration','optout','voice_session','voice_turn'));
  END IF;
END $$;
