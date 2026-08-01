"""Add workspace ownership and activity boundaries."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0014_workspace_projects"
down_revision = "0013_google_identity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workspaces",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False, server_default="general"),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("settings", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ("owner_id", "kind", "status", "created_at", "updated_at"):
        op.create_index(f"ix_workspaces_{column}", "workspaces", [column])
    op.create_table(
        "workspace_members",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role", sa.String(20), nullable=False, server_default="member"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "user_id"),
    )
    op.create_index("ix_workspace_members_workspace_id", "workspace_members", ["workspace_id"])
    op.create_index("ix_workspace_members_user_id", "workspace_members", ["user_id"])
    op.execute("INSERT INTO workspaces (id, owner_id, name, kind) SELECT gen_random_uuid(), id, display_name || ' workspace', 'personal' FROM users")
    op.execute("INSERT INTO workspace_members (id, workspace_id, user_id, role) SELECT gen_random_uuid(), id, owner_id, 'owner' FROM workspaces")

    for table in ("documents", "collections", "conversations", "generated_artifacts", "workspace_memories"):
        op.add_column(table, sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=True))
        op.execute(f"UPDATE {table} target SET workspace_id = workspace.id FROM workspaces workspace WHERE workspace.owner_id = target.owner_id")
        op.alter_column(table, "workspace_id", nullable=False)
        op.create_index(f"ix_{table}_workspace_id", table, ["workspace_id"])
        op.create_foreign_key(f"fk_{table}_workspace_id", table, "workspaces", ["workspace_id"], ["id"], ondelete="CASCADE")
    op.drop_constraint("workspace_memories_owner_id_key_key", "workspace_memories", type_="unique")
    op.create_unique_constraint("uq_workspace_memories_workspace_key", "workspace_memories", ["workspace_id", "key"])
    op.create_table(
        "workspace_activities",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("object_type", sa.String(30), nullable=False),
        sa.Column("object_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("verb", sa.String(60), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ("workspace_id", "actor_id", "object_type", "object_id", "verb", "created_at"):
        op.create_index(f"ix_workspace_activities_{column}", "workspace_activities", [column])


def downgrade() -> None:
    op.drop_table("workspace_activities")
    op.drop_constraint("uq_workspace_memories_workspace_key", "workspace_memories", type_="unique")
    op.create_unique_constraint("workspace_memories_owner_id_key_key", "workspace_memories", ["owner_id", "key"])
    for table in reversed(("documents", "collections", "conversations", "generated_artifacts", "workspace_memories")):
        op.drop_constraint(f"fk_{table}_workspace_id", table, type_="foreignkey")
        op.drop_index(f"ix_{table}_workspace_id", table_name=table)
        op.drop_column(table, "workspace_id")
    op.drop_table("workspace_members")
    op.drop_table("workspaces")
