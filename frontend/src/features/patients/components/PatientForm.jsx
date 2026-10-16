import Button from "../../../components/Button/Button";
import FormField from "../../../components/FormField/FormField";
import SelectField from "../../../components/SelectField/SelectField";
import TextField from "../../../components/TextField/TextField";
import "../styles/PatientForm.css";

export default function PatientForm({
  form,
  onCancel,
  extraActions,
  busy = false,
}) {
  const {
    birthDate, cpf, editing, email, fieldErrors, fullName, handleSubmit,
    nameInput, phone, postalCode = "", address = "", addressNumber = "", city = "", state = "",
    cepLookupStatus = { kind: "idle", message: "" }, cepIntegrationActive = false,
    handlePostalCodeChange = () => {},
    handleAddressChange = () => {}, handleAddressNumberChange = () => {}, handleCityChange = () => {},
    handleStateChange = () => {}, recordNumber, saveError, saving, setBirthDate, setCpf,
    setEmail, setFullName, setPhone, setSex, sex,
  } = form;

  const hasRecordNumber = typeof recordNumber === "string" && recordNumber.trim() !== "";

  return (
    <form className="patient-create" aria-labelledby="patients-title" onSubmit={handleSubmit}>
      <div className="patient-create__fields">
        <FormField className="patient-create__field" label="Número do prontuário" htmlFor="patient-record-number">
          <TextField id="patient-record-number" type="text" defaultValue={recordNumber || ""}
            placeholder={hasRecordNumber ? undefined : editing ? "Não informado" : "Gerado após salvar"}
            autoComplete="off" readOnly aria-readonly="true" disabled={saving || busy} />
        </FormField>
        <FormField className="patient-create__field" label="Nome completo" htmlFor="patient-full-name"
          error={fieldErrors.full_name} errorId="patient-full-name-error">
          <TextField ref={nameInput} id="patient-full-name" required name="full_name" type="text"
            autoComplete="name" value={fullName} disabled={saving || busy} onChange={(event) => setFullName(event.target.value)}
            aria-invalid={Boolean(fieldErrors.full_name)}
            aria-describedby={fieldErrors.full_name ? "patient-full-name-error" : undefined} />
        </FormField>
        <FormField className="patient-create__field" label="Data de nascimento" htmlFor="patient-birth-date"
          error={fieldErrors.birth_date} errorId="patient-birth-date-error">
          <TextField id="patient-birth-date" required name="birth_date" type="date" autoComplete="bday"
            value={birthDate} disabled={saving || busy} onChange={(event) => setBirthDate(event.target.value)}
            aria-invalid={Boolean(fieldErrors.birth_date)}
            aria-describedby={fieldErrors.birth_date ? "patient-birth-date-error" : undefined} />
        </FormField>
        <FormField className="patient-create__field" label="Sexo" htmlFor="patient-sex"
          error={fieldErrors.sex} errorId="patient-sex-error">
          <SelectField id="patient-sex" required name="sex" value={sex} onChange={(event) => setSex(event.target.value)}
            aria-invalid={Boolean(fieldErrors.sex)}
            disabled={saving || busy} aria-describedby={fieldErrors.sex ? "patient-sex-error" : undefined}>
            <option value="">Selecione</option>
            <option value="M">Masculino</option>
            <option value="F">Feminino</option>
          </SelectField>
        </FormField>
        <FormField className="patient-create__field" label="CPF" htmlFor="patient-cpf"
          error={fieldErrors.cpf} errorId="patient-cpf-error">
          <TextField id="patient-cpf" name="cpf" type="text" inputMode="numeric" value={cpf}
            disabled={saving || busy} onChange={(event) => setCpf(event.target.value)} aria-invalid={Boolean(fieldErrors.cpf)}
            aria-describedby={fieldErrors.cpf ? "patient-cpf-error" : undefined} />
        </FormField>
        <FormField className="patient-create__field" label="Telefone" htmlFor="patient-phone"
          error={fieldErrors.phone} errorId="patient-phone-error">
          <TextField id="patient-phone" name="phone" type="tel" autoComplete="tel" value={phone}
            disabled={saving || busy} onChange={(event) => setPhone(event.target.value)} aria-invalid={Boolean(fieldErrors.phone)}
            aria-describedby={fieldErrors.phone ? "patient-phone-error" : undefined} />
        </FormField>
        <FormField className="patient-create__field" label="E-mail" htmlFor="patient-email"
          error={fieldErrors.email} errorId="patient-email-error">
          <TextField id="patient-email" name="email" type="email" autoComplete="email" value={email}
            disabled={saving || busy} onChange={(event) => setEmail(event.target.value)} aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? "patient-email-error" : undefined} />
        </FormField>
        <section className="patient-create__section" aria-labelledby="patient-address-title">
          <h3 id="patient-address-title" className="patient-create__section-title">Endereço</h3>
          <div className="patient-create__section-fields">
            <FormField className="patient-create__field" label="CEP" htmlFor="patient-postal-code">
              <TextField id="patient-postal-code" type="text" inputMode="numeric"
                autoComplete="postal-code" maxLength={9} value={postalCode}
                onChange={handlePostalCodeChange} disabled={saving || busy}
                aria-describedby={cepLookupStatus.message ? "patient-cep-status" : undefined} />
              {cepIntegrationActive === false && !cepLookupStatus.message && (
                <p className="patient-create__cep-status" role="status">Consulta automática desativada. Preencha o endereço manualmente.</p>
              )}
              {cepLookupStatus.message && (
                <p id="patient-cep-status" className={`patient-create__cep-status is-${cepLookupStatus.kind}`}
                  role="status" aria-live="polite">
                  {cepLookupStatus.message}
                </p>
              )}
            </FormField>
            <FormField className="patient-create__field" label="Endereço" htmlFor="patient-address">
              <TextField id="patient-address" type="text" autoComplete="address-line1" value={address}
                onChange={handleAddressChange} disabled={saving || busy} />
            </FormField>
            <FormField className="patient-create__field" label="Número" htmlFor="patient-address-number">
              <TextField id="patient-address-number" type="text" value={addressNumber}
                onChange={handleAddressNumberChange} disabled={saving || busy} />
            </FormField>
            <FormField className="patient-create__field" label="Cidade" htmlFor="patient-city">
              <TextField id="patient-city" type="text" autoComplete="address-level2" value={city}
                onChange={handleCityChange} disabled={saving || busy} />
            </FormField>
            <FormField className="patient-create__field" label="Estado (UF)" htmlFor="patient-state">
              <TextField id="patient-state" type="text" autoComplete="address-level1" maxLength={2}
                value={state} onChange={handleStateChange} disabled={saving || busy} />
            </FormField>
          </div>
        </section>
      </div>
      {saveError && <p className="patient-create__error" role="alert">{saveError}</p>}
      <div className="patient-create__actions">
        {extraActions && <div className="patient-create__secondary-actions">{extraActions}</div>}
        <div className="patient-create__primary-actions">
          <Button className="patient-create__save" type="submit" disabled={saving || busy}>
            {saving ? (editing ? "Atualizando..." : "Salvando...") : (editing ? "Atualizar" : "Salvar")}
          </Button>
          <Button className="patient-create__cancel" type="button" variant="secondary" disabled={saving || busy} onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </div>
    </form>
  );
}
