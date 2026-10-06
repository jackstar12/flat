import { beforeEach, describe, expect, it, vi } from "vitest";

let client: typeof import("./api");
let events: EventTarget;
const session = (id = "kran") => Response.json({ authenticated: true, roommate: { id } });
beforeEach(async () => {
  vi.resetModules();
  events = new EventTarget();
  vi.stubGlobal("window", events);
  client = await import("./api");
});

describe("auth-aware requests without replay", () => {
  it("treats JSON and multipart 401 alike and blocks later actions until a session check", async () => {
    const expired = vi.fn(); events.addEventListener("flat-auth-expired", expired);
    const fetcher = vi.fn().mockResolvedValueOnce(session()).mockResolvedValue(Response.json({ error: "Authentication required" }, { status: 401 }));
    vi.stubGlobal("fetch", fetcher);
    await client.checkSession();
    await expect(client.apiForm("/api/finance/receipt/analyze", new FormData())).rejects.toMatchObject({ code: "authentication_required" });
    await expect(client.api("/api/finance/expenses", { method: "POST" })).rejects.toMatchObject({ status: 401 });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(expired).toHaveBeenCalledOnce();
    fetcher.mockResolvedValueOnce(session());
    await client.checkSession();
    expect(fetcher).toHaveBeenCalledTimes(5); // no replay after recovery
  });
  it.each(["redirect", "html", "provider"])("does not call %s a user-session expiry", async (failure) => {
    const expired = vi.fn(); events.addEventListener("flat-auth-expired", expired);
    const response = failure === "redirect" ? { type: "opaqueredirect", status: 0 } : failure === "html" ? new Response("<html>login</html>", { headers: { "Content-Type": "text/html" } }) : Response.json({ error: "Service unavailable", code: "inference_unavailable" }, { status: 502 });
    const fetcher = vi.fn().mockResolvedValue(response); vi.stubGlobal("fetch", fetcher);
    await expect(client.api("/api/test")).rejects.toBeInstanceOf(client.ApiError);
    expect(expired).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledOnce();
  });
  it("sends the remembered actor and leaves the multipart boundary to the browser", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(session()).mockResolvedValueOnce(Response.json({ ok: true })); vi.stubGlobal("fetch", fetcher);
    await client.checkSession(); await client.apiForm("/api/finance/receipt/analyze/", new FormData());
    const options = fetcher.mock.calls[1][1];
    expect(options.headers.get("X-Expected-Roommate-Id")).toBe("kran");
    expect(options.headers.has("Content-Type")).toBe(false);
    expect(options.redirect).toBe("manual");
  });
  it("invalidates an in-flight response after logout", async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((done) => { resolve = done; })));
    const pending = client.api("/api/finance"); client.clearIdentity(); resolve(Response.json({ private: true }));
    await expect(pending).rejects.toMatchObject({ code: "stale_response" });
  });
  it("reports an account switch and rejects mismatched actions without retry", async () => {
    const changed = vi.fn(); events.addEventListener("flat-account-changed", changed);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(session()).mockResolvedValueOnce(session("stadlmann")).mockResolvedValueOnce(Response.json({ code: "identity_changed" }, { status: 409 })));
    await client.checkSession(); expect((await client.checkSession()).accountChanged).toBe(true);
    await expect(client.api("/api/test", { method: "POST" })).rejects.toMatchObject({ code: "identity_changed" });
    expect(changed).toHaveBeenCalledOnce();
  });
});

it("a session access denial clears prior identity without mislabeling it as expiry", async () => {
  const changed = vi.fn(); events.addEventListener("flat-account-changed", changed);
  const expired = vi.fn(); events.addEventListener("flat-auth-expired", expired);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(session()).mockResolvedValueOnce(Response.json({ error: "No mapping" }, { status: 403 })));
  await client.checkSession();
  await expect(client.checkSession()).rejects.toMatchObject({ status: 403 });
  expect(changed).toHaveBeenCalledOnce(); expect(expired).not.toHaveBeenCalled();
  expect(client.authenticationRequired()).toBe(true);
});

it("quietly recovers a transient read 401 and retries that read once", async () => {
  const expired = vi.fn(); events.addEventListener("flat-auth-expired", expired);
  const fetcher = vi.fn().mockResolvedValueOnce(session())
    .mockResolvedValueOnce(Response.json({}, { status: 401 }))
    .mockResolvedValueOnce(session()).mockResolvedValueOnce(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetcher);
  await client.checkSession();
  expect(await client.api("/api/finance")).toEqual({ ok: true });
  expect(fetcher.mock.calls.map(([path]) => path)).toEqual(["/api/session", "/api/finance", "/api/session", "/api/finance"]);
  expect(expired).not.toHaveBeenCalled();
  expect(client.authenticationRequired()).toBe(false);
});

it("restores authentication after a transient upload 401 without replaying the upload", async () => {
  const expired = vi.fn(); events.addEventListener("flat-auth-expired", expired);
  const fetcher = vi.fn().mockResolvedValueOnce(session())
    .mockResolvedValueOnce(Response.json({}, { status: 401 })).mockResolvedValueOnce(session());
  vi.stubGlobal("fetch", fetcher); await client.checkSession();
  await expect(client.apiForm("/api/finance/receipt/analyze", new FormData())).rejects.toMatchObject({ code: "authentication_recovered" });
  expect(fetcher.mock.calls.filter(([path]) => path === "/api/finance/receipt/analyze")).toHaveLength(1);
  expect(expired).not.toHaveBeenCalled(); expect(client.authenticationRequired()).toBe(false);
});

it("confirms a transient session-check 401 without an expiry flash", async () => {
  const expired = vi.fn(); events.addEventListener("flat-auth-expired", expired);
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({}, { status: 401 })).mockResolvedValueOnce(session());
  vi.stubGlobal("fetch", fetcher);
  expect((await client.checkSession()).session.authenticated).toBe(true);
  expect(expired).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(2);
});

it("shares simultaneous session checks and discards their result after logout", async () => {
  let resolve!: (response: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>((done) => { resolve = done; }));
  vi.stubGlobal("fetch", fetcher);
  const first = client.checkSession(), second = client.checkSession();
  expect(first).toBe(second); client.clearIdentity(); resolve(session());
  await expect(first).rejects.toMatchObject({ code: "stale_response" });
  expect(fetcher).toHaveBeenCalledOnce(); expect(client.authenticationRequired()).toBe(true);
});

it("never retries a read under a different account during recovery", async () => {
  const changed = vi.fn(); events.addEventListener("flat-account-changed", changed);
  const fetcher = vi.fn().mockResolvedValueOnce(session())
    .mockResolvedValueOnce(Response.json({}, { status: 401 })).mockResolvedValueOnce(session("stadlmann"));
  vi.stubGlobal("fetch", fetcher); await client.checkSession();
  await expect(client.api("/api/finance")).rejects.toMatchObject({ code: "identity_changed" });
  expect(changed).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledTimes(3);
});

it("bounds recovery when a read still returns 401 after a successful check", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(session())
    .mockResolvedValueOnce(Response.json({}, { status: 401 })).mockResolvedValueOnce(session())
    .mockResolvedValueOnce(Response.json({}, { status: 401 }));
  vi.stubGlobal("fetch", fetcher); await client.checkSession();
  await expect(client.api("/api/finance")).rejects.toMatchObject({ code: "authentication_required" });
  expect(fetcher).toHaveBeenCalledTimes(4); expect(client.authenticationRequired()).toBe(true);
});
