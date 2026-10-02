from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    """Base class for ORM models."""


def get_db() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session # create a session and then usko yield karege to use this session in other parts of the code

# this variable when imported in any file will import Session and get_db function 
DbSession = Annotated[Session, Depends(get_db)]
