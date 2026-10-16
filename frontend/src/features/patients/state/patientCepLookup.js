const ADDRESS_FIELDS = ["address", "city", "state"];

export function formatPostalCode(value) {
  const digits = String(value ?? "").replace(/\D/g, "").slice(0, 8);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

export function createPatientCepLookup({
  lookup,
  onResult,
  onStatus,
  debounceMs = 350,
  schedule = setTimeout,
  cancel = clearTimeout,
  enabled = true,
}) {
  let timer = null;
  let generation = 0;
  let latestCep = "";
  let requestController = null;
  const manuallyEdited = new Set();

  function clearTimer() {
    if (timer !== null) cancel(timer);
    timer = null;
  }

  function abortRequest() {
    requestController?.abort();
    requestController = null;
  }

  function scheduleLookup(value) {
    const digits = String(value ?? "").replace(/\D/g, "");
    if (digits.length !== 8) {
      onStatus({ kind: "idle", message: "" });
      return;
    }

    const requestGeneration = generation;
    timer = schedule(() => runLookup(digits, requestGeneration), debounceMs);
  }

  function setCep(value) {
    latestCep = String(value ?? "");
    generation += 1;
    clearTimer();
    abortRequest();
    if (!enabled) {
      onStatus({ kind: "idle", message: "" });
      return;
    }
    scheduleLookup(latestCep);
  }

  async function runLookup(digits, requestGeneration) {
    timer = null;
    if (requestGeneration !== generation) return;
    onStatus({ kind: "loading", message: "Consultando endereço…" });
    const controller = typeof AbortController === "undefined" ? null : new AbortController();
    requestController = controller;
    try {
      const result = await lookup(digits, { signal: controller?.signal });
      if (requestGeneration !== generation) return;
      const updates = {};
      for (const field of ADDRESS_FIELDS) {
        const value = typeof result?.[field] === "string" ? result[field].trim() : "";
        if (value && !manuallyEdited.has(field)) updates[field] = value;
      }
      const hasAddress = ADDRESS_FIELDS.some((field) => (
        typeof result?.[field] === "string" && result[field].trim()
      ));
      if (!hasAddress) {
        onStatus({ kind: "not-found", message: "CEP não encontrado. Preencha o endereço manualmente." });
        return;
      }
      if (Object.keys(updates).length) onResult(updates);
      const complete = ADDRESS_FIELDS.every((field) => (
        typeof result?.[field] === "string" && result[field].trim()
      ));
      onStatus(complete
        ? { kind: "success", message: "Endereço encontrado." }
        : { kind: "partial", message: "Consulta concluída. Complete manualmente os campos sem resultado." });
    } catch (error) {
      if (requestGeneration !== generation) return;
      if (error?.status === 404 || error?.code === "cep_not_found") {
        onStatus({ kind: "not-found", message: "CEP não encontrado. Preencha o endereço manualmente." });
      } else if (error?.status === 409 && error?.code === "integration_disabled") {
        enabled = false;
        onStatus({ kind: "disabled", message: "Consulta de CEP indisponível. Preencha o endereço manualmente." });
      } else if (error?.status === 403) {
        onStatus({ kind: "error", message: "Sem permissão para consultar agora. Você pode preencher o endereço manualmente." });
      } else {
        onStatus({ kind: "error", message: "Não foi possível consultar o CEP. Você pode preencher o endereço manualmente." });
      }
    } finally {
      if (requestController === controller) requestController = null;
    }
  }

  function markManuallyEdited(field) {
    if (ADDRESS_FIELDS.includes(field)) manuallyEdited.add(field);
  }

  function setEnabled(value) {
    const wasEnabled = enabled;
    enabled = Boolean(value);
    if (!enabled) {
      generation += 1;
      clearTimer();
      abortRequest();
      onStatus({ kind: "idle", message: "" });
    } else if (!wasEnabled && latestCep) {
      setCep(latestCep);
    }
  }

  function reset() {
    generation += 1;
    clearTimer();
    abortRequest();
    latestCep = "";
    manuallyEdited.clear();
    onStatus({ kind: "idle", message: "" });
  }

  function dispose() {
    generation += 1;
    clearTimer();
    abortRequest();
    latestCep = "";
  }

  return { dispose, markManuallyEdited, reset, setCep, setEnabled };
}
