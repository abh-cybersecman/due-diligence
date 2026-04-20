import uuid


def generate_token() -> uuid.UUID:
    return uuid.uuid4()


def generate_token_str() -> str:
    return str(uuid.uuid4())
