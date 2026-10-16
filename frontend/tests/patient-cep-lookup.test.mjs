import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPatientCepLookup, formatPostalCode } from "../src/features/patients/state/patientCepLookup.js";

function fakeTimers() {
  let nextId = 1;
  const tasks = new Map();
  return {
    schedule(callback, delay) {
      const id = nextId++;
      tasks.set(id, { callback, delay });
      return id;
    },
    cancel(id) { tasks.delete(id); },
    async run(id) {
      const task = tasks.get(id);
      assert.ok(task, `timer ${id} is scheduled`);
      tasks.delete(id);
      return task.callback();
    },
    ids() { return [...tasks.keys()]; },
    delay(id) { return tasks.get(id)?.delay; },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function makeLookup({ lookup, debounceMs = 350 } = {}) {
  const timers = fakeTimers();
  const statuses = [];
  const results = [];
  const controller = createPatientCepLookup({
    lookup: lookup || (async () => ({ address: "Praça da Sé", city: "São Paulo", state: "SP" })),
    onResult: (result) => results.push(result),
    onStatus: (status) => statuses.push(status),
    debounceMs,
    schedule: timers.schedule,
    cancel: timers.cancel,
  });
  return { controller, timers, statuses, results };
}

test("formats CEP consistently and debounces only complete values", async () => {
  const calls = [];
  const { controller, timers, statuses } = makeLookup({ lookup: async (cep) => {
    calls.push(cep);
    return { address: "Praça da Sé", city: "São Paulo", state: "SP" };
  } });
  assert.equal(formatPostalCode("01001000"), "01001-000");
  assert.equal(formatPostalCode("01001-"), "01001");
  controller.setCep("01001-");
  assert.deepEqual(timers.ids(), []);
  controller.setCep("01001-000");
  const [timer] = timers.ids();
  assert.equal(timers.delay(timer), 350);
  await timers.run(timer);
  assert.deepEqual(calls, ["01001000"]);
  assert.equal(statuses.at(-1).kind, "success");
});

test("does not schedule a lookup while CEP integration is disabled", async () => {
  const calls = [];
  const { controller, timers } = makeLookup({ lookup: async (cep) => { calls.push(cep); return {}; } });
  controller.setEnabled(false);
  controller.setCep("01001-000");
  assert.deepEqual(timers.ids(), []);
  assert.deepEqual(calls, []);
});

test("an active CEP integration continues to look up and a 409 offers manual entry quietly", async () => {
  const calls = [];
  const active = makeLookup({ lookup: async (cep) => {
    calls.push(cep);
    return { address: "Rua Nova", city: "Recife", state: "PE" };
  } });
  active.controller.setEnabled(true);
  active.controller.setCep("50000-000");
  await active.timers.run(active.timers.ids()[0]);
  assert.deepEqual(calls, ["50000000"]);
  assert.equal(active.statuses.at(-1).kind, "success");

  const disabled = Object.assign(new Error("Consulta desativada."), { status: 409, code: "integration_disabled" });
  const result = makeLookup({ lookup: async () => { throw disabled; } });
  result.controller.setCep("01001-000");
  await result.timers.run(result.timers.ids()[0]);
  assert.equal(result.statuses.at(-1).kind, "disabled");
  assert.match(result.statuses.at(-1).message, /manualmente/i);
  result.controller.setCep("01001-000");
  assert.deepEqual(result.timers.ids(), []);
});

test("deactivation cancels pending and in-flight lookups; reactivation schedules the current CEP again", async () => {
  const pendingResponse = deferred();
  const calls = [];
  const signals = [];
  const { controller, timers, results } = makeLookup({ lookup(cep, { signal } = {}) {
    calls.push(cep);
    signals.push(signal);
    return calls.length === 1
      ? pendingResponse.promise
      : Promise.resolve({ address: "Rua Nova", city: "Recife", state: "PE" });
  } });
  controller.setCep("01001-000");
  controller.setEnabled(false);
  assert.deepEqual(timers.ids(), []);
  assert.deepEqual(calls, []);

  controller.setEnabled(true);
  const request = timers.run(timers.ids()[0]);
  assert.deepEqual(calls, ["01001000"]);
  controller.setEnabled(false);
  assert.equal(signals[0].aborted, true);
  pendingResponse.resolve({ address: "Endereço antigo", city: "São Paulo", state: "SP" });
  await request;
  assert.deepEqual(results, []);

  controller.setEnabled(true);
  await timers.run(timers.ids()[0]);
  assert.deepEqual(calls, ["01001000", "01001000"]);
  assert.deepEqual(results, [{ address: "Rua Nova", city: "Recife", state: "PE" }]);
});

test("patient create and edit forms gate automatic lookup on the persisted integration status", async () => {
  const hook = await readFile(new URL(
    "../src/features/patients/hooks/usePatientForm.js",
    import.meta.url,
  ), "utf8");
  assert.match(hook, /getCepIntegration\(\)\.catch/);
  assert.match(hook, /subscribeCepIntegrationStatus\(\(status\)/);
  assert.match(hook, /cepLookup\.current\.setEnabled\(status === true\)/);
  assert.match(hook, /lookup: lookupCep/);
  assert.match(hook, /mode = "create"/);
  assert.match(hook, /enabled: false/);
  assert.match(hook, /getCepIntegration\(\)\.catch/);
  const form = await readFile(new URL(
    "../src/features/patients/components/PatientForm.jsx",
    import.meta.url,
  ), "utf8");
  for (const field of ["postal-code", "address", "address-number", "city", "state"]) {
    assert.match(form, new RegExp(`patient-${field}`));
  }
  assert.match(form, /disabled=\{saving \|\| busy\}/);
});

test("inactive or unconfirmed server status prevents all lookup endpoint calls", async () => {
  const { getCepIntegration, lookupCep } = await import("../src/services/api.js?cep-lookup-gate");
  const { publishCepIntegrationStatus } = await import("../src/services/cepIntegrationStatus.js");
  const originalFetch = globalThis.fetch;
  const calls = [];
  let isActive = false;
  globalThis.fetch = async (path) => {
    calls.push(path);
    if (path === "/api/v1/integrations/cep") {
      return { ok: true, status: 200, json: async () => ({ integration: { is_active: isActive } }) };
    }
    assert.fail(`lookup endpoint must not be called while inactive or unconfirmed: ${path}`);
  };
  try {
    await getCepIntegration();
    const { getCepIntegrationStatus } = await import("../src/services/cepIntegrationStatus.js");
    assert.equal(getCepIntegrationStatus(), false);
    await assert.rejects(lookupCep("01001000"), (error) => (
      error.status === 409 && error.code === "integration_disabled"
    ));
    assert.deepEqual(calls, ["/api/v1/integrations/cep"]);

    publishCepIntegrationStatus(null);
    await assert.rejects(lookupCep("01001000"), (error) => (
      error.status === 503 && error.code === "integration_status_unknown"
    ));
    assert.deepEqual(calls, ["/api/v1/integrations/cep"]);
  } finally {
    globalThis.fetch = originalFetch;
    publishCepIntegrationStatus(null);
  }
});

test("a not-found response keeps address fields untouched and offers manual entry", async () => {
  const missing = Object.assign(new Error("CEP não encontrado."), { status: 404, code: "cep_not_found" });
  const { controller, timers, results, statuses } = makeLookup({ lookup: async () => { throw missing; } });
  controller.setCep("01001-000");
  await timers.run(timers.ids()[0]);
  assert.deepEqual(results, []);
  assert.equal(statuses.at(-1).kind, "not-found");
  assert.match(statuses.at(-1).message, /preencha.*manualmente/i);
});

test("network and permission failures stay non-blocking and explain manual entry", async () => {
  for (const failure of [new Error("offline"), Object.assign(new Error("forbidden"), { status: 403 })]) {
    const { controller, timers, results, statuses } = makeLookup({ lookup: async () => { throw failure; } });
    controller.setCep("01001-000");
    await timers.run(timers.ids()[0]);
    assert.deepEqual(results, []);
    assert.equal(statuses.at(-1).kind, "error");
    assert.match(statuses.at(-1).message, /manualmente/i);
  }
});

test("a late response for an older CEP cannot replace the newer result", async () => {
  const first = deferred();
  const calls = [];
  const { controller, timers, results } = makeLookup({ lookup(cep) {
    calls.push(cep);
    return cep === "01001000" ? first.promise : Promise.resolve({ address: "Rua Nova", city: "Recife", state: "PE" });
  } });
  controller.setCep("01001-000");
  const firstTask = timers.run(timers.ids()[0]);
  controller.setCep("50000-000");
  await timers.run(timers.ids()[0]);
  first.resolve({ address: "Praça da Sé", city: "São Paulo", state: "SP" });
  await firstTask;
  assert.deepEqual(calls, ["01001000", "50000000"]);
  assert.deepEqual(results, [{ address: "Rua Nova", city: "Recife", state: "PE" }]);
});

test("manual edits made during a lookup are preserved and missing fields are not cleared", async () => {
  const response = deferred();
  const { controller, timers, results, statuses } = makeLookup({ lookup: () => response.promise });
  controller.setCep("01001-000");
  const request = timers.run(timers.ids()[0]);
  controller.markManuallyEdited("address");
  response.resolve({ address: "Praça da Sé", city: "São Paulo", state: "" });
  await request;
  assert.deepEqual(results, [{ city: "São Paulo" }]);
  assert.equal(Object.hasOwn(results[0], "address_number"), false);
  assert.equal(statuses.at(-1).kind, "partial");
});

test("changing to an incomplete CEP invalidates an in-flight lookup", async () => {
  const response = deferred();
  const { controller, timers, results, statuses } = makeLookup({ lookup: () => response.promise });
  controller.setCep("01001-000");
  const request = timers.run(timers.ids()[0]);
  controller.setCep("01001");
  response.resolve({ address: "Praça da Sé", city: "São Paulo", state: "SP" });
  await request;
  assert.deepEqual(results, []);
  assert.equal(statuses.at(-1).kind, "idle");
});


test("disposing a form ignores an in-flight response", async () => {
  const response = deferred();
  const { controller, timers, results } = makeLookup({ lookup: () => response.promise });
  controller.setCep("01001-000");
  const request = timers.run(timers.ids()[0]);
  controller.dispose();
  response.resolve({ address: "Praça da Sé", city: "São Paulo", state: "SP" });
  await request;
  assert.deepEqual(results, []);
});


test("the existing lookup service uses the same-origin authenticated endpoint", async () => {
  const { getCepIntegration, lookupCep } = await import("../src/services/api.js?patient-cep-service");
  const { getCepIntegrationStatus } = await import("../src/services/cepIntegrationStatus.js");
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (path, options) => {
    calls.push({ path, options });
    if (path === "/api/v1/integrations/cep") {
      return { ok: true, status: 200, json: async () => ({ integration: { is_active: true } }) };
    }
    return { ok: true, status: 200, json: async () => ({ address: {
      cep: "01001-000", address: "Praça da Sé", city: "São Paulo", state: "SP",
    } }) };
  };
  try {
    assert.deepEqual(await getCepIntegration(), { is_active: true });
    assert.equal(getCepIntegrationStatus(), true);
    assert.deepEqual(await lookupCep("01001000"), {
      cep: "01001-000", address: "Praça da Sé", city: "São Paulo", state: "SP",
    });
    assert.equal(calls[0].path, "/api/v1/integrations/cep");
    assert.equal(calls[1].path, "/api/v1/integrations/cep/lookup?cep=01001000");
    assert.equal(calls[1].options.credentials, "same-origin");
    assert.equal(calls[1].options.cache, "no-store");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
