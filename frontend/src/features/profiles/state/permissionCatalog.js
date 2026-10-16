export const permissionGroups = [
  {
    id: "patients",
    label: "Pacientes",
    permissions: [
      ["patients.view", "Consultar pacientes"],
      ["patients.create", "Cadastrar pacientes"],
      ["patients.update", "Editar pacientes"],
      ["patients.change_status", "Alterar status de pacientes"],
    ],
  },
  {
    id: "users",
    label: "Usuários",
    permissions: [
      ["users.view", "Consultar usuários"],
      ["users.create", "Cadastrar usuários"],
      ["users.update", "Editar usuários"],
      ["users.change_status", "Alterar status de usuários"],
      ["users.reset_password", "Redefinir senhas de usuários"],
      ["users.assign_profiles", "Atribuir perfis a usuários"],
    ],
  },
  {
    id: "profiles",
    label: "Perfis",
    permissions: [
      ["profiles.view", "Consultar perfis"],
      ["profiles.create", "Cadastrar perfis"],
      ["profiles.update", "Editar perfis"],
    ],
  },
  {
    id: "integrations",
    label: "Integração de CEP",
    permissions: [
      ["integrations.cep.view", "Consultar configuração de CEP"],
      ["integrations.cep.configure", "Configurar provedor de CEP"],
      ["integrations.cep.manage", "Gerenciar credencial do provedor"],
      ["integrations.cep.lookup", "Testar consulta de CEP"],
    ],
  },
];

const labels = new Map(permissionGroups.flatMap((group) => group.permissions));

export function permissionLabel(code) {
  return labels.get(code) ?? code;
}

export function groupedPermissions(catalog) {
  const byCode = new Map((Array.isArray(catalog) ? catalog : []).map((permission) => [permission.code, permission]));
  return permissionGroups.map((group) => ({
    ...group,
    permissions: group.permissions
      .map(([code, label]) => ({ ...byCode.get(code), code, label }))
      .filter((permission) => permission.id !== undefined),
  })).filter((group) => group.permissions.length > 0);
}

export function permissionIdsFromProfile(profile) {
  return Array.isArray(profile?.permission_ids) ? profile.permission_ids : [];
}

export function togglePermissionId(selectedIds, permissionId, checked) {
  const selected = new Set(selectedIds);
  if (checked) selected.add(permissionId);
  else selected.delete(permissionId);
  return [...selected];
}
