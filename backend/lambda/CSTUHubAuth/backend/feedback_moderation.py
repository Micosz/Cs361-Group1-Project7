"""Rules shared by public comment reporting and staff moderation.

A reported or hidden comment is never deleted: it only stops appearing in
public and non-moderator lists, and staff can show it again.
"""

REPORT_REASONS = frozenset({'spam', 'abuse', 'personal_data', 'other'})
# Distinct reporters needed before a comment leaves public view pending review.
REPORT_HIDE_THRESHOLD = 3
MODERATION_STATES = frozenset({'hidden', 'visible'})
MODERATOR_ROLES = frozenset({'staff', 'executive'})


def report_count(row):
    value = row.get('reports', 0)
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 0


def publicly_hidden(row):
    """Staff decisions win; otherwise enough independent reports hide a comment."""
    state = row.get('moderation')
    if state == 'hidden':
        return True
    if state == 'visible':
        return False
    return report_count(row) >= REPORT_HIDE_THRESHOLD
