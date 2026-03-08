"""Auth-related Pydantic schemas."""

from pydantic import BaseModel


class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str
    display_name: str | None = None


class LoginRequest(BaseModel):
    username: str  # can be username or email
    password: str


class UserResponse(BaseModel):
    id: str
    username: str
    email: str
    display_name: str | None
    role: str
    created_at: str | None = None

    model_config = {"from_attributes": True}


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse
