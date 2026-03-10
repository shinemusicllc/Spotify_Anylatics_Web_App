"""Jobs endpoints — check crawl job status."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.crawl_job import CrawlJob
from app.models.user import User
from app.schemas.job import JobResponse
from app.services.auth import get_current_user

router = APIRouter()


@router.get("/jobs/{job_id}", response_model=JobResponse)
async def get_job(
    job_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get crawl job status."""
    result = await db.execute(select(CrawlJob).where(CrawlJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Ownership check
    if current_user.role != "admin" and job.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to view this job")

    return JobResponse(
        id=str(job.id),
        item_id=str(job.item_id) if job.item_id else None,
        status=job.status,
        spotify_url=job.spotify_url,
        item_type=job.item_type,
        error=job.error,
        result=job.result,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
    )
