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

    def test_approval_session_revocation_sql_preserves_initial_pending_signin(self):
        member_sub = "1234567890"
        admin_sub = "2345678901"
        self.insert_member(member_sub, "member@test.invalid", "pending")
        self.insert_member(admin_sub, "admin@test.invalid", "approved", "admin")
        delete_query = (
            "DELETE FROM sessions WHERE google_sub=? AND EXISTS ("
            "SELECT 1 FROM members WHERE google_sub=? AND role='member' "
            "AND (status='rejected' OR ?!='approved'))"
        )

        def session(sub, token):
            self.db.execute(
                "INSERT INTO sessions(token_hash,google_sub,csrf_token,expires_at,created_at)"
                " VALUES(?,?,?,?,?)", (token, sub, "csrf", self.now + 100, self.now)
            )

        def exists(token):
            return self.db.execute(
                "SELECT COUNT(*) FROM sessions WHERE token_hash=?", (token,)
            ).fetchone()[0]

        session(member_sub, "pending-token")
        session(admin_sub, "admin-token")
        # The first pending -> approved transition keeps the applicant logged in.
        self.db.execute(delete_query, (member_sub, member_sub, "approved"))
        self.assertEqual(exists("pending-token"), 1)
        self.db.execute("UPDATE members SET status='approved' WHERE google_sub=?", (member_sub,))
        # A downgrade revokes existing sessions, never touching the administrator.
        self.db.execute(delete_query, (member_sub, member_sub, "rejected"))
        self.assertEqual(exists("pending-token"), 0)
        self.assertEqual(exists("admin-token"), 1)
        self.db.execute("UPDATE members SET status='rejected' WHERE google_sub=?", (member_sub,))
        session(member_sub, "rejected-token")
        # A rejected account cannot replay its new cookie after re-approval.
        self.db.execute(delete_query, (member_sub, member_sub, "approved"))
        self.assertEqual(exists("rejected-token"), 0)
        self.db.execute(delete_query, (admin_sub, admin_sub, "rejected"))
        self.assertEqual(exists("admin-token"), 1)

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
