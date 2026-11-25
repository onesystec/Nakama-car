"""Short vehicle name for customer documents (estimate preview, PDF).

The plate lookup fills `version` with the whole engine variant ("Furgonato Trazione anteriore Iniezione
diretta M9T 670;M9T 672;…"): useful in the vehicle record, too long for a document. Here only make and model.
"""
import re

ROMAN = re.compile(r"^[IVX]+$")
MAX_MODEL_WORDS = 3


def _word(word: str) -> str:
    # "MASTER" -> "Master", "MERCEDES-BENZ" -> "Mercedes-Benz"; short codes (BMW, GTI) and numerals stay as they are.
    if word.replace("-", "").isalpha() and word.isupper() and len(word) > 3 and not ROMAN.match(word):
        return "-".join(part.capitalize() for part in word.split("-"))
    return word


def short_vehicle_name(make: str | None, model: str | None, version: str | None = None) -> str | None:
    model_text = re.sub(r"\([^)]*\)", " ", model or "").strip()
    if not model_text and version:
        # No model: the first words of the version, before any engine detail.
        model_text = re.split(r"[;(]", version)[0]
    words = [_word(word) for word in (make or "").split()]
    words += [_word(word) for word in model_text.split()[:MAX_MODEL_WORDS]]
    name = " ".join(words).strip()
    return name or None
