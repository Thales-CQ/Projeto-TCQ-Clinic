import { getCepIntegrationStatus, publishCepIntegrationStatus } from "./cepIntegrationStatus.js";

const API_URL = "/api/v1";
let csrfToken = null;
let sessionCheck = null;
let authQueue = Promise.resolve();
const unauthorizedListeners = new Set();

export function onUnauthorized(listener) {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

function enqueueAuth(task) {
  const result = authQueue.then(task);
  authQueue = result.catch(() => {});
  return result;
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      credentials: "same-origin",
    });
  } catch {
    throw new Error("Não foi possível conectar ao servidor. Tente novamente.");
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("Resposta inesperada do servidor. Tente novamente.");
  }
  if (typeof data?.csrf_token === "string") csrfToken = data.csrf_token;
  if (response.status === 403 && data?.error === "Token CSRF inválido.") {
    csrfToken = null;
  }
  if (response.status === 401) {
    unauthorizedListeners.forEach((listener) => listener());
  }
  return { response, data };
}

function apiError(response, data) {
  const error = new Error(data?.error || "Não foi possível concluir a operação.");
  error.status = response.status;
  error.isCsrf = response.status === 403 && data?.error === "Token CSRF inválido.";
  if (data?.errors && typeof data.errors === "object") {
    error.errors = data.errors;
  }
  return error;
}

async function readSession() {
  const { response, data } = await request("/auth/me");
  if (response.status === 401) return null;
  if (!response.ok) throw apiError(response, data);
  return data.user;
}

export function getSession() {
  // StrictMode subscribers share one in-flight check; auth requests are ordered.
  if (!sessionCheck) {
    sessionCheck = enqueueAuth(readSession).finally(() => {
      sessionCheck = null;
    });
  }
  return sessionCheck;
}

function postAuth(path, body) {
  return enqueueAuth(async () => {
    if (!csrfToken) await readSession();
    const { response, data } = await request(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify(body ?? {}),
    });
    if (!response.ok) throw apiError(response, data);
    return data;
  });
}

export function login(username, password) {
  return postAuth("/auth/login", { username, password });
}

export function logout() {
  return postAuth("/auth/logout");
}

export async function healthCheck() {
  const { response, data } = await request("/health");
  if (!response.ok) throw apiError(response, data);
  return data;
}

export async function getPatients(page = 1, perPage = 20, search = "") {
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(perPage),
  });
  const normalizedSearch = String(search ?? "").trim();
  if (normalizedSearch) params.set("search", normalizedSearch);

  const { response, data } = await request(`/patients?${params.toString()}`);
  if (!response.ok) throw apiError(response, data);
  return data;
}

export async function getTodayBirthdays() {
  const { response, data } = await request("/patients/birthdays/today");
  if (!response.ok) throw apiError(response, data);
  return data;
}

export async function getPatient(patientId) {
  const { response, data } = await request(`/patients/${patientId}`);
  if (!response.ok) throw apiError(response, data);
  return data;
}

export async function updatePatient(patientId, payload) {
  if (!csrfToken) await readSession();
  const { response, data } = await request(`/patients/${patientId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw apiError(response, data);
  return data;
}

export async function updatePatientStatus(patientId, isActive) {
  if (!csrfToken) await readSession();
  const { response, data } = await request(`/patients/${patientId}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({ is_active: isActive }),
  });
  if (!response.ok) throw apiError(response, data);
  return data;
}

export async function createPatient(payload) {
  if (!csrfToken) await readSession();
  const { response, data } = await request("/patients", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw apiError(response, data);
  return data;
}


export function updateTheme(theme) {
  return enqueueAuth(async () => {
    if (!csrfToken) await readSession();
    const { response, data } = await request("/auth/me/preferences", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify({ theme }),
    });
    if (!response.ok) throw apiError(response, data);
    return data;
  });
}


export async function getPreferences(signal) {
  const { response, data } = await request(`/auth/me/preferences?sync=${Date.now()}`, {
    signal,
    cache: "no-store",
  });
  if (!response.ok) throw apiError(response, data);
  return data;
}

function integrationError(response, data) {
  const error = data?.error;
  const result = new Error(
    typeof error === "string"
      ? error
      : error?.message || "Não foi possível concluir a operação.",
  );
  result.status = response.status;
  result.code = error?.code;
  return result;
}

export const CEP_CONFIGURATION_FIELDS = Object.freeze([
  "provider_name",
  "url_template",
  "method",
  "field_map",
  "auth_header",
  "auth_prefix",
  "is_active",
]);

export function buildCepConfigurationPayload(configuration, { includeActivation = true } = {}) {
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) return {};
  const payload = {};
  for (const field of CEP_CONFIGURATION_FIELDS) {
    if (field === "is_active" && !includeActivation) continue;
    if (Object.hasOwn(configuration, field)) payload[field] = configuration[field];
  }
  return payload;
}

export async function getCepIntegration() {
  publishCepIntegrationStatus(null);
  try {
    const { response, data } = await request("/integrations/cep", { cache: "no-store" });
    if (!response.ok) throw integrationError(response, data);
    const integration = data.integration;
    publishCepIntegrationStatus(typeof integration?.is_active === "boolean" ? integration.is_active : null);
    return integration;
  } catch (error) {
    publishCepIntegrationStatus(null);
    throw error;
  }
}

function writeCepIntegration(path, payload) {
  return enqueueAuth(async () => {
    if (!csrfToken) await readSession();
    const { response, data } = await request(path, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw integrationError(response, data);
    const integration = data.integration;
    if (path === "/integrations/cep/configuration" && Object.hasOwn(payload, "is_active")) {
      publishCepIntegrationStatus(typeof integration?.is_active === "boolean" ? integration.is_active : null);
    }
    return integration;
  });
}

export function saveCepConfiguration(configuration) {
  return writeCepIntegration(
    "/integrations/cep/configuration",
    buildCepConfigurationPayload(configuration),
  );
}

export function saveCepCredential(credential) {
  return writeCepIntegration("/integrations/cep/credential", { credential });
}

export async function lookupCep(cep, { signal } = {}) {
  const active = getCepIntegrationStatus();
  if (active !== true) {
    const error = new Error(active === false
      ? "Consulta de CEP está desativada."
      : "O status da consulta de CEP ainda não foi confirmado.");
    error.status = active === false ? 409 : 503;
    error.code = active === false ? "integration_disabled" : "integration_status_unknown";
    throw error;
  }
  const params = new URLSearchParams({ cep });
  const { response, data } = await request(`/integrations/cep/lookup?${params.toString()}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const error = integrationError(response, data);
    if (error.status === 409 && error.code === "integration_disabled") {
      publishCepIntegrationStatus(false);
    }
    throw error;
  }
  return data.address;
}

// User writes share the authentication queue so session/CSRF rotation cannot
// overtake a password or account update made by this tab.
function writeUser(path, method, payload) {
  return enqueueAuth(async () => {
    if (!csrfToken) await readSession();
    const { response, data } = await request(path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw apiError(response, data);
    return data;
  });
}

export async function getUsers() {
  const { response, data } = await request("/users", { cache: "no-store" });
  if (!response.ok) throw apiError(response, data);
  return data;
}

export async function getUser(userId) {
  const { response, data } = await request(`/users/${userId}`, { cache: "no-store" });
  if (!response.ok) throw apiError(response, data);
  return data;
}

export function createUser(payload) {
  return writeUser("/users", "POST", payload);
}

export function updateUser(userId, payload) {
  return writeUser(`/users/${userId}`, "PATCH", payload);
}

export function updateUserStatus(userId, isActive) {
  return writeUser(`/users/${userId}/status`, "PATCH", { is_active: isActive });
}

export function resetUserPassword(userId, newPassword) {
  return writeUser(`/users/${userId}/password`, "PATCH", { new_password: newPassword });
}

export async function getProfiles() {
  const { response, data } = await request("/profiles", { cache: "no-store" });
  if (!response.ok) throw apiError(response, data);
  return data;
}

export async function getAssignableProfiles() {
  const { response, data } = await request("/users/assignable-profiles", { cache: "no-store" });
  if (!response.ok) throw apiError(response, data);
  return data;
}

export async function getProfile(profileId) {
  const { response, data } = await request(`/profiles/${profileId}`, { cache: "no-store" });
  if (!response.ok) throw apiError(response, data);
  return data;
}

export async function getPermissionCatalog() {
  const { response, data } = await request("/profiles/permissions", { cache: "no-store" });
  if (!response.ok) throw apiError(response, data);
  return data;
}

export function createProfile(payload) {
  return writeUser("/profiles", "POST", payload);
}

export function updateProfile(profileId, payload) {
  return writeUser(`/profiles/${profileId}`, "PATCH", payload);
}

export function changeOwnPassword(currentPassword, newPassword) {
  return writeUser("/auth/me/password", "PATCH", {
    current_password: currentPassword,
    new_password: newPassword,
  });
}
