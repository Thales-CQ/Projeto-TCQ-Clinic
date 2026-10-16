import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { toggleExpandedPanel } from "../src/features/settings/state/integrationAccordion.js";
import {
  cepConfigurationReducer,
  hasCepConfigurationChanges,
} from "../src/features/settings/state/cepConfigurationState.js";

test("activation edits stay separate from confirmed state until save succeeds", () => {
  const original = {
    provider_name: "ViaCEP", url_template: "https://viacep.com.br/ws/{cep}/json/",
    method: "GET", field_map: { cep: "cep", address: "logradouro", city: "localidade", state: "uf" },
    auth_header: "Authorization", auth_prefix: "Bearer ", is_active: true,
  };
  const initial = cepConfigurationReducer({ confirmed: null, draft: {} }, {
    type: "load", configuration: original,
  });
  const edited = cepConfigurationReducer(initial, {
    type: "activation-edit", isActive: false,
  });
  assert.equal(edited.confirmed.is_active, true);
  assert.equal(edited.draft.is_active, false);
  assert.equal(edited.draft.provider_name, original.provider_name);
  assert.equal(hasCepConfigurationChanges(edited.draft, edited.confirmed), true);
  const activationReverted = cepConfigurationReducer(initial, {
    type: "edit", update: (configuration) => ({ ...configuration, is_active: false }),
  });
  const activationRestored = cepConfigurationReducer(activationReverted, {
    type: "edit", update: (configuration) => ({ ...configuration, is_active: true }),
  });
  assert.equal(hasCepConfigurationChanges(activationRestored.draft, activationRestored.confirmed), false);

  const withFieldEdit = cepConfigurationReducer(edited, {
    type: "edit", update: (configuration) => ({ ...configuration, provider_name: "Provedor editado" }),
  });
  const failed = cepConfigurationReducer(withFieldEdit, { type: "save-failure" });
  assert.deepEqual(failed, withFieldEdit);
  assert.equal(failed.draft.provider_name, "Provedor editado");
  const reopened = cepConfigurationReducer(failed, { type: "load", configuration: original });
  assert.deepEqual(reopened.confirmed, original);
  assert.deepEqual(reopened.draft, original);

  const disabled = cepConfigurationReducer(withFieldEdit, {
    type: "save-success", configuration: { ...withFieldEdit.draft },
  });
  assert.equal(disabled.confirmed.is_active, false);
  assert.equal(disabled.draft.is_active, false);
  const reactivated = cepConfigurationReducer(disabled, {
    type: "edit", update: (configuration) => ({ ...configuration, is_active: true }),
  });
  assert.equal(reactivated.confirmed.is_active, false);
  assert.equal(reactivated.draft.is_active, true);
  assert.equal(cepConfigurationReducer(reactivated, {
    type: "save-success", configuration: { ...reactivated.draft },
  }).confirmed.is_active, true);
});

test("CEP configuration service allowlists fields and changes the confirmed status only after successful save", async () => {
  const api = await import("../src/services/api.js?cep-contract-regression");
  const status = await import("../src/services/cepIntegrationStatus.js");
  const calls = [];
  const originalFetch = globalThis.fetch;
  const stored = {
    provider_name: "ViaCEP", url_template: "https://viacep.com.br/ws/{cep}/json/", method: "GET",
    field_map: { cep: "cep", address: "logradouro", city: "localidade", state: "uf" },
    auth_header: "Authorization", auth_prefix: "Bearer ", credential_configured: true, is_active: true,
  };
  let failNextWrite = false;
  globalThis.fetch = async (path, options = {}) => {
    calls.push({ path, options });
    if (path.endsWith("/auth/me")) {
      return { ok: true, status: 200, json: async () => ({ csrf_token: "cep-csrf", user: { id: 1 } }) };
    }
    if (path.endsWith("/integrations/cep/credential")) {
      return { ok: true, status: 200, json: async () => ({ integration: { ...stored } }) };
    }
    if (path.includes("/integrations/cep/lookup?")) {
      return { ok: true, status: 200, json: async () => ({ address: {
        cep: "01001-000", address: "Praça da Sé", city: "São Paulo", state: "SP",
      } }) };
    }
    const payload = JSON.parse(options.body);
    if (failNextWrite) {
      failNextWrite = false;
      return { ok: false, status: 400, json: async () => ({ error: {
        code: "configuration_invalid", message: "URL HTTPS fora da lista de destinos permitidos.",
      } }) };
    }
    if (payload.is_active === false) {
      stored.is_active = false;
    } else {
      Object.assign(stored, payload);
      if (payload.is_active === true) stored.is_active = true;
    }
    return { ok: true, status: 200, json: async () => ({ integration: { ...stored } }) };
  };

  try {
    const config = {
      provider_name: "ViaCEP", url_template: "https://viacep.com.br/ws/{cep}/json/", method: "GET",
      field_map: { cep: "cep", address: "logradouro", city: "localidade", state: "uf" },
      auth_header: "Authorization", auth_prefix: "Bearer ", is_active: true,
      credential_configured: true, field_mapping: { invalid: "alias" }, auth_type: "api_key",
    };
    const normalPayload = api.buildCepConfigurationPayload(config);
    await api.saveCepConfiguration(normalPayload);
    const savedRequest = calls.find(({ path }) => path.endsWith("/integrations/cep/configuration"));
    assert.deepEqual(JSON.parse(savedRequest.options.body), {
      provider_name: config.provider_name, url_template: config.url_template, method: "GET",
      field_map: config.field_map, auth_header: "Authorization", auth_prefix: "Bearer ", is_active: true,
    });
    assert.equal(status.getCepIntegrationStatus(), true);
    assert.deepEqual(await api.lookupCep("01001000"), {
      cep: "01001-000", address: "Praça da Sé", city: "São Paulo", state: "SP",
    });
    assert.equal(Object.hasOwn(JSON.parse(savedRequest.options.body), "credential_configured"), false);
    assert.equal(Object.hasOwn(JSON.parse(savedRequest.options.body), "field_mapping"), false);
    assert.equal(Object.hasOwn(JSON.parse(savedRequest.options.body), "auth_type"), false);

    await api.saveCepCredential("provider-secret");
    const credentialRequest = calls.at(-1);
    assert.ok(credentialRequest.path.endsWith("/integrations/cep/credential"));
    assert.deepEqual(JSON.parse(credentialRequest.options.body), { credential: "provider-secret" });

    const beforeToggle = { ...stored, field_map: { ...stored.field_map } };
    const disabled = await api.saveCepConfiguration({ ...beforeToggle, is_active: false });
    const disabledRequest = calls.at(-1);
    assert.deepEqual(JSON.parse(disabledRequest.options.body), api.buildCepConfigurationPayload({ ...beforeToggle, is_active: false }));
    assert.deepEqual({ ...disabled, is_active: true }, beforeToggle);
    assert.equal(stored.is_active, false);
    assert.equal(status.getCepIntegrationStatus(), false);
    const lookupCallsBeforeDisabledCheck = calls.filter(({ path }) => path.includes("/integrations/cep/lookup?")).length;
    await assert.rejects(api.lookupCep("01001000"), (error) => error.code === "integration_disabled");
    assert.equal(calls.filter(({ path }) => path.includes("/integrations/cep/lookup?")).length, lookupCallsBeforeDisabledCheck);

    const enabled = await api.saveCepConfiguration({ ...beforeToggle, is_active: true });
    const enabledRequest = calls.at(-1);
    assert.deepEqual(JSON.parse(enabledRequest.options.body), api.buildCepConfigurationPayload({ ...beforeToggle, is_active: true }));
    assert.deepEqual({ ...enabled, is_active: false }, { ...beforeToggle, is_active: false });
    assert.equal(stored.is_active, true);
    assert.equal(status.getCepIntegrationStatus(), true);
    assert.deepEqual(await api.lookupCep("01001000"), {
      cep: "01001-000", address: "Praça da Sé", city: "São Paulo", state: "SP",
    });
    assert.equal(stored.credential_configured, true);

    failNextWrite = true;
    await assert.rejects(api.saveCepConfiguration({ ...config, is_active: false }), (error) => (
      error.status === 400 && error.code === "configuration_invalid"
      && error.message === "URL HTTPS fora da lista de destinos permitidos."
    ));
    assert.equal(status.getCepIntegrationStatus(), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CEP integration screen exposes provider configuration and test lookup", async () => {
  const vite = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false },
    cacheDir: "/tmp/clinica-vite-tests",
  });
  try {
    const { default: IntegrationFeature } = await vite.ssrLoadModule(
      "/src/features/settings/IntegrationFeature.jsx",
    );
    const html = renderToStaticMarkup(createElement(IntegrationFeature, {
      permissions: ["integrations.cep.configure", "integrations.cep.manage", "integrations.cep.lookup"],
    }));
    const source = await readFile(new URL(
      "../src/features/settings/IntegrationFeature.jsx",
      import.meta.url,
    ), "utf8");
    const api = await readFile(new URL("../src/services/api.js", import.meta.url), "utf8");
    const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
    const navigation = await readFile(new URL("../src/routes/navigation.js", import.meta.url), "utf8");

    assert.match(html, /Consulta de CEP/);
    assert.match(html, /<h1 id="integration-settings-title">Integrações<\/h1>/);
    assert.match(html, /Configure os serviços externos da clínica\./);
    assert.match(html, /Endereços dos pacientes\./);
    assert.match(html, /WhatsApp/);
    assert.match(html, /Mensagens e notificações\./);
    assert.match(html, /E-mail/);
    assert.match(html, /Comunicação por e-mail\./);
    assert.match(html, /Outras integrações/);
    assert.match(html, /Serviços futuros\./);
    assert.equal((html.match(/>Futuro<\/span>/g) || []).length, 3);
    assert.equal((html.match(/Nenhuma configuração disponível nesta versão\./g) || []).length, 3);
    assert.equal((html.match(/class="integration-settings__accordion-item"/g) || []).length, 4);
    assert.match(html, /id="cep-integration-panel"[^>]*role="region"/);
    assert.equal((html.match(/aria-expanded="true"/g) || []).length, 1);
    assert.equal((html.match(/aria-expanded="false"/g) || []).length, 3);
    assert.equal((html.match(/integration-settings__accordion-panel[^>]*hidden=""/g) || []).length, 3);
    const panelOrder = ["Consulta de CEP", "WhatsApp", "E-mail", "Outras integrações"]
      .map((title) => html.indexOf(`>${title}</span>`));
    assert.ok(panelOrder.every((index) => index >= 0));
    assert.deepEqual(panelOrder, [...panelOrder].sort((left, right) => left - right));
    assert.match(html, /Provedor/);
    assert.match(html, /https:\/\/viacep\.com\.br\/ws\/\{cep\}\/json\//);
    assert.match(html, /Método suportado/);
    assert.match(html, />GET<\/span>/);
    assert.match(html, /Mapeamento dos campos JSON/);
    assert.match(html, /Estado \/ UF/);
    assert.match(html, /name="cep"|id="cep-map-cep"/);
    assert.match(html, /Testar consulta/);
    assert.match(source, /label="Chave de API"/);
    assert.match(source, /setShowCredential\(\(value\) => !value\)/);
    assert.match(source, /setResult\(await lookupCep\(cep, \{ signal: controller\.signal \}\)\)/);
    const activationControl = source.match(/<input id="cep-integration-active"[\s\S]*?\/>/)?.[0] || "";
    assert.match(activationControl, /onChange=\{\(event\) => updateActivationDraft\(event\.target\.checked\)\}/);
    assert.doesNotMatch(activationControl, /saveCepConfiguration|updateCepActivation|fetch\(/);
    const activationDraftHandler = source.match(/function updateActivationDraft\(isActive\) \{[\s\S]*?\n  \}/)?.[0] || "";
    assert.match(activationDraftHandler, /type: "activation-edit"/);
    assert.doesNotMatch(activationDraftHandler, /saveCepConfiguration|lookupCep|fetch\(/);
    assert.doesNotMatch(source, /handleActivationChange|updateCepActivation/);
    assert.match(source, /buildCepConfigurationPayload\(configuration\)/);
    assert.match(source, /await saveCepConfiguration\(configurationPayload\)/);
    assert.match(source, /dispatchConfiguration\(\{ type: "save-success", configuration: confirmed \}\)/);
    assert.match(source, /dispatchConfiguration\(\{ type: "save-failure" \}\)/);
    assert.match(source, /confirmedConfiguration\?\.is_active !== true/);
    assert.match(source, /disabled=\{confirmedIsActive !== true/);
    assert.match(source, /cep-configuration-pending/);
    assert.doesNotMatch(source, /\.\.\.data/);
    assert.match(source, /setCredentialConfigured\(data\.credential_configured\)/);
    assert.match(source, /role="switch"/);
    assert.match(source, /Consulta automática de CEP/);
    assert.match(source, /if \(confirmedConfiguration\?\.is_active !== true\) return/);
    assert.match(source, /disabled=\{confirmedIsActive !== true \|\| lookupLoading/);
    assert.match(source, /error\?\.status === 409 && error\?\.code === "integration_disabled"/);
    assert.doesNotMatch(source, /localStorage|sessionStorage/);
    assert.match(api, /"\/integrations\/cep"/);
    assert.match(api, /"\/integrations\/cep\/configuration"/);
    assert.match(api, /"\/integrations\/cep\/credential"/);
    assert.match(api, /`\/integrations\/cep\/lookup\?/);
    assert.match(app, /destination\.id === "integracao"/);
    assert.match(app, /<IntegrationFeature/);
    assert.match(navigation, /label: "Integração", href: "#\/configuracoes\/integracao"/);
    assert.equal((html.match(/<form/g) || []).length, 2);
    const css = await readFile(new URL("../src/features/settings/IntegrationFeature.css", import.meta.url), "utf8");
    assert.match(css, /\.integration-settings__accordion\s*\{\s*display:\s*grid/);
    assert.match(css, /\.integration-settings__accordion-panel\[hidden\]\s*\{\s*display:\s*none/);
    assert.match(css, /@media \(max-width: 44rem\)/);
    assert.match(css, /@media \(max-width: 30rem\)/);
  } finally {
    await vite.close();
  }
});

test("unavailable CEP backend hides defaults and prevents configuration actions", async () => {
  const source = await readFile(new URL(
    "../src/features/settings/IntegrationFeature.jsx",
    import.meta.url,
  ), "utf8");
  assert.match(source, /\[404, 500, 503\]\.includes\(error\?\.status\)/);
  assert.match(source, /Serviço de CEP não disponível/);
  assert.match(source, /O backend ou a migration da integração pode ainda não estar ativado/);
  assert.match(source, /if \(administratorAccessPending\)/);
  assert.match(source, /integrations\.cep\.view/);
  assert.match(source, /!cepLoadError && \(/);
  assert.match(source, /disabled=\{cepLoading \|\| saving \|\| Boolean\(cepLoadError\)\}/);
  assert.match(source, /configurationState\.confirmed/);
});

test("CEP controls are hidden or read-only without their permissions", async () => {
  const vite = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false },
    cacheDir: "/tmp/clinica-vite-tests",
  });
  try {
    const { default: IntegrationFeature } = await vite.ssrLoadModule(
      "/src/features/settings/IntegrationFeature.jsx",
    );
    const html = renderToStaticMarkup(createElement(IntegrationFeature, {
      permissions: ["integrations.cep.view"],
    }));
    assert.match(html, /não tem permissão para alterá-la/);
    assert.match(html, /não tem permissão para testar consultas/);
    assert.doesNotMatch(html, /Salvar configuração/);
    assert.doesNotMatch(html, /id="cep-api-key"/);
  } finally {
    await vite.close();
  }
});

test("collapsed integration keeps its content mounted and exposes accordion state", async () => {
  const vite = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false },
    cacheDir: "/tmp/clinica-vite-tests",
  });
  try {
    const { IntegrationAccordionItem } = await vite.ssrLoadModule(
      "/src/features/settings/IntegrationFeature.jsx",
    );
    const panelState = { "cep-integration": true };
    const onToggle = () => Object.assign(panelState, toggleExpandedPanel(panelState, "cep-integration"));
    const collapsedItem = IntegrationAccordionItem({
      id: "cep-integration",
      title: "Consulta de CEP",
      description: "Endereços dos pacientes.",
      status: "Ativa",
      statusTone: "success",
      expanded: panelState["cep-integration"],
      onToggle,
      children: createElement("input", { value: "valor não salvo", readOnly: true }),
    });
    const toggleButton = collapsedItem.props.children[0].props.children;
    toggleButton.props.onClick();

    assert.equal(panelState["cep-integration"], false);
    const html = renderToStaticMarkup(createElement(IntegrationAccordionItem, {
      id: "cep-integration",
      title: "Consulta de CEP",
      description: "Endereços dos pacientes.",
      status: "Ativa",
      statusTone: "success",
      expanded: panelState["cep-integration"],
      onToggle,
      children: createElement("input", { value: "valor não salvo", readOnly: true }),
    }));

    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /aria-controls="cep-integration-panel"/);
    assert.match(html, /id="cep-integration-panel"[^>]*hidden=""/);
    assert.match(html, /value="valor não salvo"/);
    Object.assign(panelState, toggleExpandedPanel(panelState, "cep-integration"));
    assert.equal(panelState["cep-integration"], true);

    const source = await readFile(new URL(
      "../src/features/settings/IntegrationFeature.jsx",
      import.meta.url,
    ), "utf8");
    const toggleExpressions = {
      "cep-integration": "onToggle={() => togglePanel(CEP_INTEGRATION.id)}",
      "whatsapp-integration": 'onToggle={() => togglePanel("whatsapp-integration")}',
      "email-integration": 'onToggle={() => togglePanel("email-integration")}',
      "other-integrations": 'onToggle={() => togglePanel("other-integrations")}',
    };
    for (const [panelId, expression] of Object.entries(toggleExpressions)) {
      assert.ok(source.includes(expression), `${panelId} is connected to its toggle`);
      const collapsed = toggleExpandedPanel({ [panelId]: true }, panelId);
      const expanded = toggleExpandedPanel(collapsed, panelId);
      assert.equal(collapsed[panelId], false, `${panelId} collapses`);
      assert.equal(expanded[panelId], true, `${panelId} expands`);
    }
  } finally {
    await vite.close();
  }
});
