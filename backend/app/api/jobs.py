"""Jobs endpoints — check crawl job status."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.crawl_job import CrawlJob
from app.schemas.job import JobResponse

router = APIRouter()


@router.get("/jobs/{job_id}", response_model=JobResponse)
async def get_job(
    job_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get crawl job status."""
    result = await db.execute(select(CrawlJob).where(CrawlJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return JobResponse(
        id=str(job.id),
        status=job.status,
        spotify_url=job.spotify_url,
        item_type=job.item_type,
        error=job.error,
        result=job.result,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
    )
