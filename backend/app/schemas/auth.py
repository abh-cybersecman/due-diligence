from pydantic import BaseModel


class AdminLoginRequest(BaseModel):
    username: str
    password: str


class IRVerifyRequest(BaseModel):
    email: str
    token: str


class VendorVerifyRequest(BaseModel):
    email: str
    token: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
