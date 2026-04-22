from fastapi import HTTPException

from app.models.engagement import EngagementStatus

VALID_TRANSITIONS: dict[EngagementStatus, list[EngagementStatus]] = {
    EngagementStatus.DRAFT: [
        EngagementStatus.FUNCTIONAL_EVALUATION_PENDING,
    ],
    EngagementStatus.FUNCTIONAL_EVALUATION_PENDING: [
        EngagementStatus.PENDING_DISPATCH,
    ],
    EngagementStatus.PENDING_DISPATCH: [
        EngagementStatus.DD_IN_PROGRESS,
    ],
    EngagementStatus.DD_IN_PROGRESS: [
        EngagementStatus.RISK_ASSESSMENT_PENDING,
    ],
    EngagementStatus.RISK_ASSESSMENT_PENDING: [
        EngagementStatus.CLOSED,
        EngagementStatus.PENDING_CLOSURE,
        EngagementStatus.DD_IN_PROGRESS,  # admin reopen
    ],
    EngagementStatus.PENDING_CLOSURE: [
        EngagementStatus.CLOSED,
        EngagementStatus.UNDER_REVIEW,
    ],
    EngagementStatus.CLOSED: [
        EngagementStatus.UNDER_REVIEW,
    ],
    EngagementStatus.UNDER_REVIEW: [
        EngagementStatus.CLOSED,
        EngagementStatus.PENDING_CLOSURE,
    ],
    EngagementStatus.CANCELLED: [
        EngagementStatus.DRAFT,  # admin reopens
    ],
}


def validate_transition(from_status: EngagementStatus, to_status: EngagementStatus) -> None:
    allowed = VALID_TRANSITIONS.get(from_status, [])
    if to_status not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid transition: {from_status.value} → {to_status.value}",
        )
