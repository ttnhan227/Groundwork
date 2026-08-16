from pathlib import Path

from app.models import Notification
from app.schemas import UserPreferences, WorkspaceMemberInviteRequest


ROOT = Path(__file__).parents[1]


def test_account_preferences_cover_documents_notifications_appearance_and_privacy() -> None:
    preferences = UserPreferences()
    assert preferences.document_language == "English"
    assert preferences.default_tone == "professional"
    assert preferences.notify_processing_completed
    assert preferences.notify_processing_failed
    assert preferences.theme == "light"
    assert preferences.interface_size == "comfortable"
    assert preferences.retention_days == 90


def test_notification_model_is_durable_and_user_scoped() -> None:
    table = Notification.__table__
    assert table.c.user_id.index
    assert table.c.read_at.index
    assert table.c.created_at.index
    assert table.c.metadata.name == "metadata"


def test_notification_api_supports_inbox_lifecycle() -> None:
    source = ROOT.joinpath("app", "controllers", "notifications.py").read_text(encoding="utf-8")
    for route in ('@router.get("",', '"/unread-count"', '"/{notification_id}/read"', '"/read-all"', '@router.delete("/{notification_id}"'):
        assert route in source


def test_team_membership_routes_and_roles_are_explicit() -> None:
    payload = WorkspaceMemberInviteRequest(email="member@example.com", role="viewer")
    assert payload.role == "viewer"
    source = ROOT.joinpath("app", "controllers", "deliverables.py").read_text(encoding="utf-8")
    assert '"/workspaces/{workspace_id}/members"' in source
    assert '"/workspaces/{workspace_id}/members/{member_id}"' in source
    assert 'workspace.kind = "team"' in source


def test_notification_migration_follows_guided_verification_head() -> None:
    migration = ROOT.joinpath("alembic", "versions", "0021_account_notifications.py").read_text(encoding="utf-8")
    assert 'down_revision = "0020_guided_verification"' in migration
    assert '"notifications"' in migration
    assert '"read_at"' in migration


def test_account_api_exposes_security_usage_and_privacy_controls() -> None:
    source = ROOT.joinpath("app", "controllers", "users.py").read_text(encoding="utf-8")
    for route in (
        '"/profile/sessions"', '"/profile/sessions/{session_id}"', '"/profile/sessions/revoke-all"',
        '"/profile/usage"', '"/profile/data-export"', '"/profile/history"', '"/profile/account"',
    ):
        assert route in source
