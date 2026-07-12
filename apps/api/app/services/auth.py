from __future__ import annotations

import re
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.security import create_access_token, create_refresh_token, hash_password, verify_password
from app.models.organization import Organization
from app.models.user import User
from app.schemas import LoginRequest, MeResponse, OrganizationOut, SignupRequest, TokenResponse, UserOut
from app.services.audit import AuditAction, write_audit
from app.services.categories import seed_system_categories
from app.services.clients import ensure_default_client


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "org"


# Re-export for call sites that still import write_audit from auth
__all__ = [
    "slugify",
    "write_audit",
    "signup",
    "login",
    "logout",
    "me",
]


def signup(db: Session, payload: SignupRequest) -> TokenResponse:
    existing = db.query(User).filter(User.email == payload.email.lower()).first()
    if existing:
        raise ValueError("Email already registered")

    base_slug = slugify(payload.organization_name)
    slug = base_slug
    n = 1
    while db.query(Organization).filter(Organization.slug == slug).first():
        slug = f"{base_slug}-{n}"
        n += 1

    org = Organization(name=payload.organization_name, slug=slug)
    db.add(org)
    db.flush()

    seed_system_categories(db)
    ensure_default_client(db, org.id)

    user = User(
        email=payload.email.lower(),
        password_hash=hash_password(payload.password),
        full_name=payload.full_name,
        organization_id=org.id,
    )
    db.add(user)
    db.flush()

    write_audit(
        db,
        organization_id=org.id,
        user_id=user.id,
        action=AuditAction.AUTH_SIGNUP,
        entity_type="user",
        entity_id=str(user.id),
        after={"email": user.email, "full_name": user.full_name},
    )
    db.commit()
    db.refresh(user)

    return TokenResponse(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
    )


def login(db: Session, payload: LoginRequest) -> TokenResponse:
    email = payload.email.lower()
    user = db.query(User).filter(User.email == email).first()
    if not user or not verify_password(payload.password, user.password_hash):
        if user:
            write_audit(
                db,
                organization_id=user.organization_id,
                user_id=user.id,
                action=AuditAction.AUTH_LOGIN_FAILED,
                entity_type="user",
                entity_id=str(user.id),
                meta={"email": email, "reason": "invalid_password"},
            )
            db.commit()
        raise ValueError("Invalid email or password")

    write_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action=AuditAction.AUTH_LOGIN,
        entity_type="user",
        entity_id=str(user.id),
        after={"email": user.email},
    )
    db.commit()

    return TokenResponse(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
    )


def logout(db: Session, user: User) -> None:
    write_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action=AuditAction.AUTH_LOGOUT,
        entity_type="user",
        entity_id=str(user.id),
    )
    db.commit()


def me(db: Session, user: User) -> MeResponse:
    org = db.get(Organization, user.organization_id)
    assert org is not None
    return MeResponse(
        user=UserOut.model_validate(user),
        organization=OrganizationOut.model_validate(org),
    )
