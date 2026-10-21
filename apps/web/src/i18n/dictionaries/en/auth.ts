import type { AppDictionary } from "../types";

export const auth = {
  fields: {
    email: "Email",
    password: "Password",
    passwordConfirmation: "Repeat password",
  },
  login: {
    eyebrow: "Log in",
    title: "Enter workspace",
    description: "Use your email and password to enter the local workspace.",
    submit: "Log in",
    secondaryPrompt: "No account yet?",
    secondaryAction: "Register",
  },
  register: {
    eyebrow: "Register",
    title: "Create account",
    description: "Create an email and password account for workspace state.",
    submit: "Register",
    secondaryPrompt: "Already registered?",
    secondaryAction: "Log in",
  },
  errors: {
    invalid_credentials: "Email or password is incorrect.",
    invalid_email: "Enter a valid email address.",
    missing_fields: "Fill in all fields.",
    password_mismatch: "The two passwords do not match.",
    registration_failed: "We could not register with these details. Check the form, or log in if you already have an account.",
    too_many_attempts: "Too many attempts. Please wait a few minutes and try again.",
    unexpected: "Authentication failed. Try again later.",
    weak_password: "Password must be at least 8 characters.",
  },
} satisfies AppDictionary["auth"];
