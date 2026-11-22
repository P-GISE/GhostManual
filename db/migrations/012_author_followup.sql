ALTER TABLE revision_questions
  ADD COLUMN followup_checked_at timestamptz,
  ADD COLUMN followup_question text,
  ADD COLUMN followup_answer text,
  ADD COLUMN followup_skipped boolean NOT NULL DEFAULT false,
  ADD COLUMN followup_answered_at timestamptz,
  ADD CONSTRAINT followup_question_length CHECK (
    followup_question IS NULL OR (
      char_length(followup_question) BETWEEN 1 AND 500 AND btrim(followup_question) <> ''
    )
  ),
  ADD CONSTRAINT followup_answer_length CHECK (
    followup_answer IS NULL OR (
      char_length(followup_answer) BETWEEN 1 AND 2000 AND btrim(followup_answer) <> ''
    )
  ),
  ADD CONSTRAINT followup_requires_judgement CHECK (
    followup_question IS NULL OR followup_checked_at IS NOT NULL
  ),
  ADD CONSTRAINT followup_response_requires_question CHECK (
    followup_question IS NOT NULL OR
      (followup_answer IS NULL AND NOT followup_skipped AND followup_answered_at IS NULL)
  ),
  ADD CONSTRAINT followup_response_exclusive CHECK (
    NOT (followup_skipped AND followup_answer IS NOT NULL)
  ),
  ADD CONSTRAINT followup_response_timestamp CHECK (
    (followup_answer IS NOT NULL OR followup_skipped) = (followup_answered_at IS NOT NULL)
  );

-- Keep the 010 identity/move trigger and 011 search paths intact.
CREATE FUNCTION validate_revision_followup() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.followup_checked_at IS NOT NULL AND
    ROW(NEW.followup_checked_at, NEW.followup_question) IS DISTINCT FROM
    ROW(OLD.followup_checked_at, OLD.followup_question) THEN
    RAISE EXCEPTION 'Followup judgement is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.followup_checked_at IS NOT NULL AND
    (TG_OP = 'INSERT' OR OLD.followup_checked_at IS NULL) AND
    (NEW.answer IS NULL OR NEW.skipped) THEN
    RAISE EXCEPTION 'Followup judgement requires an answered question' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER valid_revision_followup BEFORE INSERT OR UPDATE ON revision_questions
  FOR EACH ROW EXECUTE FUNCTION validate_revision_followup();
