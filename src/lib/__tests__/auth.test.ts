import { describe, test, expect, vi, beforeEach } from "vitest";

// Mock server-only so it doesn't throw in test environment
vi.mock("server-only", () => ({}));

// Mock next/headers cookies
const mockCookieStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};
vi.mock("next/headers", () => ({
  cookies: vi.fn(() => Promise.resolve(mockCookieStore)),
}));

import { createSession, getSession, deleteSession, verifySession } from "@/lib/auth";
import { SignJWT } from "jose";
import { NextRequest } from "next/server";

const JWT_SECRET = new TextEncoder().encode("development-secret-key");

async function makeToken(payload: object, expiresIn = "7d") {
  return new SignJWT(payload as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(expiresIn)
    .setIssuedAt()
    .sign(JWT_SECRET);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createSession", () => {
  test("sets an httpOnly cookie with a signed JWT", async () => {
    await createSession("user-1", "test@example.com");

    expect(mockCookieStore.set).toHaveBeenCalledOnce();

    const [name, token, options] = mockCookieStore.set.mock.calls[0];
    expect(name).toBe("auth-token");
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3); // valid JWT structure
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
  });

  test("cookie expiry is ~7 days from now", async () => {
    const before = Date.now();
    await createSession("user-1", "test@example.com");
    const after = Date.now();

    const [, , options] = mockCookieStore.set.mock.calls[0];
    const expiresAt: Date = options.expires;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + sevenDaysMs - 1000);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(after + sevenDaysMs + 1000);
  });
});

describe("getSession", () => {
  test("returns null when no cookie is present", async () => {
    mockCookieStore.get.mockReturnValue(undefined);

    const session = await getSession();
    expect(session).toBeNull();
  });

  test("returns null for an invalid token", async () => {
    mockCookieStore.get.mockReturnValue({ value: "invalid.token.here" });

    const session = await getSession();
    expect(session).toBeNull();
  });

  test("returns null for an expired token", async () => {
    const token = await makeToken(
      { userId: "u1", email: "a@b.com", expiresAt: new Date() },
      "-1s"
    );
    mockCookieStore.get.mockReturnValue({ value: token });

    const session = await getSession();
    expect(session).toBeNull();
  });

  test("returns session payload for a valid token", async () => {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const token = await makeToken({ userId: "u1", email: "a@b.com", expiresAt });
    mockCookieStore.get.mockReturnValue({ value: token });

    const session = await getSession();
    expect(session).not.toBeNull();
    expect(session?.userId).toBe("u1");
    expect(session?.email).toBe("a@b.com");
  });
});

describe("deleteSession", () => {
  test("deletes the auth-token cookie", async () => {
    await deleteSession();

    expect(mockCookieStore.delete).toHaveBeenCalledOnce();
    expect(mockCookieStore.delete).toHaveBeenCalledWith("auth-token");
  });
});

describe("verifySession", () => {
  function makeRequest(token?: string): NextRequest {
    const url = "http://localhost/api/test";
    const headers: HeadersInit = token ? { cookie: `auth-token=${token}` } : {};
    return new NextRequest(url, { headers });
  }

  test("returns null when no cookie is in the request", async () => {
    const req = makeRequest();
    const session = await verifySession(req);
    expect(session).toBeNull();
  });

  test("returns null for an invalid token", async () => {
    const req = makeRequest("bad.token.value");
    const session = await verifySession(req);
    expect(session).toBeNull();
  });

  test("returns null for an expired token", async () => {
    const token = await makeToken(
      { userId: "u1", email: "a@b.com", expiresAt: new Date() },
      "-1s"
    );
    const req = makeRequest(token);
    const session = await verifySession(req);
    expect(session).toBeNull();
  });

  test("returns session payload for a valid token", async () => {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const token = await makeToken({ userId: "u2", email: "b@c.com", expiresAt });
    const req = makeRequest(token);

    const session = await verifySession(req);
    expect(session).not.toBeNull();
    expect(session?.userId).toBe("u2");
    expect(session?.email).toBe("b@c.com");
  });
});
