import { useCallback, useState } from "react";
import { useAuth } from "../../../hooks/useAuth";
import { userEditCapabilities } from "../state/userEditCapabilities";

export default function useUsers({ view = "consultar", onViewChange }) {
  const { hasPermission, reconcileUser, refreshSession } = useAuth();
  const [editingId, setEditingId] = useState(null);
  const [reload, setReload] = useState(0);
  const [message, setMessage] = useState("");
  const [denied, setDenied] = useState(false);
  const creating = view === "cadastrar";
  const { canOpenEdit: canEdit, canUpdateData, canChangeStatus,
    canAssignProfiles, canResetPassword } = userEditCapabilities(hasPermission);

  const handleFailure = useCallback((failure) => {
    if (failure.status === 403 && !failure.isCsrf) {
      setDenied(true);
      // Hide local data while rechecking a privilege revoked from another session.
      refreshSession();
    }
  }, [refreshSession]);

  function saved(savedUser) {
    reconcileUser(savedUser);
    setEditingId(null);
    setReload((current) => current + 1);
    setMessage(creating ? "Usuário cadastrado com sucesso." : "Usuário atualizado com sucesso.");
    onViewChange("consultar");
  }

  const canCreate = hasPermission("users.create") && hasPermission("users.assign_profiles");
  const canView = hasPermission("users.view");
  const canAccess = creating ? canView && canCreate : canView;
  return {
    canAccess: canAccess && !denied,
    canAssignProfiles,
    canChangeStatus,
    canEdit,
    canResetPassword,
    canUpdateData,
    creating,
    denied,
    editingId,
    handleFailure,
    message,
    onEdit: (id) => { setMessage(""); setEditingId(id); },
    onRetry: () => setReload((current) => current + 1),
    onSaved: saved,
    reload,
    setEditingId,
  };
}
