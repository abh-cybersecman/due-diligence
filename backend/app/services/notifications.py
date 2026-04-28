async def send_vendor_link(engagement_id: str, email: str) -> None:
    """STUB: Phase 3 — Wire to SMTP"""
    pass


async def send_ir_link(engagement_id: str, email: str) -> None:
    """STUB: Phase 3 — Wire to SMTP"""
    pass


async def send_submission_alert(engagement_id: str) -> None:
    """STUB: Phase 3 — Wire to SMTP"""
    pass


async def send_refresh_dispatch_to_vendor(engagement_id: str, email: str) -> None:
    """STUB: Phase 3 — Wire to SMTP.

    Vendor email for a re-assessment dispatch. Subject line should clarify
    "Re-assessment requested: {application_name}".
    """
    pass


async def send_refresh_notice_to_ir(engagement_id: str, email: str) -> None:
    """STUB: Phase 3 — Wire to SMTP.

    Informational notice to IR that a re-assessment is in progress; uploads
    are optional and do not gate the lifecycle.
    """
    pass
