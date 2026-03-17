import asyncio
import uuid

import pytest
from types import SimpleNamespace

from fastapi import HTTPException
from app.api import items as items_api
from app.schemas.item import ItemMoveRequest


class FakeResult:
    def __init__(self, items):
        self._items = items

    def scalars(self):
        class Scalar:
            def __init__(self, items):
                self._items = items

            def all(self):
                return list(self._items)

        return Scalar(self._items)


class FakeSession:
    def __init__(self, items):
        self.items = items
        self.committed = False

    async def execute(self, query):
        return FakeResult(self.items)

    async def commit(self):
        self.committed = True


def make_item(item_id, user_id, group):
    return SimpleNamespace(id=item_id, user_id=user_id, group=group)


def test_user_cannot_move_other_users_items():
    async def run():
        user = SimpleNamespace(id=uuid.uuid4(), role="user")
        session = FakeSession([])
        with pytest.raises(HTTPException) as exc:
            await items_api.move_items_group(
                ItemMoveRequest(item_ids=[uuid.uuid4()], group="new"),
                db=session,
                current_user=user,
            )
        assert exc.value.status_code == 404

    asyncio.run(run())


def test_user_moves_own_items():
    async def run():
        user = SimpleNamespace(id=uuid.uuid4(), role="user")
        item = make_item(uuid.uuid4(), user.id, "old")
        session = FakeSession([item])
        response = await items_api.move_items_group(
            ItemMoveRequest(item_ids=[item.id], group="moved"),
            db=session,
            current_user=user,
        )
        assert response["moved"] == 1
        assert item.group == "moved"
        assert session.committed

    asyncio.run(run())


def test_admin_can_move_any_user_items():
    async def run():
        admin = SimpleNamespace(id=uuid.uuid4(), role="admin")
        target_user = uuid.uuid4()
        item = make_item(uuid.uuid4(), target_user, "source")
        session = FakeSession([item])
        response = await items_api.move_items_group(
            ItemMoveRequest(item_ids=[item.id], group="", user_id=target_user),
            db=session,
            current_user=admin,
        )
        assert response["group"] is None
        assert response["moved"] == 1
        assert item.group is None

    asyncio.run(run())
