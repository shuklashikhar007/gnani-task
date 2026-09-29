from fastapi import FastAPI, HTTPException
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from app import guest
from app.db import DbSession

app = FastAPI(title="Audio Notes API")
app.include_router(guest.router)


@app.get("/")
def hello():
    return {"message": "Hello World"}


@app.get("/health")
def health(db: DbSession):
    try:
        db.execute(text("SELECT 1"))
    except OperationalError:
        raise HTTPException(status_code=503, detail="database unavailable")
    return {"status": "ok", "database": "ok"}
