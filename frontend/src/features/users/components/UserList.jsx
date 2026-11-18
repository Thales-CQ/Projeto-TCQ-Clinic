import Button from "../../../components/Button/Button";
import SearchField from "../../../components/SearchField/SearchField";
import { userProfileLabel } from "../state/userListQuery";
import "../styles/UserList.css";

export default function UserList({
  onEdit, onRetry, canEdit = false, canChangeStatus = false,
  list,
}) {
  const { changeStatus, error, onSearchChange, search, searchInput,
    statusError, updating, updatingStatusId, visibleUsers } = list;
  const externalStatus = canChangeStatus && !canEdit;

  return (
    <div className="user-list">
      <header className="users__header user-list__header">
        <h2 id="users-title">Consultar usuários</h2>
        <label className="user-list__search">
          <svg className="user-list__search-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="10.8" cy="10.8" r="6.8" />
            <path d="m16 16 5 5" />
          </svg>
          <span className="users__sr-only">Pesquisar usuário</span>
          <SearchField ref={searchInput} value={search} placeholder="Pesquisar usuário" onChange={onSearchChange} />
        </label>
      </header>
      <div className="user-list__toolbar">
        <span className="user-list__count" role="status" aria-atomic="true">
          {updating ? "Atualizando resultados..." : error ? "Resultados indisponíveis" : (
            `${visibleUsers.length} ${visibleUsers.length === 1 ? "resultado" : "resultados"}`
          )}
        </span>
      </div>
      {statusError && <p className="user-list__message user-list__message--error" role="alert">{statusError}</p>}
      <div className="user-list__results" aria-busy={updating}>
        {updating ? <p className="user-list__message" role="status">Carregando usuários...</p> : error ? (
          <div>
            <p className="user-list__message user-list__message--error" role="alert">{error}</p>
            <Button variant="secondary" onClick={onRetry}>Tentar novamente</Button>
          </div>
        ) : visibleUsers.length === 0 ? (
          <p className="user-list__message" role="status">
            {list.appliedSearch ? "Nenhum usuário corresponde à pesquisa." : "Nenhum usuário encontrado."}
          </p>
        ) : null}
        {visibleUsers.length > 0 && (
          <div className={`user-list__results-content${updating || error ? " user-list__results-content--hidden" : ""}`}>
            <div className="user-list__wrapper" role="region" aria-labelledby="users-title" tabIndex={0}>
              <table className="user-list__table" aria-labelledby="users-title">
                <caption className="users__sr-only">Lista de usuários</caption>
                <thead><tr>
                  <th scope="col">Nome completo</th><th scope="col">Username</th><th scope="col">E-mail</th>
                  <th scope="col">Status</th><th scope="col">Perfis</th>{(canEdit || externalStatus) && <th scope="col">Ações</th>}
                </tr></thead>
                <tbody>{visibleUsers.map((user) => <tr key={user.id}>
                  <td data-label="Nome completo"><span className="user-list__name">{user.full_name || "Não informado"}</span></td>
                  <td data-label="Username">{user.username}</td>
                  <td data-label="E-mail">{user.email || "Não informado"}</td>
                  <td data-label="Status"><span className={`user-list__status user-list__status--${user.is_active ? "active" : "inactive"}`}>
                    {user.is_active ? "Ativo" : "Inativo"}
                  </span></td>
                  <td data-label="Perfis"><span className={`user-list__profiles${user.profiles?.length ? "" : " user-list__profiles--empty"}`}>
                    {userProfileLabel(user)}
                  </span></td>
                  {(canEdit || externalStatus) && <td data-label="Ações"><div className="user-list__actions">
                    {canEdit && <Button className="user-list__edit" variant="secondary" onClick={() => onEdit(user.id)}
                      aria-label={`Editar ${user.full_name || user.username}`}>Editar</Button>}
                    {externalStatus && <Button className={`user-edit__status-button user-edit__status-button--${user.is_active ? "inactive" : "active"}`}
                      variant="secondary" disabled={updatingStatusId !== null}
                      onClick={() => changeStatus(user)}>
                      {user.is_active ? "Inativar" : "Reativar"}
                    </Button>}
                  </div></td>}
                </tr>)}</tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
