"""Raw request bodies (photos, logos, documents, fleet files) read with a size cap.

The body is read piece by piece and refused as soon as it passes the cap, so a request without a
Content-Length header cannot fill the server's memory.
"""
from fastapi import HTTPException, Request

MAX_BODY_BYTES = 15 * 1024 * 1024


async def read_body(request: Request, limit: int = MAX_BODY_BYTES, message: str = "File troppo grande (max 15 MB).") -> bytes:
    if int(request.headers.get("content-length") or 0) > limit:
        raise HTTPException(status_code=413, detail=message)
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise HTTPException(status_code=413, detail=message)
        chunks.append(chunk)
    return b"".join(chunks)
