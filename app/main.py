"""FastAPI application entry point."""
import logging

from fastapi import FastAPI
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.limiter_shared import limiter
from app.routers import bazon as bazon_router
from app.routers import collaps as collaps_router
from app.routers import hdrezka as hdrezka_router
from app.routers import zetflix as zetflix_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Easy-Mod Backend", version="2.0.0")

# Attach rate limiter
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Include routers
app.include_router(hdrezka_router.router)
app.include_router(zetflix_router.router)
app.include_router(collaps_router.router)
app.include_router(bazon_router.router)


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"ok": True, "service": "easy-mod-backend"}
