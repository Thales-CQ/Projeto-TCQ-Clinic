import { useState } from "react";
import { useAuth } from "../../../hooks/useAuth";

export default function useProfiles({ view = "consultar", onViewChange }) {
  const { hasPermission } = useAuth();
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [reload, setReload] = useState(0);
  const creating = view === "cadastrar";
  const editing = !creating && editingId !== null;
  const canView = hasPermission("profiles.view");

  function handleSaved(wasEditing = false) {
    setEditingId(null);
    setReload((current) => current + 1);
    setMessage(wasEditing ? "Perfil atualizado com sucesso." : "Perfil cadastrado com sucesso.");
    if (wasEditing || canView) onViewChange("consultar");
  }

  return {
    canEdit: hasPermission("profiles.update"),
    canView,
    creating,
    editing,
    editingId,
    handleSaved,
    message,
    onEdit: (id) => { setMessage(""); setEditingId(id); },
    onRetry: () => setReload((current) => current + 1),
    reload,
    resetEditing: () => setEditingId(null),
  };
}
