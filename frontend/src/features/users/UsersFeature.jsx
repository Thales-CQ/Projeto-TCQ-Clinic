import UserEditFeature from "./UserEditFeature";
import UserFormFeature from "./UserFormFeature";
import UserListFeature from "./UserListFeature";
import Users from "./components/Users";
import useUsers from "./hooks/useUsers";

export default function UsersFeature({ view = "consultar", onViewChange }) {
  const users = useUsers({ view, onViewChange });
  if (!users.canAccess) return <p role="alert" className="users__error">Acesso não autorizado.</p>;

  const content = users.creating ? (
    <>
      {users.message && <p className="users__success" role="status">{users.message}</p>}
      <UserFormFeature onSaved={users.onSaved} onFailure={users.handleFailure}
        onCancel={() => onViewChange("consultar")} />
    </>
  ) : users.editingId !== null && users.canEdit ? (
    <>
      {users.message && <p className="users__success" role="status">{users.message}</p>}
      <UserEditFeature key={users.editingId} userId={users.editingId} onSaved={users.onSaved}
        onFailure={users.handleFailure} onCancel={() => users.setEditingId(null)}
        canUpdateData={users.canUpdateData} canChangeStatus={users.canChangeStatus}
        canResetPassword={users.canResetPassword} canAssignProfiles={users.canAssignProfiles} />
    </>
  ) : (
    <>
      {users.message && <p className="users__success" role="status">{users.message}</p>}
      <UserListFeature key={users.reload} onFailure={users.handleFailure} onRetry={users.onRetry}
        onEdit={users.onEdit} canEdit={users.canEdit} canChangeStatus={users.canChangeStatus} />
    </>
  );

  return <Users creating={users.creating} editing={users.editingId !== null && users.canEdit}>
    {content}
  </Users>;
}
