"""Who works where: work area of each user (meccanica / carrozzeria) and what they see."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.identity import Role, UserRole
from app.models.staff import UserProfile

AREAS = ("BODY", "MECHANICAL")
# Role -> area of the workshop. Roles not listed (admin, reception, accounting) see everything.
ROLE_AREA = {"MECHANIC": "MECHANICAL", "BODYSHOP": "BODY", "PAINTER": "BODY"}

MECHANICAL_TASKS = {"ACCEPTANCE", "DIAGNOSTIC", "PARTS", "MECHANICAL_REPAIR", "ROAD_TEST", "ITEM_MECHANICAL"}
BODY_TASKS = {"DISASSEMBLY", "BODY_REPAIR", "PAINT_PREP", "PAINT", "ASSEMBLY", "ITEM_BODY"}


def user_roles(db: Session, user_id, tenant_id) -> list[str]:
    return sorted(db.scalars(
        select(Role.code).join(UserRole, UserRole.role_id == Role.id)
        .where(UserRole.user_id == user_id, UserRole.tenant_id == tenant_id, Role.tenant_id == tenant_id)
    ).all())


def area_for(roles: list[str], profile: UserProfile | None = None) -> str | None:
    """BODY, MECHANICAL or None (sees both). A profile override wins over the role."""
    if profile is not None and profile.work_area in AREAS:
        return profile.work_area
    if profile is not None and profile.work_area == "ALL":  # chosen by the main account: sees both
        return None
    if "ADMIN" in roles or "RECEPTION" in roles:
        return None
    areas = {ROLE_AREA[role] for role in roles if role in ROLE_AREA}
    return areas.pop() if len(areas) == 1 else None


def user_area(db: Session, user_id, tenant_id) -> str | None:
    profile = db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
    return area_for(user_roles(db, user_id, tenant_id), profile)


def task_in_area(task_type: str, area: str | None) -> bool:
    """Mechanics see mechanical steps, bodyshop the body/paint ones; shared steps for everybody."""
    if area == "MECHANICAL":
        return task_type not in BODY_TASKS
    if area == "BODY":
        return task_type not in MECHANICAL_TASKS
    return True


def normalize_plate(value: str | None) -> str:
    return "".join(ch for ch in (value or "").upper() if ch.isalnum())


WORKSHOP_ROLES = set(ROLE_AREA)


def is_workshop_worker(db: Session, user_id, tenant_id) -> bool:
    """Mechanic, bodyshop or painter (by role, or by a work area chosen in the profile)."""
    roles = set(user_roles(db, user_id, tenant_id))
    if not roles:  # not a user of this workshop
        return False
    if WORKSHOP_ROLES & roles:
        return True
    profile = db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
    return profile is not None and profile.work_area in AREAS


def claim_case(db: Session, case, user_id) -> bool:
    """The worker who presses «Realizza lavoro» stays on the case to the end of the job.

    Does nothing when the case already has someone: only the office changes it (PUT /cases/{id}/mechanic).
    """
    from datetime import datetime, timezone

    if case is None or case.mechanic_id is not None or user_id is None:
        return False
    if not is_workshop_worker(db, user_id, case.tenant_id):
        return False
    case.mechanic_id, case.mechanic_assigned_at = user_id, datetime.now(timezone.utc)
    return True
