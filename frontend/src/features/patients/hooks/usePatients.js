import { useEffect, useState } from "react";
import { useAuth } from "../../../hooks/useAuth";
import { getPatients } from "../../../services/api";

const PER_PAGE = 20;

export default function usePatients({ view, onViewChange, onEditPatient }) {
  const { hasPermission } = useAuth();
  const creating = view === "cadastrar";
  const [editingPatientId, setEditingPatientId] = useState(null);
  const [patientPage, setPatientPage] = useState({ patients: [], total: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const normalizedSearch = search.trim();
  const canEdit = hasPermission("patients.update");
  const canChangeStatus = hasPermission("patients.change_status");
  const editing = !creating && editingPatientId !== null && canEdit;

  useEffect(() => {
    function resetPatientViewState() {
      setEditingPatientId(null);
      setError("");
    }

    window.addEventListener("hashchange", resetPatientViewState);
    return () => window.removeEventListener("hashchange", resetPatientViewState);
  }, []);

  useEffect(() => {
    if (creating || editing) return undefined;

    let active = true;
    const timeoutId = setTimeout(() => {
      setLoading(true);
      setError("");
      let correctingPage = false;
      getPatients(page, PER_PAGE, normalizedSearch).then(
        (data) => {
          if (!active) return;
          setPatientPage({ patients: data.patients, total: data.total });
          const lastPage = Math.max(1, Math.ceil(data.total / PER_PAGE));
          if (page > lastPage) {
            correctingPage = true;
            setPage(lastPage);
          }
        },
        (failure) => {
          if (!active) return;
          setPatientPage({ patients: [], total: 0 });
          setError(failure.message);
        },
      ).finally(() => {
        if (active && !correctingPage) setLoading(false);
      });
    }, 300);

    return () => {
      active = false;
      clearTimeout(timeoutId);
    };
  }, [page, normalizedSearch, creating, editing]);

  function handleSearchChange(event) {
    const nextSearch = event.target.value;
    if (nextSearch.trim() !== normalizedSearch || page !== 1) {
      setLoading(true);
      setError("");
    }
    setSearch(nextSearch);
    setPage(1);
  }

  function handlePageChange(nextPage) {
    const totalPages = Math.max(1, Math.ceil(patientPage.total / PER_PAGE));
    if (loading || !Number.isInteger(nextPage) || nextPage < 1 || nextPage > totalPages || nextPage === page) return;
    setLoading(true);
    setError("");
    setPage(nextPage);
  }

  function handleCreated() {
    setLoading(true);
    setPage(1);
    onViewChange("consultar");
  }

  function handleCreateCanceled() {
    setLoading(true);
    onViewChange("consultar");
  }

  function handleEditPatient(patient) {
    onEditPatient?.(patient);
    setEditingPatientId(patient.id);
  }

  function handleUpdated() {
    setLoading(true);
    setEditingPatientId(null);
  }

  function handleStatusUpdated(updatedPatient) {
    setPatientPage((current) => ({
      ...current,
      patients: current.patients.map((patient) => (
        patient.id === updatedPatient.id ? updatedPatient : patient
      )),
    }));
  }

  function handleEditCanceled() {
    setLoading(true);
    setEditingPatientId(null);
  }

  return {
    canChangeStatus,
    canEdit,
    creating,
    editing,
    editingPatientId,
    error,
    handleCreateCanceled,
    handleCreated,
    handleEditCanceled,
    handleEditPatient,
    handlePageChange,
    handleSearchChange,
    handleStatusUpdated,
    handleUpdated,
    loading,
    page,
    patientPage,
    perPage: PER_PAGE,
    search,
    setEditingPatientId,
    setError,
  };
}
