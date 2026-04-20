from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
_bearer = HTTPBearer()


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def _create_token(payload: dict, expire_minutes: int) -> str:
    data = payload.copy()
    data["exp"] = datetime.now(timezone.utc) + timedelta(minutes=expire_minutes)
    return jwt.encode(data, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def create_admin_token() -> str:
    return _create_token({"sub": settings.admin_username, "type": "admin"}, settings.admin_jwt_expire_minutes)


def create_vendor_token(email: str, engagement_id: str) -> str:
    return _create_token(
        {"sub": email, "type": "vendor", "engagement_id": engagement_id},
        settings.vendor_jwt_expire_minutes,
    )


def create_ir_token(email: str, engagement_id: str) -> str:
    return _create_token(
        {"sub": email, "type": "ir", "engagement_id": engagement_id},
        settings.ir_jwt_expire_minutes,
    )


def _decode(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")


async def get_admin_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> str:
    payload = _decode(credentials.credentials)
    if payload.get("type") != "admin":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
    return payload["sub"]


async def get_vendor_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> dict:
    payload = _decode(credentials.credentials)
    if payload.get("type") != "vendor":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
    return {"sub": payload["sub"], "engagement_id": payload["engagement_id"]}


async def get_ir_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> dict:
    payload = _decode(credentials.credentials)
    if payload.get("type") != "ir":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
    return {"sub": payload["sub"], "engagement_id": payload["engagement_id"]}
