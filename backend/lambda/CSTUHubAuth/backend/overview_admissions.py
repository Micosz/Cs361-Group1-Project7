"""Aggregate Exchange admission results for the Overview report (#265).

Only counts leave this module: no student names, IDs or answers are returned.
A student counts as confirmed (ยืนยันสิทธิ์) when the result is published as
passed and either the student confirmed (`confirmedAt`) or the round does not
ask for confirmation. Passed students who have not confirmed are reported
separately and never added to the confirmed total. Declined and unpublished
applications are ignored.
"""

ROUND = 'exchangeRound'
APPLICATION = 'exchangeApplication'


def available(repository):
    """Admission rows live in the scope GSI; repositories without it cannot report them."""
    return all(hasattr(repository, name) for name in ('client', 'table', 'index'))


def _confirmed(application, admission):
    if application.get('publishedAt') is None or application.get('decision') != 'passed':
        return None
    if not admission.get('needsConfirmation') or application.get('confirmedAt') is not None:
        return True
    return False


def summarize(repository, exchanges):
    """Return per-Exchange sets of confirmed / awaiting student IDs for the given rows.

    `exchanges` must already be authorized and filtered by the caller. Rounds are
    matched by Exchange ID and scope, applications by round ID and scope.
    """
    from .admission_store import indexed  # Lazy: admission_store imports the gateway.

    wanted = {row['id']: row for row in exchanges if isinstance(row.get('id'), str)}
    result = {key: {'confirmed': set(), 'awaiting': set()} for key in wanted}
    if not wanted:
        return result
    for scope in sorted({row.get('scopeId') for row in wanted.values() if isinstance(row.get('scopeId'), str)}):
        for admission in indexed(repository, scope + '#' + ROUND, ROUND):
            project = wanted.get(admission.get('exchangeId'))
            if not project or admission.get('scopeId') != scope or project.get('scopeId') != scope:
                continue
            bucket = result[project['id']]
            for application in indexed(repository, admission['id'] + '#' + APPLICATION, APPLICATION):
                student = application.get('studentId')
                if (application.get('roundId') != admission['id'] or application.get('scopeId') != scope
                        or not isinstance(student, str) or not student):
                    continue
                state = _confirmed(application, admission)
                if state is True:
                    bucket['confirmed'].add(student)
                elif state is False:
                    bucket['awaiting'].add(student)
    for bucket in result.values():
        bucket['awaiting'] -= bucket['confirmed']  # Confirmed in another round of the same Exchange.
    return result


def totals(buckets, exchange_ids):
    """Unique student counts across the given Exchanges."""
    confirmed, awaiting = set(), set()
    for key in exchange_ids:
        bucket = buckets.get(key)
        if bucket:
            confirmed |= bucket['confirmed']
            awaiting |= bucket['awaiting']
    return len(confirmed), len(awaiting - confirmed)
