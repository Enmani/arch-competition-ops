const defaultWorkspaceKey = "local_practice";

export const resolveWorkspaceKey = () => {
  const configuredKey = process.env.ARCH_WORKSPACE_KEY?.trim();
  return configuredKey && configuredKey.length > 0 ? configuredKey : defaultWorkspaceKey;
};

export const isWorkspaceWritesEnabled = () =>
  process.env.ARCH_ENABLE_WORKSPACE_WRITES?.trim().toLowerCase() === "true";
