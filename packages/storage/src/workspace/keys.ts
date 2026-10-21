import { StorageValidationError } from "../domain-errors";

/**
 * Workspaces are private to one user: the key is derived from the authenticated user id here
 * and nowhere else. The key is never accepted from a request.
 */
export const workspaceKeyForUser = (userId: string) => {
  const normalized = userId.trim();
  if (!normalized) {
    throw new StorageValidationError("A user id is required to derive a workspace key");
  }
  return `user:${normalized}`;
};

export const requireWorkspaceKey = (workspaceKey: string) => {
  const normalized = workspaceKey.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 200) {
    throw new StorageValidationError("A valid workspace key is required");
  }
  return normalized;
};

export const requireOpportunityId = (opportunityId: string) => {
  const normalized = opportunityId.trim();
  if (!normalized || normalized.length > 500) {
    throw new StorageValidationError("A valid opportunity id is required");
  }
  return normalized;
};
