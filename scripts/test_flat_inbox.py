import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('collector', Path(__file__).with_name('flat-inbox.py'))
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)

class SyncTest(unittest.TestCase):
    def test_lifecycle(self):
        with tempfile.TemporaryDirectory() as directory:
            db, inbox = Path(directory)/'flat.sqlite', Path(directory)/'inbox.md'
            text = '# Tasks\n\n## Inbox\n\n- [ ] Unrelated task\n  - Keep this detail.\n\n## Later\n'
            inbox.write_text(text)
            conn = sqlite3.connect(db)
            conn.executescript('''
            CREATE TABLE chores(id, household_id, title, participant_ids, rotation_index, is_active, next_due_date, frequency_unit, frequency_interval);
            CREATE TABLE rotations(id, household_id, title, participant_ids, rotation_index);
            INSERT INTO chores VALUES('a','wg-main','Vacuum','["kran","mitter"]',0,1,'2026-10-07','week',1);
            INSERT INTO chores VALUES('b','wg-main','Future','["kran"]',0,1,'2026-10-14','week',1);
            INSERT INTO chores VALUES('c','wg-main','Inactive','["kran"]',0,0,'2026-10-01','week',1);
            INSERT INTO rotations VALUES('r','wg-main','Bottles','["kran","mitter"]',0);
            ''')
            run = lambda **kw: collector.sync(db, inbox, '2026-10-07', **kw)
            self.assertEqual(run(dry_run=True), (2, True)); self.assertEqual(inbox.read_text(), text)
            self.assertEqual(run(), (2, True)); self.assertEqual(run(), (2, False))
            self.assertIn('  - Keep this detail.', inbox.read_text())
            baseline = inbox.read_text()
            conn.execute('ALTER TABLE chores RENAME TO gone'); conn.commit()
            with self.assertRaises(sqlite3.OperationalError): run()
            self.assertEqual(inbox.read_text(), baseline)
            conn.execute('ALTER TABLE gone RENAME TO chores'); conn.commit()
            self.assertEqual(run(), (2, False))
            conn.execute("UPDATE chores SET rotation_index=1 WHERE id='a'"); conn.commit()
            self.assertEqual(run(), (1, True)); self.assertNotIn('flat-task:chore:a', inbox.read_text())
            conn.execute("UPDATE chores SET rotation_index=0, next_due_date='2026-10-07' WHERE id='a'"); conn.commit()
            self.assertEqual(run(), (2, True)); self.assertEqual(run(), (2, False))
            conn.execute("UPDATE chores SET next_due_date='2026-10-14' WHERE id='a'"); conn.commit()
            self.assertEqual(run(), (1, True))
            conn.execute("DELETE FROM rotations"); conn.commit()
            self.assertEqual(run(), (0, True)); self.assertIn('- [ ] Unrelated task', inbox.read_text())
            conn.execute("UPDATE chores SET next_due_date='2026-09-23', rotation_index=0 WHERE id='a'"); conn.commit()
            # Two missed weeks wrap the two-person rotation back to Jakob.
            self.assertEqual(run(), (1, True))
            self.assertIn('📅 2026-10-07', inbox.read_text())
            conn.execute("UPDATE chores SET next_due_date='2026-09-30' WHERE id='a'"); conn.commit()
            self.assertEqual(run(), (0, True))
            conn.close()

if __name__ == '__main__': unittest.main()
