"""Run the exact free D1 migration against SQLite to catch schema/foreign-key defects."""
from pathlib import Path
import sqlite3
import time
import unittest

MIGRATION = Path(__file__).resolve().parents[1] / "migrations" / "0001_initial.sql"


class MembershipSchemaTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys = ON")
        self.db.executescript(MIGRATION.read_text(encoding="utf-8"))
        self.now = int(time.time())

    def tearDown(self):
        self.db.close()

    def insert_member(self, sub, email, status="pending", role="member"):
        self.db.execute(
            "INSERT INTO members(google_sub,email,display_name,status,role,created_at,updated_at)"
            " VALUES(?,?,?,?,?,?,?)",
            (sub, email, "Example", status, role, self.now, self.now),
        )

    def test_fresh_application_requires_approval(self):
        self.insert_member("1234567890", "example@test.invalid")
        member = self.db.execute(
            "SELECT status,role FROM members WHERE google_sub=?", ("1234567890",)
        ).fetchone()
        self.assertEqual(member, ("pending", "member"))
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert_member("1234567891", "example2@test.invalid", "administrator")
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert_member("1234567892", "example2@test.invalid", "pending", "root")

    def test_unique_email_and_status_transition(self):
        self.insert_member("1234567890", "example@test.invalid")
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert_member("1234567891", "example@test.invalid")
        result = self.db.execute(
            "UPDATE members SET status='approved',reviewed_at=?,reviewed_by=?"
            " WHERE google_sub=? AND role='member' RETURNING google_sub",
            (self.now, "administrator-id", "1234567890"),
        ).fetchone()
        self.assertEqual(result, ("1234567890",))

    def test_expired_oauth_state_consumed_exactly_once(self):
        self.db.execute(
            "INSERT INTO oauth_states(state_hash,code_verifier,nonce,next_path,expires_at)"
            " VALUES(?,?,?,?,?)",
            ("abc", "verifier", "nonce", "/", self.now + 300),
        )
        result = self.db.execute(
            "DELETE FROM oauth_states WHERE state_hash=? AND expires_at>?"
            " RETURNING code_verifier,nonce,next_path", ("abc", self.now)
        ).fetchone()
        self.assertEqual(result, ("verifier", "nonce", "/"))
        self.assertIsNone(
            self.db.execute(
                "DELETE FROM oauth_states WHERE state_hash=? AND expires_at>?"
                " RETURNING code_verifier", ("abc", self.now)
            ).fetchone()
        )

    def test_member_deletion_cascades_sessions_without_leaving_orphans(self):
        self.insert_member("1234567890", "example@test.invalid")
        self.db.execute(
            "INSERT INTO sessions(token_hash,google_sub,csrf_token,expires_at,created_at)"
            " VALUES(?,?,?,?,?)",
            ("hashed-token", "1234567890", "csrf", self.now + 60, self.now),
        )
        result = self.db.execute(
            "DELETE FROM members WHERE google_sub=? AND role='member' RETURNING google_sub",
            ("1234567890",)
        ).fetchone()
        self.assertEqual(result, ("1234567890",))
        self.assertEqual(self.db.execute("SELECT count(*) FROM sessions").fetchone()[0], 0)

    def test_cleanup_removes_expired_records_only(self):
        self.insert_member("1234567890", "example@test.invalid")
        for key, ttl in [("expired", -5), ("future", 120)]:
            self.db.execute(
                "INSERT INTO sessions(token_hash,google_sub,csrf_token,expires_at,created_at)"
                " VALUES(?,?,?,?,?)", (key, "1234567890", "csrf", self.now + ttl, self.now)
            )
        self.db.execute("DELETE FROM sessions WHERE expires_at<=?", (self.now,))
        self.assertEqual(self.db.execute("SELECT token_hash FROM sessions").fetchall(), [("future",)])
        self.assertEqual(self.db.execute("SELECT count(*) FROM members").fetchone()[0], 1)


if __name__ == "__main__":
    unittest.main()
