"use client";

import { createContext, useContext } from "react";

export type AuthMode = "login" | "register";

/** Lets any client component open the sign-in sheet; null outside the site shell (tests, previews). */
export const AuthDialogContext = createContext<((mode: AuthMode) => void) | null>(null);

export const useAuthDialog = () => useContext(AuthDialogContext);
