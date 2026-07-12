from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.client import Client
    from app.models.user import User


class Organization(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Tenant / security boundary.

    Today: a single workspace. Future CA firm: one organization owns many clients (SMEs).
    Users always belong to an organization (unchanged).
    """

    __tablename__ = "organizations"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)

    users: Mapped[list[User]] = relationship(back_populates="organization")
    clients: Mapped[list[Client]] = relationship(back_populates="organization")
