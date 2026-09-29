from fastapi import APIRouter

from .dependencies import GuestId

router = APIRouter(tags=["guest"])


@router.get("/whoami")
def whoami(guest_id: GuestId):
    return {"guest_id": guest_id}
