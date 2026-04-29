import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const createTempDb = () => {
  const directory = mkdtempSync(path.join(tmpdir(), "arch-competition-auth-"));
  return {
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
    dbPath: path.join(directory, "competitions.sqlite"),
  };
};

const loadStorageModule = async () => import(`./index.ts?auth=${Date.now()}-${Math.random()}`);

test("auth users are created with normalized email and hashed passwords", async () => {
  const { dbPath, cleanup } = createTempDb();
  process.env.ARCH_COMPETITION_DB_PATH = dbPath;

  try {
    const {
      authenticateStoredAuthUser,
      countStoredAuthUsers,
      createStoredAuthUser,
    } = await loadStorageModule();

    const user = createStoredAuthUser({
      email: "  Studio@Example.COM ",
      password: "correct-password",
    });

    assert.equal(user.email, "studio@example.com");
    assert.equal(countStoredAuthUsers(), 1);
    assert.equal(
      authenticateStoredAuthUser({
        email: "studio@example.com",
        password: "correct-password",
      })?.id,
      user.id,
    );
    assert.equal(
      authenticateStoredAuthUser({
        email: "studio@example.com",
        password: "wrong-password",
      }),
      null,
    );
  } finally {
    delete process.env.ARCH_COMPETITION_DB_PATH;
    cleanup();
  }
});

test("auth registration rejects duplicate email addresses", async () => {
  const { dbPath, cleanup } = createTempDb();
  process.env.ARCH_COMPETITION_DB_PATH = dbPath;

  try {
    const { StoredAuthError, createStoredAuthUser } = await loadStorageModule();

    createStoredAuthUser({
      email: "studio@example.com",
      password: "correct-password",
    });

    assert.throws(
      () =>
        createStoredAuthUser({
          email: "STUDIO@example.com",
          password: "correct-password",
        }),
      (error) => error instanceof StoredAuthError && error.code === "email_taken",
    );
  } finally {
    delete process.env.ARCH_COMPETITION_DB_PATH;
    cleanup();
  }
});

test("auth sessions can be read and deleted", async () => {
  const { dbPath, cleanup } = createTempDb();
  process.env.ARCH_COMPETITION_DB_PATH = dbPath;

  try {
    const {
      createStoredAuthSession,
      createStoredAuthUser,
      deleteStoredAuthSession,
      getStoredAuthSession,
    } = await loadStorageModule();

    const user = createStoredAuthUser({
      email: "studio@example.com",
      password: "correct-password",
    });
    const { token } = createStoredAuthSession({ userId: user.id });

    assert.equal(getStoredAuthSession(token)?.user.email, "studio@example.com");
    assert.equal(deleteStoredAuthSession(token), true);
    assert.equal(getStoredAuthSession(token), null);
  } finally {
    delete process.env.ARCH_COMPETITION_DB_PATH;
    cleanup();
  }
});

test("expired auth sessions are ignored", async () => {
  const { dbPath, cleanup } = createTempDb();
  process.env.ARCH_COMPETITION_DB_PATH = dbPath;

  try {
    const { createStoredAuthSession, createStoredAuthUser, getStoredAuthSession } =
      await loadStorageModule();

    const user = createStoredAuthUser({
      email: "studio@example.com",
      password: "correct-password",
    });
    const { token } = createStoredAuthSession({
      expiresAt: "2000-01-01T00:00:00.000Z",
      userId: user.id,
    });

    assert.equal(getStoredAuthSession(token), null);
  } finally {
    delete process.env.ARCH_COMPETITION_DB_PATH;
    cleanup();
  }
});
