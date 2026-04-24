import html

import bleach

ALLOWED_TAGS: list[str] = []
ALLOWED_ATTRIBUTES: dict = {}


def sanitize_text(value: str | None) -> str | None:
    """Strip HTML tags from free-text input, preserving the plain-text content.

    bleach.clean escapes bare ampersands/angle-brackets to entities as part of
    producing safe HTML. Since we store plain text (and rely on the frontend
    renderer to escape on output), run `html.unescape` afterwards so "A & B"
    round-trips as "A & B" rather than "A &amp; B".
    """
    if value is None:
        return None
    cleaned = bleach.clean(value, tags=ALLOWED_TAGS, attributes=ALLOWED_ATTRIBUTES, strip=True)
    return html.unescape(cleaned)


def sanitize_dict(data: dict) -> dict:
    return {k: sanitize_text(v) if isinstance(v, str) else v for k, v in data.items()}
