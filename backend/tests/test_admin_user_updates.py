from types import SimpleNamespace
import asyncio
import uuid

from app.api import auth as auth_api
from app.api import items as items_api
from app.schemas.auth import AdminUpdateUserRequest


class _ScalarOneOrNoneResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _ScalarResult:
    def __init__(self, values):
        self._values = values

    def all(self):
        return list(self._values)


class _ExecuteResult:
    def __init__(self, *, scalar_one_or_none=None, scalar=None, scalars_all=None):
        self._scalar_one_or_none = scalar_one_or_none
        self._scalar = scalar
        self._scalars_all = scalars_all or []

    def scalar_one_or_none(self):
        return self._scalar_one_or_none

    def scalar(self):
        return self._scalar

    def scalars(self):
        return _ScalarResult(self._scalars_all)


def test_admin_update_user_can_rename_username_and_refresh_internal_email():
    async def run():
        user = SimpleNamespace(
            id=uuid.uuid4(),
            username="oldname",
            email="oldname@users.spoticheck.local",
            display_name="Old Name",
            role="user",
            is_active=True,
            created_at=None,
            last_login=None,
            avatar=None,
            custom_groups=None,
        )

        class FakeDB:
            def __init__(self):
                self.calls = 0
                self.flush_calls = 0

            async def execute(self, query):
                self.calls += 1
                if self.calls == 1:
                    return _ExecuteResult(scalar_one_or_none=user)
                if self.calls == 2:
                    return _ExecuteResult(scalar_one_or_none=None)
                raise AssertionError(f"Unexpected execute call #{self.calls}: {query}")

            async def flush(self):
                self.flush_calls += 1

        db = FakeDB()
        admin = SimpleNamespace(id=uuid.uuid4(), role="admin")

        response = await auth_api.admin_update_user(
            user_id=str(user.id),
            req=AdminUpdateUserRequest(username="newname", display_name="New Name"),
            admin=admin,
            db=db,
        )

        assert user.username == "newname"
        assert user.email == "newname@users.spoticheck.local"
        assert user.display_name == "New Name"
        assert response.username == "newname"
        assert response.display_name == "New Name"
        assert db.flush_calls == 1

    asyncio.run(run())


def test_list_items_without_limit_avoids_limit_clause(monkeypatch):
    async def run():
        current_user = SimpleNamespace(id=uuid.uuid4(), role="user")
        executed_queries = []

        async def fake_load_latest_raw_data(db, items):
            return {}

        async def fake_load_recent_snapshots(db, items):
            return {}

        async def fake_load_item_users(db, items):
            return {}

        class FakeDB:
            async def execute(self, query):
                sql = str(query)
                executed_queries.append(sql)
                if "count(*)" in sql.lower():
                    return _ExecuteResult(scalar=0)
                return _ExecuteResult(scalars_all=[])

        monkeypatch.setattr(items_api, "_load_latest_raw_data", fake_load_latest_raw_data)
        monkeypatch.setattr(items_api, "_load_recent_snapshots", fake_load_recent_snapshots)
        monkeypatch.setattr(items_api, "_load_item_users", fake_load_item_users)

        response = await items_api.list_items(
            db=FakeDB(),
            current_user=current_user,
            limit=None,
            offset=0,
        )

        assert response.total == 0
        assert response.items == []
        assert len(executed_queries) == 2
        assert " limit " not in executed_queries[1].lower()

    asyncio.run(run())
