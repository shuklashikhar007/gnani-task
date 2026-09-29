from fastapi import FastAPI

from app import guest

app = FastAPI(title="Audio Notes API")
app.include_router(guest.router)


@app.get("/")
def hello():
    return {"message": "Hello World"}
