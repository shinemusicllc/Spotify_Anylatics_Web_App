"""Auth endpoints — register, login, user info."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.auth import (
    RegisterRequest,
    LoginRequest,
    AuthResponse,
    UserResponse,
)
from app.services.auth import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user,
    get_admin_user,
)

router = APIRouter(prefix="/auth")


def _user_response(user: User) -> UserResponse:
    return UserResponse(
        id=str(user.id),
        username=user.username,
        email=user.email,
        display_name=user.display_name,
        role=user.role,
        created_at=user.created_at.isoformat() if user.created_at else None,
    )


@router.post("/register", response_model=AuthResponse, status_code=201)
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """Create a new user account. First user auto-becomes admin."""
    # Check duplicates
    existing = await db.execute(
        select(User).where((User.username == req.username) | (User.email == req.email))
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username or email already registered",
        )

    # If no admin exists yet, this user becomes admin
    admin_result = await db.execute(
        select(func.count()).select_from(User).where(User.role == "admin")
    )
    admin_count = admin_result.scalar() or 0
    role = "admin" if admin_count == 0 else "user"

    user = User(
        username=req.username,
        email=req.email,
        password_hash=hash_password(req.password),
        display_name=req.display_name,
        role=role,
    )
    db.add(user)
    await db.flush()

    token = create_access_token({"sub": str(user.id)})
    return AuthResponse(
        access_token=token,
        user=_user_response(user),
    )


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

@router.patch("/users/{target_user_id}/role")
async def update_user_role(
    target_user_id: str,
    role: str = "admin",
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Admin only - change user role."""
    result = await db.execute(select(User).where(User.id == target_user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="Invalid role")
    target.role = role
    await db.flush()
    return _user_response(target)


@router.post("/promote-self")
async def promote_self_to_admin(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Promote yourself to admin IF no admin exists in the system."""
    admin_check = await db.execute(
        select(func.count()).select_from(User).where(User.role == "admin")
    )
    if (admin_check.scalar() or 0) > 0:
        raise HTTPException(status_code=403, detail="Admin already exists")
    current_user.role = "admin"
    await db.flush()
    token = create_access_token({"sub": str(current_user.id)})
    return AuthResponse(access_token=token, user=_user_response(current_user))

