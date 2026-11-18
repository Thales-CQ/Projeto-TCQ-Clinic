import Button from "../../../components/Button/Button";
import SearchField from "../../../components/SearchField/SearchField";
import "../styles/PatientList.css";

export default function PatientList({
  patients,
  loading,
  error,
  page,
  total,
  perPage,
  search = "",
  onSearchChange,
  onPageChange,
  tableContent,
}) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <>
      <header className="patients__header patient-list__header">
        <h2 id="patients-title">Consultar pacientes</h2>
        <label className="patient-list__search patients__search">
          <svg className="patient-list__search-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="10.8" cy="10.8" r="6.8" />
            <path d="m16 16 5 5" />
          </svg>
          <span className="patient-list__search-label">Pesquisar paciente</span>
          <SearchField value={search} placeholder="Pesquisar paciente" onChange={onSearchChange} />
        </label>
      </header>
      <div className="patient-list__toolbar">
        <span className="patient-list__count" role="status" aria-atomic="true">
          {loading ? "Atualizando resultados..." : error ? "Resultados indisponíveis" : (
            `${total} ${total === 1 ? "resultado" : "resultados"}`
          )}
        </span>
      </div>
      <div className="patient-list__results" aria-busy={loading}>
        {loading ? (
          <p className="patient-list__message" role="status">Carregando pacientes...</p>
        ) : error ? (
          <p className="patient-list__message patient-list__message--error" role="alert">{error}</p>
        ) : total === 0 ? (
          <p className="patient-list__message" role="status">
            {search.trim() ? "Nenhum paciente corresponde à pesquisa." : "Nenhum paciente encontrado."}
          </p>
        ) : null}
        {patients.length > 0 && (
          <div className={loading || error ? "patient-list__results-content patient-list__results-content--hidden" : "patient-list__results-content"}>
            {tableContent}
          </div>
        )}
      </div>
      {totalPages > 1 && (
        <nav className="patient-list__pagination" aria-label="Paginação de pacientes">
          <Button variant="secondary" disabled={loading || page <= 1} onClick={() => onPageChange(page - 1)}>
            Anterior
          </Button>
          <span className="patient-list__count" role="status" aria-atomic="true">
            {loading ? "Atualizando página..." : `Página ${page} de ${totalPages}`}
          </span>
          <Button variant="secondary" disabled={loading || page >= totalPages} onClick={() => onPageChange(page + 1)}>
            Próxima
          </Button>
        </nav>
      )}
    </>
  );
}
