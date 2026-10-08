# Chores and the morning inbox

Weekly chores rotate on their scheduled weekday in **Europe/Vienna**, even if
nobody marked the previous occurrence complete. The stored due date and rotation
index are an anchor: reads project the current occurrence by the number of elapsed
weekly intervals. Missed occurrences do not become fake completion records or an
unbounded backlog. Legacy daily/monthly schedules remain completion-driven.

Completing a chore advances to its next scheduled occurrence and participant.
That future occurrence does not advance again just because its due day arrives.
The existing last-completed actor/time remain actual completion data.

In each chore/rotation editor, **Aktuell zuständig** corrects the assignee without
recording completion. For weekly chores this saves the current projected date as
the new anchor. Removing participants preserves the assigned person if still
included, otherwise chooses the first remaining participant. Undated Wäsche/Pfand
rotations continue to advance only on completion.

## One-way Obsidian integration

The existing daily calendar/weekday brief calls:

```sh
/usr/bin/python3 /home/jacksn/flat/scripts/flat-inbox.py
```

It reads `/srv/app-data/flat/data/flat.sqlite` **read-only**, projects the same
weekly rule, selects only roommate `kran` in `wg-main`, and reconciles tagged
checkboxes under the existing Obsidian Inbox. Includes active chores due today or
past due, plus currently assigned undated rotations labeled “when needed”. Future
chores and inactive chores are excluded. Each record has a stable hidden ID;
repeat runs deduplicate, and completion/reassignment/deletion in Flat removes the
corresponding managed checkbox on the next brief. No separate scheduler or cursor.

Flat remains authoritative: complete chores in Flat, not only in Obsidian. The
collector reopens a checked managed checkbox if Flat still says it is outstanding.
It never marks Flat chores done from an inbox checkbox. Unrelated tasks and nested
context are preserved. Source failure retains the previous inbox snapshot and
returns `FLAT_TASK_STATUS: unavailable`, never an empty success.

`--dry-run` is non-consuming and does not modify either source or destination.
Tests: `python3 scripts/test_flat_inbox.py`; weekly boundary, manual assignment,
legacy schedule, completion and identity checks live in the app test suites.
