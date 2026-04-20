import bleach

ALLOWED_TAGS: list[str] = []
ALLOWED_ATTRIBUTES: dict = {}


def sanitize_text(value: str | None) -> str | None:
    if value is None:
        return None
    return bleach.clean(value, tags=ALLOWED_TAGS, attributes=ALLOWED_ATTRIBUTES, strip=True)


def sanitize_dict(data: dict) -> dict:
    return {k: sanitize_text(v) if isinstance(v, str) else v for k, v in data.items()}
