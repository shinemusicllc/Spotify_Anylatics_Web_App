"""Auth endpoints — register, login, user info."""

import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.models.item import Item
from app.models.crawl_job import CrawlJob
from app.schemas.auth import (
    RegisterRequest,
    LoginRequest,
    AuthResponse,
    UserResponse,
    UpdateProfileRequest,
    ChangePasswordRequest,
    UpdateAvatarRequest,
    AdminUpdateUserRequest,
    AdminResetPasswordRequest,
    AdminCreateUserRequest,
)
from app.services.auth import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user,
    get_admin_user,
)

router = APIRouter(prefix="/auth")
_INTERNAL_EMAIL_DOMAIN = "users.spoticheck.local"
_MAX_ROW_ORDER_ITEMS = 5000
_COLUMN_WIDTH_MIN = 40
_COLUMN_WIDTH_MAX = 2000


def _build_internal_email(username: str) -> str:
    return f"{username.lower()}@{_INTERNAL_EMAIL_DOMAIN}"


def _resolve_email(username: str, email: str | None) -> str:
    normalized = (email or "").strip().lower()
    return normalized or _build_internal_email(username)


def _public_email(email: str | None) -> str | None:
    normalized = (email or "").strip().lower()
    if not normalized or normalized.endswith("@" + _INTERNAL_EMAIL_DOMAIN):
        return None
    return email


def _user_response(user: User) -> UserResponse:
    return UserResponse(
        id=str(user.id),
        username=user.username,
        email=_public_email(user.email),
        display_name=user.display_name,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at.isoformat() if user.created_at else None,
        last_login=user.last_login.isoformat() if user.last_login else None,
        avatar=user.avatar,
    )


@router.post("/register", response_model=AuthResponse, status_code=201)
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """Create the bootstrap account. Public sign-up is disabled after first user."""
    count_result = await db.execute(select(func.count()).select_from(User))
    user_count = count_result.scalar() or 0
    if user_count > 0:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Public sign up is disabled",
        )

    username = (req.username or "").strip()
    resolved_email = _resolve_email(username, req.email)

    # Check duplicates
    existing = await db.execute(
        select(User).where((User.username == username) | (User.email == resolved_email))
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username already registered",
        )

    user = User(
        username=username,
        email=resolved_email,
        password_hash=hash_password(req.password),
        display_name=req.display_name,
        role="admin",
    )
    db.add(user)
    await db.flush()

    token = create_access_token({"sub": str(user.id)})
    return AuthResponse(
        access_token=token,
        user=_user_response(user),
    )


def _sanitize_ui_preferences(raw: dict | None) -> dict:
    data = raw if isinstance(raw, dict) else {}

    row_order_raw = data.get("row_order")
    row_order: list[str] = []
    if isinstance(row_order_raw, list):
        for value in row_order_raw:
            s = str(value).strip()
            if not s:
                continue
            row_order.append(s)
            if len(row_order) >= _MAX_ROW_ORDER_ITEMS:
                break

    widths_raw = data.get("column_widths")
    column_widths: dict[str, int] = {}
    if isinstance(widths_raw, dict):
        for key, value in widths_raw.items():
            name = str(key).strip()
            if not name:
                continue
            try:
                numeric = int(round(float(value)))
            except (TypeError, ValueError):
                continue
            column_widths[name] = max(_COLUMN_WIDTH_MIN, min(_COLUMN_WIDTH_MAX, numeric))

    return {"row_order": row_order, "column_widths": column_widths}


def _load_ui_preferences(user: User) -> dict:
    try:
        parsed = json.loads(user.ui_preferences) if user.ui_preferences else {}
    except (json.JSONDecodeError, TypeError):
        parsed = {}
    return _sanitize_ui_preferences(parsed)


@router.post("/login", response_model=AuthResponse)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    """Authenticate with username/email + password."""
    result = await db.execute(
        select(User).where(
            (User.username == req.username) | (User.email == req.username)
        )
    )
    user = result.scalar_one_or_none()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated",
        )

    user.last_login = datetime.utcnow()
    await db.flush()

    token = create_access_token({"sub": str(user.id)})
    return AuthResponse(
        access_token=token,
        user=_user_response(user),
    )


@router.get("/me", response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user)):
    """Return the current authenticated user."""
    return _user_response(current_user)


@router.get("/users", response_model=list[UserResponse])
async def list_users(
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Admin only — list all users."""
    result = await db.execute(select(User).order_by(User.created_at))
    users = result.scalars().all()
    return [_user_response(u) for u in users]


@router.post("/users", response_model=UserResponse, status_code=201)
async def admin_create_user(
    req: AdminCreateUserRequest,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Admin only - create a new user account from the dashboard."""
    username = (req.username or "").strip()
    email = _resolve_email(username, req.email)
    display_name = (req.display_name or "").strip() or None
    role = (req.role or "user").strip().lower()

    if not username:
        raise HTTPException(status_code=400, detail="Username is required")
    if len(req.password or "") < 4:
        raise HTTPException(
            status_code=400,
            detail="Password must be at least 4 characters",
        )
    if role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="Role must be 'admin' or 'user'")

    existing = await db.execute(
        select(User).where((User.username == username) | (User.email == email))
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username already registered",
        )

    user = User(
        username=username,
        email=email,
        password_hash=hash_password(req.password),
        display_name=display_name,
        role=role,
        is_active=True,
    )
    db.add(user)
    await db.flush()
    return _user_response(user)


# ---------------------------------------------------------------------------
# Profile / settings endpoints
# ---------------------------------------------------------------------------


@router.patch("/me", response_model=UserResponse)
async def update_profile(
    req: UpdateProfileRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update the current user's profile fields exposed in the dashboard."""
    if req.display_name is not None:
        current_user.display_name = req.display_name
    await db.flush()
    return _user_response(current_user)


@router.post("/me/password")
async def change_password(
    req: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Change the current user's password."""
    if not verify_password(req.current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(req.new_password) < 4:
        raise HTTPException(
            status_code=400, detail="Password must be at least 4 characters"
        )
    current_user.password_hash = hash_password(req.new_password)
    await db.flush()
    return {"ok": True, "message": "Password changed successfully"}


@router.post("/me/avatar")
async def update_avatar(
    req: UpdateAvatarRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload/replace the current user's avatar (base64 data URL)."""
    if len(req.avatar) > 500_000:  # ~500KB limit
        raise HTTPException(status_code=400, detail="Avatar too large (max 500KB)")
    current_user.avatar = req.avatar
    await db.flush()
    return {"ok": True, "avatar": req.avatar}


@router.delete("/me/avatar")
async def delete_avatar(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove the current user's avatar."""
    current_user.avatar = None
    await db.flush()
    return {"ok": True}


# ---------------------------------------------------------------------------
# UI preferences sync endpoints
# ---------------------------------------------------------------------------


@router.get("/me/preferences")
async def get_my_preferences(
    current_user: User = Depends(get_current_user),
):
    """Get the current user's UI preferences."""
    return {"preferences": _load_ui_preferences(current_user)}


@router.put("/me/preferences")
async def save_my_preferences(
    req: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Save the current user's UI preferences."""
    incoming = req.get("preferences", {})
    if incoming is None:
        incoming = {}
    if not isinstance(incoming, dict):
        raise HTTPException(status_code=400, detail="preferences must be an object")

    cleaned = _sanitize_ui_preferences(incoming)
    current_user.ui_preferences = json.dumps(cleaned)
    await db.flush()
    return {"preferences": cleaned}


# ---------------------------------------------------------------------------
# Groups sync endpoints
# ---------------------------------------------------------------------------


@router.get("/me/groups")
async def get_my_groups(
    current_user: User = Depends(get_current_user),
):
    """Get the current user's groups list."""
    try:
        groups = json.loads(current_user.custom_groups) if current_user.custom_groups else []
    except (json.JSONDecodeError, TypeError):
        groups = []
    return {"groups": groups}


@router.put("/me/groups")
async def save_my_groups(
    req: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Save the current user's groups list."""
    groups = req.get("groups", [])
    if not isinstance(groups, list):
        raise HTTPException(status_code=400, detail="groups must be an array")
    # Deduplicate and clean
    cleaned = list(dict.fromkeys(str(g).strip() for g in groups if str(g).strip()))
    current_user.custom_groups = json.dumps(cleaned)
    await db.flush()
    return {"groups": cleaned}


# ---------------------------------------------------------------------------
# Admin user management endpoints
# ---------------------------------------------------------------------------


@router.patch("/users/{user_id}", response_model=UserResponse)
async def admin_update_user(
    user_id: str,
    req: AdminUpdateUserRequest,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Admin — edit any user's profile, role, or active status."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if req.display_name is not None:
        user.display_name = req.display_name
    if req.role is not None:
        if req.role not in ("admin", "user"):
            raise HTTPException(status_code=400, detail="Role must be 'admin' or 'user'")
        user.role = req.role
    if req.is_active is not None:
        user.is_active = req.is_active

    await db.flush()
    return _user_response(user)


@router.post("/users/{user_id}/reset-password")
async def admin_reset_password(
    user_id: str,
    req: AdminResetPasswordRequest,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Admin — set a new password for any user (no old password needed)."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if len(req.new_password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")
    user.password_hash = hash_password(req.new_password)
    await db.flush()
    return {"ok": True, "message": f"Password reset for {user.username}"}




@router.get("/users/{user_id}/groups")
async def admin_get_user_groups(
    user_id: str,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Admin — get any user's groups."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    try:
        groups = json.loads(user.custom_groups) if user.custom_groups else []
    except (json.JSONDecodeError, TypeError):
        groups = []
    return {"groups": groups}


@router.put("/users/{user_id}/groups")
async def admin_save_user_groups(
    user_id: str,
    req: dict,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Admin — save any user's groups."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    groups = req.get("groups", [])
    if not isinstance(groups, list):
        raise HTTPException(status_code=400, detail="groups must be an array")
    cleaned = list(dict.fromkeys(str(g).strip() for g in groups if str(g).strip()))
    user.custom_groups = json.dumps(cleaned)
    await db.flush()
    return {"groups": cleaned}

@router.delete("/users/{user_id}")
async def admin_delete_user(
    user_id: str,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Admin — permanently delete a user and all their data (items, crawl jobs)."""
    if str(admin.id) == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    username = user.username

    # Delete crawl jobs belonging to user
    await db.execute(delete(CrawlJob).where(CrawlJob.user_id == user_id))
    # Delete items belonging to user
    await db.execute(delete(Item).where(Item.user_id == user_id))
    # Delete the user
    await db.execute(delete(User).where(User.id == user_id))
    await db.flush()

    return {"ok": True, "message": f"User {username} and all their data deleted"}
