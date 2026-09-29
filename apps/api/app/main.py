from fastapi import FastAPI

app = FastAPI(title="Audio Notes API")


@app.get("/")
def hello():
    return {"message": "Hello World"}
