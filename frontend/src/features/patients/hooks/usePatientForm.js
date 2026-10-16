import { useEffect, useRef, useState } from "react";
import { createPatient, getCepIntegration, lookupCep, updatePatient } from "../../../services/api";
import { publishCepIntegrationStatus, subscribeCepIntegrationStatus } from "../../../services/cepIntegrationStatus.js";
import { createPatientCepLookup, formatPostalCode } from "../state/patientCepLookup.js";

export default function usePatientForm({
  patient = null,
  mode = "create",
  canChangeStatus = false,
  onCreated,
  onUpdated,
}) {
  const editing = mode === "edit" && patient;
  const [fullName, setFullName] = useState(patient?.full_name || "");
  const [birthDate, setBirthDate] = useState(patient?.birth_date || "");
  const [sex, setSex] = useState(patient?.sex || "");
  const [cpf, setCpf] = useState(patient?.cpf || "");
  const [phone, setPhone] = useState(patient?.phone || "");
  const [email, setEmail] = useState(patient?.email || "");
  const [postalCode, setPostalCode] = useState(() => formatPostalCode(patient?.postal_code || patient?.cep || ""));
  const [address, setAddress] = useState(patient?.address || "");
  const [addressNumber, setAddressNumber] = useState(patient?.address_number || "");
  const [city, setCity] = useState(patient?.city || "");
  const [state, setState] = useState(patient?.state || patient?.uf || "");
  const [cepLookupStatus, setCepLookupStatus] = useState({ kind: "idle", message: "" });
  const [cepIntegrationActive, setCepIntegrationActive] = useState(null);
  const cepLookup = useRef(null);
  if (!cepLookup.current) {
    cepLookup.current = createPatientCepLookup({
      lookup: lookupCep,
      enabled: false,
      onResult(updates) {
        if (Object.hasOwn(updates, "address")) setAddress(updates.address);
        if (Object.hasOwn(updates, "city")) setCity(updates.city);
        if (Object.hasOwn(updates, "state")) setState(updates.state);
      },
      onStatus: setCepLookupStatus,
    });
  }
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const nameInput = useRef(null);

  function handlePostalCodeChange(event) {
    const formatted = formatPostalCode(event.target.value);
    setPostalCode(formatted);
    cepLookup.current.setCep(formatted);
  }

  function updateAddressField(field, setter, value) {
    cepLookup.current.markManuallyEdited(field);
    setter(value);
  }

  function handleAddressChange(event) {
    updateAddressField("address", setAddress, event.target.value);
  }

  function handleAddressNumberChange(event) {
    setAddressNumber(event.target.value);
  }

  function handleCityChange(event) {
    updateAddressField("city", setCity, event.target.value);
  }

  function handleStateChange(event) {
    updateAddressField("state", setState, event.target.value.toUpperCase().slice(0, 2));
  }

  useEffect(() => {
    nameInput.current?.focus();
    let active = true;
    cepLookup.current.setEnabled(false);
    const unsubscribe = subscribeCepIntegrationStatus((status) => {
      if (!active) return;
      setCepIntegrationActive(status);
      cepLookup.current.setEnabled(status === true);
    });
    getCepIntegration().catch(() => {
      if (active) {
        publishCepIntegrationStatus(null);
        setCepIntegrationActive(null);
        cepLookup.current.setEnabled(false);
      }
    });
    return () => {
      active = false;
      unsubscribe();
      cepLookup.current.dispose();
    };
  }, []);

  function resetForm() {
    setFullName("");
    setBirthDate("");
    setSex("");
    setCpf("");
    setPhone("");
    setEmail("");
    setPostalCode("");
    setAddress("");
    setAddressNumber("");
    setCity("");
    setState("");
    cepLookup.current.reset();
    setSaveError("");
    setFieldErrors({});
    setSaving(false);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const payload = {
      full_name: fullName,
      birth_date: birthDate || null,
      sex,
      cpf: cpf || null,
      phone: phone || null,
      email: email || null,
      postal_code: postalCode.replace(/\D/g, "") || null,
      address: address || null,
      address_number: addressNumber || null,
      city: city || null,
      state: state || null,
    };
    if (editing && canChangeStatus) payload.is_active = patient.is_active;
    setSaving(true);
    setSaveError("");
    setFieldErrors({});
    try {
      const data = editing
        ? await updatePatient(patient.id, payload)
        : await createPatient(payload);
      if (editing) {
        await onUpdated(data.patient);
        resetForm();
      } else {
        resetForm();
        onCreated(data.patient);
      }
    } catch (error) {
      if (error.errors) {
        setFieldErrors(error.errors);
      } else if (error.status === 409 && error.message === "CPF já cadastrado.") {
        setFieldErrors((current) => ({ ...current, cpf: error.message }));
      } else {
        setSaveError(error.message);
      }
    } finally {
      setSaving(false);
    }
  }

  return {
    birthDate,
    cpf,
    editing,
    email,
    fieldErrors,
    fullName,
    handleSubmit,
    nameInput,
    phone,
    postalCode,
    address,
    addressNumber,
    city,
    state,
    cepLookupStatus,
    cepIntegrationActive,
    handlePostalCodeChange,
    handleAddressChange,
    handleAddressNumberChange,
    handleCityChange,
    handleStateChange,
    recordNumber: typeof patient?.record_number === "string" ? patient.record_number : "",
    saveError,
    saving,
    setBirthDate,
    setCpf,
    setEmail,
    setFullName,
    setPhone,
    setSex,
    sex,
  };
}
