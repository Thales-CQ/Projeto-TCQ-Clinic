import PatientEditFeature from "./PatientEditFeature";
import PatientFormFeature from "./PatientFormFeature";
import PatientListFeature from "./PatientListFeature";
import Patients from "./components/Patients";
import usePatients from "./hooks/usePatients";

export default function PatientsFeature({ view = "consultar", onViewChange, onEditPatient }) {
  const patients = usePatients({ view, onViewChange, onEditPatient });
  const content = patients.creating ? (
    <PatientFormFeature onCreated={patients.handleCreated} onCancel={patients.handleCreateCanceled} />
  ) : patients.editing ? (
    <PatientEditFeature
      patientId={patients.editingPatientId}
      onUpdated={patients.handleUpdated}
      onCancel={patients.handleEditCanceled}
      canChangeStatus={patients.canChangeStatus}
    />
  ) : (
    <PatientListFeature
      patients={patients.patientPage.patients}
      loading={patients.loading}
      error={patients.error}
      page={patients.page}
      total={patients.patientPage.total}
      perPage={patients.perPage}
      search={patients.search}
      onSearchChange={patients.handleSearchChange}
      onPageChange={patients.handlePageChange}
      onEditPatient={patients.handleEditPatient}
      onStatusUpdated={patients.handleStatusUpdated}
      canEdit={patients.canEdit}
      canChangeStatus={patients.canChangeStatus}
    />
  );

  return (
    <Patients
      creating={patients.creating}
      editing={patients.editing}
    >
      {content}
    </Patients>
  );
}
