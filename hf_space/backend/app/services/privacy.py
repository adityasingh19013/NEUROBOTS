"""PII masking and pseudonymous person keys (FR-5, FR-7.5, FR-9)."""
import hashlib
import hmac
import re

from app.config import get_settings

PII_FIELDS = {"full_name", "phone"}


def person_key(phone: str | None, name_norm: str | None, location_norm: str | None) -> str:
    basis = phone or f"{name_norm or ''}|{location_norm or ''}"
    secret = get_settings().hmac_secret.encode()
    return hmac.new(secret, basis.encode(), hashlib.sha256).hexdigest()


def mask_name(name: str | None) -> str | None:
    if not name:
        return name
    return " ".join(w[0] + "*" * (len(w) - 1) for w in str(name).split())


def mask_phone(phone: str | None) -> str | None:
    if phone is None or str(phone).strip() == "":
        return phone
    s = str(phone)
    digits = re.sub(r"\D", "", s)
    if len(digits) < 4:
        return "*" * len(s)
    return "*" * (len(digits) - 4) + digits[-4:]


def mask_value(field: str | None, value):
    if value is None:
        return None
    if field == "full_name":
        return mask_name(str(value))
    if field == "phone":
        return mask_phone(str(value))
    return value


def mask_clean_values(values: dict) -> dict:
    return {k: mask_value(k, v) if k in PII_FIELDS else v for k, v in values.items()}


def mask_raw_values(raw: dict, pii_columns: set[str], column_fields: dict[str, str | None]) -> dict:
    out = {}
    for col, v in raw.items():
        if col in pii_columns:
            field = column_fields.get(col)
            out[col] = mask_value(field if field in PII_FIELDS else "full_name", v) if v is not None else None
        else:
            out[col] = v
    return out
