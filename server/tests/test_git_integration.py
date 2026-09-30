"""Tests for Git integration service and repository inspection."""

import subprocess
import tempfile
from pathlib import Path

from app.core import config
from app.database.local_db import reset_db
from app.services.git_service import GitService


def test_git_repo_detection_and_commit_indexing():
    with tempfile.TemporaryDirectory() as tmpdir:
        repo_dir = Path(tmpdir) / "test_repo"
        repo_dir.mkdir()

        # Initialize git repo and make a commit
        subprocess.run(["git", "init"], cwd=str(repo_dir), check=True, capture_output=True)
        subprocess.run(["git", "config", "user.email", "test@groundwork.local"], cwd=str(repo_dir), check=True)
        subprocess.run(["git", "config", "user.name", "Groundwork Tester"], cwd=str(repo_dir), check=True)

        readme = repo_dir / "README.md"
        readme.write_text("# Test Repo\nLocal Git integration test.")
        subprocess.run(["git", "add", "README.md"], cwd=str(repo_dir), check=True)
        subprocess.run(["git", "commit", "-m", "feat: initial commit with README"], cwd=str(repo_dir), check=True)

        db_path = Path(tmpdir) / "test_git.db"
        config._settings = config.Settings(database_path=db_path, data_dir=Path(tmpdir))

        git_svc = GitService()
        assert git_svc.is_git_repo(repo_dir)

        # Working tree status
        status = git_svc.get_working_tree_status(repo_dir)
        assert status["has_uncommitted_changes"] is False

        # Add an uncommitted file
        (repo_dir / "draft.txt").write_text("work in progress")
        status2 = git_svc.get_working_tree_status(repo_dir)
        assert status2["has_uncommitted_changes"] is True

        reset_db()
