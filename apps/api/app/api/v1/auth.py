from fastapi import APIRouter, HTTPException, Request, status

from app.core.deps import CurrentUser, DbSession, bind_audit_request
from app.schemas import LoginRequest, MeResponse, SignupRequest, TokenResponse
from app.services import auth as auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/signup", response_model=TokenResponse)
def signup(payload: SignupRequest, request: Request, db: DbSession) -> TokenResponse:
    bind_audit_request(request)
    try:
        return auth_service.signup(db, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, request: Request, db: DbSession) -> TokenResponse:
    bind_audit_request(request)
    try:
        return auth_service.login(db, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc


@router.post("/logout")
def logout(user: CurrentUser, db: DbSession) -> dict:
    auth_service.logout(db, user)
    return {"ok": True}


@router.get("/me", response_model=MeResponse)
def me(user: CurrentUser, db: DbSession) -> MeResponse:
    return auth_service.me(db, user)
