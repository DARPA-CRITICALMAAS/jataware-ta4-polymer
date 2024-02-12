import logging
from logging import Logger
from time import perf_counter
from typing import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from starlette.middleware.cors import CORSMiddleware

logger: Logger = logging.getLogger(__name__)


def setup_middleware(api: FastAPI) -> None:
    api.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @api.middleware("http")
    async def add_request_time_header(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        start_request = perf_counter()
        response = await call_next(request)
        response_time = perf_counter() - start_request
        response.headers["x-app-response-time"] = f"{response_time:.8f}"
        return response
