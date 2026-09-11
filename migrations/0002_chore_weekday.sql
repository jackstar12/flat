ALTER TABLE chores
  ADD COLUMN schedule_weekday TEXT
  CHECK (schedule_weekday IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'));

UPDATE chores
SET schedule_weekday = 'wednesday',
    next_due_date = date(
      next_due_date,
      '+' || ((3 - CAST(strftime('%w', next_due_date) AS INTEGER) + 7) % 7) || ' days'
    )
WHERE frequency_unit = 'week';
