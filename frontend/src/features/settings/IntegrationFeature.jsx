import { useEffect, useReducer, useRef, useState } from "react";
import Button from "../../components/Button/Button";
import FormField from "../../components/FormField/FormField";
import TextField from "../../components/TextField/TextField";
import { toggleExpandedPanel } from "./state/integrationAccordion.js";
import { cepConfigurationReducer, hasCepConfigurationChanges } from "./state/cepConfigurationState.js";
import {
  buildCepConfigurationPayload,
  getCepIntegration,
  lookupCep,
  saveCepConfiguration,
  saveCepCredential,
} from "../../services/api";
import { subscribeCepIntegrationStatus } from "../../services/cepIntegrationStatus.js";
import "./IntegrationFeature.css";

const CEP_INTEGRATION = {
  id: "cep-integration",
  title: "Consulta de CEP",
  description: "Endereços dos pacientes.",
};

const DEFAULT_CONFIGURATION = {
  provider_name: "ViaCEP",
  url_template: "https://viacep.com.br/ws/{cep}/json/",
  method: "GET",
  field_map: { cep: "cep", address: "logradouro", city: "localidade", state: "uf" },
  auth_header: null,
  auth_prefix: "",
};

const FIELDS = [
  ["cep", "CEP"],
  ["address", "Endereço"],
  ["city", "Cidade"],
  ["state", "Estado / UF"],
];

function errorMessage(error) {
  return error?.message || "Não foi possível concluir a operação.";
}

export function IntegrationAccordionItem({
  id,
  title,
  description,
  status,
  statusTone = "neutral",
  expanded,
  onToggle,
  children,
}) {
  const headingId = `${id}-heading`;
  const panelId = `${id}-panel`;

  return (
    <section className="integration-settings__accordion-item" aria-labelledby={headingId}>
      <h2 className="integration-settings__accordion-heading" id={headingId}>
        <button
          className="integration-settings__accordion-trigger"
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={onToggle}
        >
          <span className="integration-settings__accordion-copy">
            <span className="integration-settings__accordion-title">{title}</span>
            <span className="integration-settings__accordion-description">{description}</span>
          </span>
          <span className={`integration-settings__status is-${statusTone}`}>
            <span aria-hidden="true" />{status}
          </span>
          <svg className="integration-settings__chevron" aria-hidden="true" focusable="false" viewBox="0 0 20 20">
            <path d="m5 7.5 5 5 5-5" />
          </svg>
        </button>
      </h2>
      <div
        className="integration-settings__accordion-panel"
        id={panelId}
        role="region"
        aria-labelledby={headingId}
        hidden={!expanded}
      >
        {children}
      </div>
    </section>
  );
}

export default function IntegrationFeature({ permissions = [], administratorAccessPending = false }) {
  const can = (permission) => permissions.includes(permission);
  const canConfigure = can("integrations.cep.configure");
  const canManageCredential = can("integrations.cep.manage");
  const canLookup = can("integrations.cep.lookup");
  const [configurationState, dispatchConfiguration] = useReducer(cepConfigurationReducer, {
    confirmed: null,
    draft: DEFAULT_CONFIGURATION,
  });
  const configuration = configurationState.draft;
  const confirmedConfiguration = configurationState.confirmed;
  const configurationPending = hasCepConfigurationChanges(configuration, confirmedConfiguration);
  const [credential, setCredential] = useState("");
  const [showCredential, setShowCredential] = useState(false);
  const [credentialConfigured, setCredentialConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingCredential, setSavingCredential] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [configurationSaveMessage, setConfigurationSaveMessage] = useState("");
  const [configurationSaveError, setConfigurationSaveError] = useState("");
  const [credentialSaveMessage, setCredentialSaveMessage] = useState("");
  const [credentialSaveError, setCredentialSaveError] = useState("");
  const [cep, setCep] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [result, setResult] = useState(null);
  const lookupAbortController = useRef(null);
  const [expandedPanels, setExpandedPanels] = useState({
    "cep-integration": true,
    "whatsapp-integration": false,
    "email-integration": false,
    "other-integrations": false,
  });

  function togglePanel(id) {
    setExpandedPanels((current) => toggleExpandedPanel(current, id));
  }

  useEffect(() => subscribeCepIntegrationStatus((isActive) => {
    dispatchConfiguration({ type: "confirmed-status", isActive });
    if (isActive !== true) {
      lookupAbortController.current?.abort();
      setLookupLoading(false);
      setLookupError("");
      setResult(null);
    }
  }), []);

  useEffect(() => {
    if (administratorAccessPending) return undefined;

    let active = true;
    getCepIntegration().then((data) => {
      if (!active) return;
      dispatchConfiguration({ type: "load", configuration: {
        provider_name: data.provider_name ?? DEFAULT_CONFIGURATION.provider_name,
        url_template: data.url_template ?? DEFAULT_CONFIGURATION.url_template,
        method: data.method ?? DEFAULT_CONFIGURATION.method,
        field_map: { ...DEFAULT_CONFIGURATION.field_map, ...(data.field_map || {}) },
        auth_header: data.auth_header || null,
        auth_prefix: data.auth_prefix || "",
        is_active: data.is_active,
      } });
      setCredentialConfigured(data.credential_configured);
      setLoading(false);
    }).catch((error) => {
      if (!active) return;
      setLoadError({
        message: errorMessage(error),
        unavailable: [404, 500, 503].includes(error?.status),
      });
      setLoading(false);
    });
    return () => { active = false; };
  }, [administratorAccessPending]);

  const cepLoadError = administratorAccessPending
    ? {
      message: "A sessão administrativa não recebeu a permissão integrations.cep.view. A migration d4c8a91f2e67 cria e associa essa permissão ao perfil Administrador.",
      unavailable: true,
      dependency: true,
    }
    : loadError;
  const cepLoading = !administratorAccessPending && loading;

  function updateConfiguration(key, value) {
    dispatchConfiguration({ type: "edit", update: (current) => ({ ...current, [key]: value }) });
    setConfigurationSaveMessage("");
    setConfigurationSaveError("");
  }

  function updateActivationDraft(isActive) {
    dispatchConfiguration({ type: "activation-edit", isActive });
    setConfigurationSaveMessage("");
    setConfigurationSaveError("");
  }

  function updateField(field, value) {
    dispatchConfiguration({ type: "edit", update: (current) => ({
      ...current,
      field_map: { ...current.field_map, [field]: value },
    }) });
    setConfigurationSaveMessage("");
    setConfigurationSaveError("");
  }

  async function handleSave(event) {
    event.preventDefault();
    setSaving(true);
    setConfigurationSaveError("");
    setConfigurationSaveMessage("");
    try {
      const configurationPayload = buildCepConfigurationPayload(configuration);
      const saved = await saveCepConfiguration(configurationPayload);
      const confirmed = { ...configuration, ...buildCepConfigurationPayload(saved) };
      dispatchConfiguration({ type: "save-success", configuration: confirmed });
      setCredentialConfigured(saved.credential_configured);
      setConfigurationSaveMessage("Configuração salva com sucesso.");
    } catch (error) {
      dispatchConfiguration({ type: "save-failure" });
      setConfigurationSaveError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleCredentialSave() {
    setSavingCredential(true);
    setCredentialSaveError("");
    setCredentialSaveMessage("");
    try {
      await saveCepCredential(credential);
      setCredential("");
      setCredentialConfigured(true);
      setCredentialSaveMessage("Credencial salva com segurança.");
    } catch (error) {
      setCredentialSaveError(errorMessage(error));
    } finally {
      setSavingCredential(false);
    }
  }

  async function handleLookup(event) {
    event.preventDefault();
    if (confirmedConfiguration?.is_active !== true) return;
    const controller = new AbortController();
    lookupAbortController.current = controller;
    setLookupLoading(true);
    setLookupError("");
    setResult(null);
    try {
      setResult(await lookupCep(cep, { signal: controller.signal }));
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error?.status === 409 && error?.code === "integration_disabled") {
        dispatchConfiguration({ type: "confirmed-status", isActive: false });
        setLookupError("");
        setResult(null);
      } else {
        setLookupError(errorMessage(error));
      }
    } finally {
      if (lookupAbortController.current === controller) lookupAbortController.current = null;
      setLookupLoading(false);
    }
  }

  const status = cepLoading
    ? { label: "Carregando", tone: "neutral" }
    : cepLoadError
      ? { label: cepLoadError.unavailable ? "Indisponível" : "Falha ao carregar", tone: "error" }
      : confirmedConfiguration?.is_active === false
        ? { label: "Desativada", tone: "inactive" }
        : confirmedConfiguration?.is_active === true
          ? { label: "Ativa", tone: "success" }
          : { label: "Status desconhecido", tone: "neutral" };
  const confirmedIsActive = confirmedConfiguration?.is_active;
  const activationHasPendingChange = configuration.is_active !== confirmedIsActive;

  return (
    <section className="integration-settings" aria-labelledby="integration-settings-title">
      <header className="integration-settings__header">
        <div>
          <h1 id="integration-settings-title">Integrações</h1>
          <p>Configure os serviços externos da clínica.</p>
        </div>
      </header>

      <div className="integration-settings__accordion">
        <IntegrationAccordionItem
          {...CEP_INTEGRATION}
          status={status.label}
          statusTone={status.tone}
          expanded={Boolean(expandedPanels[CEP_INTEGRATION.id])}
          onToggle={() => togglePanel(CEP_INTEGRATION.id)}
        >
          {cepLoading && <p className="integration-settings__note" role="status">Carregando a configuração de CEP…</p>}
          {cepLoadError && (
            <div className="integration-settings__feedback is-error" role="alert">
              <div>
                <strong>{cepLoadError.dependency ? "Permissão necessária para ativar Consulta de CEP" : cepLoadError.unavailable ? "Serviço de CEP não disponível" : "Não foi possível carregar a configuração"}</strong>
                <p>{cepLoadError.message}</p>
                {cepLoadError.unavailable && !cepLoadError.dependency && (
                  <p>O backend ou a migration da integração pode ainda não estar ativado. Salvamento e consulta ficam indisponíveis até o serviço responder.</p>
                )}
              </div>
              {!cepLoadError.dependency && (
                <Button variant="secondary" onClick={() => window.location.reload()}>Tentar novamente</Button>
              )}
            </div>
          )}

          {!cepLoadError && (
            <>
          {canConfigure && !cepLoading && (
            <div className="integration-settings__activation">
              <label className="integration-settings__switch-label" htmlFor="cep-integration-active">
                <input id="cep-integration-active" type="checkbox" role="switch"
                  checked={configuration.is_active === true} disabled={saving}
                  aria-describedby={configurationPending ? "cep-configuration-pending" : undefined}
                  onChange={(event) => updateActivationDraft(event.target.checked)} />
                <span>Consulta automática de CEP</span>
              </label>
              <span className={`integration-settings__status is-${confirmedIsActive === true ? "success" : confirmedIsActive === false ? "inactive" : "neutral"}`}>
                <span aria-hidden="true" />{confirmedIsActive === true ? "Ativa no sistema" : confirmedIsActive === false ? "Desativada no sistema" : "Status desconhecido"}
              </span>
              {configurationPending && (
                <p className="integration-settings__note" id="cep-configuration-pending" role="status">
                  {activationHasPendingChange
                    ? `Alteração pendente: ficará ${configuration.is_active ? "ativa" : "desativada"} após salvar.`
                    : "Há alterações pendentes. Salve para aplicá-las."}
                </p>
              )}
            </div>
          )}
          <form className="integration-settings__panel" onSubmit={handleSave}>
        <div className="integration-settings__panel-heading">
          <span className="integration-settings__method-label">Método suportado</span>
          <span className="integration-settings__method">GET</span>
        </div>

        <div className="integration-settings__fields">
          <FormField className="integration-settings__field" label="Provedor" htmlFor="cep-provider">
            <TextField id="cep-provider" value={configuration.provider_name} maxLength={120}
              disabled={!canConfigure || cepLoading || saving || Boolean(cepLoadError)}
              onChange={(event) => updateConfiguration("provider_name", event.target.value)} />
          </FormField>
          <FormField className="integration-settings__field integration-settings__field--wide"
            label="URL do serviço" htmlFor="cep-url">
            <TextField id="cep-url" value={configuration.url_template} maxLength={500}
              disabled={!canConfigure || cepLoading || saving || Boolean(cepLoadError)} spellCheck="false"
              aria-describedby="cep-url-note"
              onChange={(event) => updateConfiguration("url_template", event.target.value)} />
            <p className="integration-settings__note" id="cep-url-note">Use {"{cep}"} no ponto em que o CEP deve entrar.</p>
          </FormField>
        </div>

        <fieldset className="integration-settings__mapping" disabled={!canConfigure || cepLoading || saving || Boolean(cepLoadError)}>
          <legend>Mapeamento dos campos JSON</legend>
          <p>Informe o caminho no JSON retornado para cada dado de endereço.</p>
          <div className="integration-settings__fields integration-settings__fields--mapping">
            {FIELDS.map(([key, label]) => (
              <FormField key={key} className="integration-settings__field" label={label} htmlFor={`cep-map-${key}`}>
                <TextField id={`cep-map-${key}`} value={configuration.field_map[key] || ""}
                  onChange={(event) => updateField(key, event.target.value)} />
              </FormField>
            ))}
          </div>
        </fieldset>

        <fieldset className="integration-settings__auth" disabled={!canConfigure || cepLoading || saving || Boolean(cepLoadError)}>
          <legend>Autenticação <span>Opcional</span></legend>
          <div className="integration-settings__fields">
            <FormField className="integration-settings__field" label="Cabeçalho de autenticação" htmlFor="cep-auth-header">
              <select id="cep-auth-header" value={configuration.auth_header || ""}
                disabled={!canConfigure || cepLoading || Boolean(cepLoadError)}
                onChange={(event) => {
                  updateConfiguration("auth_header", event.target.value || null);
                  if (!event.target.value) updateConfiguration("auth_prefix", "");
                }}>
                <option value="">Sem autenticação</option>
                <option value="Authorization">Authorization</option>
                <option value="X-API-Key">X-API-Key</option>
                <option value="X-Auth-Token">X-Auth-Token</option>
              </select>
            </FormField>
            {configuration.auth_header && (
              <FormField className="integration-settings__field" label="Prefixo do valor" htmlFor="cep-auth-prefix">
                <TextField id="cep-auth-prefix" value={configuration.auth_prefix} maxLength={40}
                  disabled={!canConfigure || cepLoading || Boolean(cepLoadError)}
                  onChange={(event) => updateConfiguration("auth_prefix", event.target.value)} />
              </FormField>
            )}
          </div>
          {configuration.auth_header && canManageCredential && (
            <FormField className="integration-settings__field integration-settings__field--wide"
              label="Chave de API" htmlFor="cep-api-key">
              <div className="integration-settings__key-control">
                <TextField id="cep-api-key" type={showCredential ? "text" : "password"}
                  value={credential} autoComplete="new-password" spellCheck="false"
                  disabled={cepLoading || savingCredential || Boolean(cepLoadError)} aria-describedby="cep-key-note"
                  placeholder={credentialConfigured ? "Chave já cadastrada; informe para substituir" : "Digite a chave"}
                  onChange={(event) => { setCredential(event.target.value); setCredentialSaveMessage(""); setCredentialSaveError(""); }} />
                <button className="integration-settings__visibility" type="button"
                  aria-label={showCredential ? "Ocultar chave" : "Mostrar chave"}
                  aria-pressed={showCredential} onClick={() => setShowCredential((value) => !value)}>
                  {showCredential ? "Ocultar" : "Mostrar"}
                </button>
              </div>
              <p className="integration-settings__note" id="cep-key-note">
                A chave não é mantida no navegador. Ela é enviada diretamente ao armazenamento seguro do servidor.
                {credentialConfigured ? " Uma credencial está cadastrada." : " Nenhuma credencial cadastrada."}
                {configurationPending && " Salve a configuração de autenticação antes de enviar a chave."}
              </p>
              <div className="integration-settings__credential-actions">
                <Button type="button" variant="secondary" disabled={!credential || configurationPending || cepLoading || savingCredential || Boolean(cepLoadError)}
                  onClick={handleCredentialSave}>
                  {savingCredential ? "Salvando chave…" : "Salvar chave"}
                </Button>
                {credentialSaveMessage && <p className="integration-settings__feedback is-success" role="status">{credentialSaveMessage}</p>}
                {credentialSaveError && <p className="integration-settings__feedback is-error" role="alert">{credentialSaveError}</p>}
              </div>
            </FormField>
          )}
          {configuration.auth_header && !canManageCredential && (
            <p className="integration-settings__note">Você não tem permissão para gerenciar a credencial.</p>
          )}
        </fieldset>

        {canConfigure && (
          <div className="integration-settings__actions">
            <Button type="submit" disabled={cepLoading || saving || Boolean(cepLoadError)}>
              {saving ? "Salvando…" : "Salvar configuração"}
            </Button>
            {configurationSaveMessage && <p className="integration-settings__feedback is-success" role="status">{configurationSaveMessage}</p>}
            {configurationSaveError && <p className="integration-settings__feedback is-error" role="alert">{configurationSaveError}</p>}
          </div>
        )}
        {!canConfigure && <p className="integration-settings__note">Você pode consultar esta configuração, mas não tem permissão para alterá-la.</p>}
          </form>

      <section className="integration-settings__lookup" aria-labelledby="cep-lookup-title">
        <div>
          <h3 id="cep-lookup-title">Testar consulta</h3>
          <p>Consulte um CEP para confirmar a resposta do provedor.</p>
        </div>
        {canLookup ? (
          <form className="integration-settings__lookup-form" onSubmit={handleLookup}>
            <FormField className="integration-settings__field" label="CEP para teste" htmlFor="cep-test">
              <TextField id="cep-test" inputMode="numeric" autoComplete="postal-code" value={cep}
                placeholder="00000-000" maxLength={9}
                disabled={confirmedIsActive !== true || lookupLoading || cepLoading || Boolean(cepLoadError)}
                onChange={(event) => setCep(event.target.value)} />
            </FormField>
            <Button type="submit" disabled={confirmedIsActive !== true || lookupLoading || cepLoading || Boolean(cepLoadError) || !cep.trim()}>
              {lookupLoading ? "Consultando…" : "Testar CEP"}
            </Button>
          </form>
        ) : <p className="integration-settings__note">Você não tem permissão para testar consultas.</p>}
        {lookupError && <p className="integration-settings__feedback is-error" role="alert">{lookupError}</p>}
        {result && (
          <dl className="integration-settings__result" aria-live="polite">
            {FIELDS.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{result[key] || "—"}</dd></div>)}
          </dl>
        )}
      </section>
            </>
          )}
        </IntegrationAccordionItem>
        <IntegrationAccordionItem
          id="whatsapp-integration"
          title="WhatsApp"
          description="Mensagens e notificações."
          status="Futuro"
          statusTone="future"
          expanded={Boolean(expandedPanels["whatsapp-integration"])}
          onToggle={() => togglePanel("whatsapp-integration")}
        >
          <p className="integration-settings__future-message" role="status">
            Nenhuma configuração disponível nesta versão.
          </p>
        </IntegrationAccordionItem>
        <IntegrationAccordionItem
          id="email-integration"
          title="E-mail"
          description="Comunicação por e-mail."
          status="Futuro"
          statusTone="future"
          expanded={Boolean(expandedPanels["email-integration"])}
          onToggle={() => togglePanel("email-integration")}
        >
          <p className="integration-settings__future-message" role="status">
            Nenhuma configuração disponível nesta versão.
          </p>
        </IntegrationAccordionItem>
        <IntegrationAccordionItem
          id="other-integrations"
          title="Outras integrações"
          description="Serviços futuros."
          status="Futuro"
          statusTone="future"
          expanded={Boolean(expandedPanels["other-integrations"])}
          onToggle={() => togglePanel("other-integrations")}
        >
          <p className="integration-settings__future-message" role="status">
            Nenhuma configuração disponível nesta versão.
          </p>
        </IntegrationAccordionItem>
      </div>
    </section>
  );
}
