import type { AuthDeps } from "../auth";
import { getStorage } from "../server-storage";

/** Production wiring for the handler factories in this folder (tests inject their own). */
export const apiDeps: AuthDeps = {
  getStorage,
  get environment() {
    return process.env;
  },
  get production() {
    return process.env.NODE_ENV === "production";
  },
};
