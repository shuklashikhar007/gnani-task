import os
import uuid
from typing import Annotated

from fastapi import Depends, Request, Response

GUEST_COOKIE = "guest_id"
GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 365  # 1 year
IS_PROD = os.getenv("ENV") == "production"


def get_guest_id(request: Request, response: Response) -> str:
    """Return the caller's guest_id, issuing a new cookie if it's missing or invalid."""
    guest_id = request.cookies.get(GUEST_COOKIE)
    try:
        return str(uuid.UUID(guest_id))
    except (TypeError, ValueError):
        pass

    guest_id = str(uuid.uuid4())
    response.set_cookie(
        key=GUEST_COOKIE,
        value=guest_id,
        max_age=GUEST_COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=IS_PROD,
    )
    return guest_id


GuestId = Annotated[str, Depends(get_guest_id)]
