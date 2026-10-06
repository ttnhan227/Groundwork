import pytest

from app.core.security import generate_confirmation_token
from app.services import assistant_actions


@pytest.mark.parametrize(
    "action",
    [
        {"action": "shell", "value": "del *"},
        {"action": "app", "value": "powershell"},
        {"action": "website", "value": "file:///C:/test"},
        {"action": "website", "value": "https://user:password@example.com"},
        {"action": "health", "value": "commands"},
        {"action": "app", "value": "notepad", "command": "bad"},
    ],
)
def test_model_commands_and_unknown_fields_never_execute(action):
    with pytest.raises(ValueError):
        assistant_actions.validate(action)


def test_approval_bound_to_exact_proposal_and_not_replayable(monkeypatch):
    action = {"action": "app", "value": "calculator"}
    token = generate_confirmation_token("assistant-action", action)
    performed = []
    monkeypatch.setattr(
        assistant_actions, "perform", lambda name, value: performed.append((name, value)) or {"success": True}
    )
    with pytest.raises(ValueError, match="approval"):
        assistant_actions.execute({"action": "app", "value": "notepad"}, token)
    assert not performed
    token = generate_confirmation_token("assistant-action", action)
    assert assistant_actions.execute(action, token)["success"]
    with pytest.raises(ValueError, match="approval"):
        assistant_actions.execute(action, token)
    assert performed == [("app", "calculator")]
