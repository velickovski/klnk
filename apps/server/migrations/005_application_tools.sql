ALTER TABLE resources DROP CONSTRAINT IF EXISTS resources_kind_check;
ALTER TABLE resources ADD CONSTRAINT resources_kind_check CHECK (kind IN (
  'profile','contact','memory','mission','attempt','action','voice','calendar','integration','optout',
  'voice_session','voice_turn','tool_access','tool_receipt','tool_trace'
));
