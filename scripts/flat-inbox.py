#!/usr/bin/env python3
"""One-way Flat -> Obsidian projection, invoked by the existing morning brief.

Flat is authoritative: complete/reassign there. No database writes, credentials,
network requests, cursor, or independent scheduler. Only tagged lines are owned.
"""
from __future__ import annotations
import argparse
from datetime import datetime, date, timedelta
import fcntl
import json
import os
from pathlib import Path
import re
import sqlite3
import tempfile
from zoneinfo import ZoneInfo

DB = Path('/srv/app-data/flat/data/flat.sqlite')
INBOX = Path('/home/jacksn/Obsidian/Vault/00 Inbox/Open tasks.md')
MARKER = re.compile(r'^- \[[ xX]\] .*<!-- flat-task:(chore|rotation):([\w-]+) -->$(?:\n)?', re.M)

def safe_title(text):
    # Titles are data, not Markdown or instructions.
    return re.sub(r'[\r\n\t]+', ' ', re.sub(r'[<>\[\]`*\\#]', '', text)).strip()

def collect(db: Path, today: str):
    tasks = []
    with sqlite3.connect(db.resolve().as_uri() + '?mode=ro', uri=True) as connection:
        connection.row_factory = sqlite3.Row
        connection.execute('BEGIN')
        for table, kind in [('chores', 'chore'), ('rotations', 'rotation')]:
            for row in connection.execute(f'SELECT * FROM {table} WHERE household_id = ?', ('wg-main',)):
                people = json.loads(row['participant_ids'])
                if not people or not isinstance(people, list):
                    raise ValueError('Invalid Flat participants')
                index = row['rotation_index']
                due = row['next_due_date'] if kind == 'chore' else None
                if kind == 'chore' and row['is_active'] and row['frequency_unit'] == 'week':
                    days = (date.fromisoformat(today) - date.fromisoformat(due)).days
                    period_days = 7 * row['frequency_interval']
                    periods = max(0, days // period_days)
                    index += periods
                    due = (date.fromisoformat(due) + timedelta(days=periods * period_days)).isoformat()
                if people[index % len(people)] != 'kran':
                    continue
                if kind == 'chore' and (not row['is_active'] or due > today):
                    continue
                identity = row['id']
                if not re.fullmatch(r'[\w-]+', identity):
                    raise ValueError('Invalid Flat ID')
                title = safe_title(row['title'])
                due = f" 📅 {due}" if kind == 'chore' else ' (when needed)'
                line = f'- [ ] Flat: {title}{due} — [open Flat](https://flat.kranawetter.dev) <!-- flat-task:{kind}:{identity} -->\n'
                tasks.append(((kind, identity), line))
    return dict(sorted(tasks))

def reconcile(text: str, desired: dict):
    if '## Inbox\n' not in text:
        raise ValueError('Inbox heading missing')
    seen = set()
    def replace(match):
        key = (match[1], match[2])
        if key not in desired or key in seen:
            return ''
        seen.add(key)
        return desired[key]
    updated = MARKER.sub(replace, text)
    additions = ''.join(line for key, line in desired.items() if key not in seen)
    if additions:
        updated = updated.replace('## Inbox\n', '## Inbox\n\n' + additions, 1)
    return updated

def sync(db=DB, inbox=INBOX, today=None, dry_run=False):
    today = today or datetime.now(ZoneInfo('Europe/Vienna')).date().isoformat()
    desired = collect(db, today)  # Source errors must not delete existing tasks.
    # Lock + re-read + pre-replace comparison protects cooperative/concurrent edits.
    with inbox.open('r', encoding='utf-8') as source:
        fcntl.flock(source, fcntl.LOCK_EX)
        text = source.read()
        updated = reconcile(text, desired)
        changed = updated != text
        if changed and not dry_run:
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=inbox.parent, delete=False) as output:
                    temporary = Path(output.name)
                    output.write(updated)
                    output.flush()
                    os.fsync(output.fileno())
                os.chmod(temporary, inbox.stat().st_mode & 0o777)
                if inbox.read_text() != text:
                    raise RuntimeError('Inbox changed concurrently; retry on next brief')
                os.replace(temporary, inbox)
            finally:
                if temporary and temporary.exists():
                    temporary.unlink()
    return len(desired), changed

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    try:
        count, changed = sync(dry_run=args.dry_run)
        print(f'FLAT_TASK_STATUS: ok; assigned actionable tasks={count}; inbox_{"would_change" if args.dry_run else "changed"}={str(changed).lower()}')
    except Exception:
        # Do not expose DB contents or private paths in morning output.
        print('FLAT_TASK_STATUS: unavailable; existing inbox tasks preserved')
        raise SystemExit(1)

if __name__ == '__main__':
    main()
