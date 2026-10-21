/**
 * The single rule for how participation fees are described.
 *
 * Truth rule (AGENTS.md rule 4): an unknown fee is NULL and must read as "pending".
 * Only an explicit 0 means "no participation fee". Storage builds its English fallback
 * label from this function and the web app builds its localised label from the same
 * result, so the rule cannot drift between layers again.
 */
export type ParticipationFee =
  | { kind: "pending" }
  | { kind: "free" }
  | { kind: "amounts"; registrationEur: number | null; submissionEur: number | null };

export const describeParticipationFee = (
  registrationEur: number | null | undefined,
  submissionEur: number | null | undefined,
): ParticipationFee => {
  const registration = registrationEur ?? null;
  const submission = submissionEur ?? null;
  if (registration === null && submission === null) {
    return { kind: "pending" };
  }
  if (registration === 0 && submission === 0) {
    return { kind: "free" };
  }
  return { kind: "amounts", registrationEur: registration, submissionEur: submission };
};
