import type { SessionPayload } from "./shared/types";

export const expiryMessage = "Anmeldung erforderlich. Bitte erneut anmelden; dein Entwurf bleibt hier erhalten. Die Anfrage wird nicht automatisch wiederholt.";
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code = "request_failed") { super(message); }
}

// Only memory: no cookies, draft persistence, timers or mutation queues.
let actor: string | null = null;
let blocked = false;
let generation = 0;
export const authenticationRequired = () => blocked;
const emit = (name: string) => window.dispatchEvent(new Event(name));
export function clearIdentity() {
  generation++;
  actor = null;
  blocked = true;
}
function expire() {
  if (!blocked) generation++;
  blocked = true;
  emit("flat-auth-expired");
}
function changed() {
  clearIdentity();
  emit("flat-account-changed");
}

async function decode<T>(response: Response, started: number): Promise<T> {
  // A manual redirect hides its destination. It may be a canonical URL redirect,
  // proxy failure or login; never infer expiry and never replay the request.
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    throw new ApiError("Die Anfrage wurde umgeleitet und nicht wiederholt. Bitte Anmeldung prüfen oder die Seite später neu laden; der Entwurf bleibt hier erhalten.", response.status, "redirect");
  }
  const json = response.headers.get("Content-Type")?.includes("application/json");
  const payload = json ? await response.json().catch(() => null) : null;
  if (started !== generation) throw new ApiError("Die Anmeldung hat sich geändert. Die alte Antwort wurde verworfen.", 0, "stale_response");
  if (response.status === 401) {
    expire();
    throw new ApiError(expiryMessage, 401, "authentication_required");
  }
  if (payload?.code === "identity_changed") {
    changed();
    throw new ApiError("Das angemeldete Konto hat sich geändert. Entwürfe wurden verworfen.", 409, "identity_changed");
  }
  if (!response.ok) throw new ApiError(payload?.error ?? `Anfrage fehlgeschlagen (HTTP ${response.status}).`, response.status, payload?.code);
  if (!payload) throw new ApiError("Der Server hat keine gültige JSON-Antwort geliefert. Die Anfrage wurde nicht wiederholt.", response.status, "invalid_response");
  return payload as T;
}

async function request<T>(path: string, options: RequestInit, sessionCheck = false, recover = true): Promise<T> {
  if (blocked && !sessionCheck) throw new ApiError(expiryMessage, 401, "authentication_required");
  const started = generation;
  const headers = new Headers(options.headers);
  if (actor && !sessionCheck) headers.set("X-Expected-Roommate-Id", actor);
  let response: Response;
  try {
    response = await fetch(path, { ...options, headers, credentials: "same-origin", redirect: "manual", cache: "no-store" });
  } catch {
    throw new ApiError("Verbindung fehlgeschlagen. Der Speicherstand ist unklar; nichts wird automatisch wiederholt.", 0, "network");
  }
  if (started !== generation) throw new ApiError("Die Anmeldung hat sich geändert. Die alte Antwort wurde verworfen.", 0, "stale_response");
  if (response.status === 401 && recover) {
    if (sessionCheck) {
      // Confirm a failed check once before asking the user to sign in.
      return request<T>(path, options, true, false);
    }
    const { accountChanged } = await checkSession();
    if (accountChanged) {
      changed();
      emit("flat-auth-check");
      throw new ApiError("Das angemeldete Konto hat sich geändert. Entwürfe wurden verworfen.", 409, "identity_changed");
    }
    if (started !== generation) throw new ApiError("Die Anmeldung hat sich geändert. Die alte Antwort wurde verworfen.", 0, "stale_response");
    // Only reads may be replayed. Saves/uploads can have ambiguous outcomes.
    if (["GET", "HEAD"].includes((options.method ?? "GET").toUpperCase())) {
      return request<T>(path, options, false, false);
    }
    throw new ApiError("Anmeldung bestätigt. Bitte Speicherstand prüfen und bei Bedarf selbst erneut speichern; nichts wurde automatisch wiederholt.", 401, "authentication_recovered");
  }
  return decode<T>(response, started);
}

type SessionResult = { session: SessionPayload; accountChanged: boolean };
let sessionCheckInFlight: Promise<SessionResult> | null = null;
export function checkSession(): Promise<SessionResult> {
  // Focus events and parallel API failures share one check, not a refresh storm.
  if (!sessionCheckInFlight) {
    sessionCheckInFlight = verifySession().finally(() => { sessionCheckInFlight = null; });
  }
  return sessionCheckInFlight;
}
async function verifySession(): Promise<SessionResult> {
  const previous = actor;
  let session: SessionPayload;
  try {
    session = await request<SessionPayload>("/api/session", {}, true);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) changed();
    throw error;
  }
  if (!session.authenticated || !session.roommate) {
    expire();
    throw new ApiError(expiryMessage, 401, "authentication_required");
  }
  const accountChanged = previous !== null && previous !== session.roommate.id;
  if (accountChanged) generation++;
  actor = session.roommate.id;
  blocked = false;
  emit("flat-auth-restored");
  return { session, accountChanged };
}

export function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");
  return request<T>(path, { ...options, headers });
}
export function apiForm<T = unknown>(path: string, body: FormData, method = "POST"): Promise<T> {
  return request<T>(path, { method, body });
}
