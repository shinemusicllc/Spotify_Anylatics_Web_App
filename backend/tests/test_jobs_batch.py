import asyncio
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

from app.api import jobs as jobs_api
from app.schemas.job import JobBatchRequest


class FakeResult:
    def __init__(self, jobs):
        self._jobs = jobs

    def scalars(self):
        class Scalar:
            def __init__(self, jobs):
                self._jobs = jobs

            def all(self):
                return list(self._jobs)

        return Scalar(self._jobs)


class FakeSession:
    def __init__(self, jobs):
        self.jobs = jobs

    async def execute(self, query):
        return FakeResult(self.jobs)


def make_job(job_id, user_id, status="pending"):
    now = datetime.now(timezone.utc)
    return SimpleNamespace(
        id=job_id,
        item_id=uuid.uuid4(),
        status=status,
        spotify_url=f"https://open.spotify.com/track/{job_id.hex[:22]}",
        item_type="track",
        error=None,
        result=None,
        created_at=now,
        started_at=now,
        completed_at=None,
        user_id=user_id,
    )


def test_batch_jobs_endpoint_preserves_request_order_for_admin():
    async def run():
        admin = SimpleNamespace(id=uuid.uuid4(), role="admin")
        first_id = uuid.uuid4()
        second_id = uuid.uuid4()
        session = FakeSession([
            make_job(second_id, admin.id, status="completed"),
            make_job(first_id, admin.id, status="error"),
        ])

        response = await jobs_api.get_jobs_batch(
            JobBatchRequest(job_ids=[str(first_id), str(second_id)]),
            db=session,
            current_user=admin,
        )

        assert [job.id for job in response.jobs] == [str(first_id), str(second_id)]
        assert response.jobs[0].status == "error"
        assert response.jobs[1].status == "completed"

    asyncio.run(run())


def test_batch_jobs_endpoint_ignores_invalid_ids_and_duplicates():
    async def run():
        user = SimpleNamespace(id=uuid.uuid4(), role="user")
        job_id = uuid.uuid4()
        session = FakeSession([make_job(job_id, user.id)])

        response = await jobs_api.get_jobs_batch(
            JobBatchRequest(job_ids=["not-a-uuid", str(job_id), str(job_id)]),
            db=session,
            current_user=user,
        )

        assert len(response.jobs) == 1
        assert response.jobs[0].id == str(job_id)

    asyncio.run(run())
