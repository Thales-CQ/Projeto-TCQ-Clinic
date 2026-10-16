export const navigationItems = [
  {
    id: "inicio", label: "Início", href: "#/inicio",
  },
  {
    id: "atendimento", label: "Atendimento",
    children: [
      {
        id: "pacientes", routeId: "pacientes-consultar", pageId: "pacientes",
        label: "Pacientes", href: "#/pacientes/consultar", view: "consultar",
        permission: "patients.view", createPermission: "patients.create",
        createRouteId: "pacientes-cadastrar", createHref: "#/pacientes/cadastrar",
        createView: "cadastrar",
      },
      { id: "agendamentos", label: "Agendamento", disabled: true },
      { id: "atendimentos", label: "Atendimento", disabled: true },
    ],
  },
  { id: "financeiro", label: "Financeiro", disabled: true },
  { id: "relatorios", label: "Relatório", disabled: true },
  {
    id: "configuracoes", label: "Configurações",
    children: [
      {
        id: "usuarios", routeId: "usuarios-consultar", pageId: "usuarios",
        label: "Usuários", href: "#/usuarios/consultar", view: "consultar",
        permission: "users.view", createPermission: "users.create",
        createPermissions: ["users.create", "users.assign_profiles"],
        createRouteId: "usuarios-cadastrar", createHref: "#/usuarios/cadastrar",
        createView: "cadastrar",
      },
      {
        id: "perfis", routeId: "perfis-consultar", pageId: "perfis",
        label: "Perfis", href: "#/perfis/consultar", view: "consultar",
        permission: "profiles.view", createPermission: "profiles.create",
        createRouteId: "perfis-cadastrar", createHref: "#/perfis/cadastrar",
        createView: "cadastrar",
      },
      {
        id: "integracao", routeId: "integracao-cep", pageId: "integracao",
        label: "Integração", href: "#/configuracoes/integracao",
        permission: "integrations.cep.view",
      },
    ],
  },
];

// Stable objects keep useSyncExternalStore snapshots consistent.
function flattenNavigation(items, moduleId, pageId) {
  return items.flatMap((item) => {
    const currentModuleId = moduleId ?? item.id;
    const currentPageId = item.pageId ?? pageId;
    if (item.disabled) return [];
    if (item.children?.length) return flattenNavigation(item.children, currentModuleId, currentPageId);
    return [{ ...item, routeId: item.routeId ?? item.id, id: currentPageId ?? currentModuleId, moduleId: currentModuleId }];
  });
}

const destinations = flattenNavigation(navigationItems);

export function isAdminAwaitingCepPermission(destination, user) {
  return destination?.id === "integracao"
    && user?.is_admin === true
    && !(Array.isArray(user?.permissions)
      && user.permissions.includes("integrations.cep.view"));
}

// Internal module navigation remains hash-addressable without exposing these
// actions as expandable items in the main menu.
destinations.push(
  { id: "pacientes", moduleId: "atendimento", routeId: "pacientes-cadastrar", label: "Cadastrar paciente", href: "#/pacientes/cadastrar", view: "cadastrar", permission: "patients.create" },
  { id: "usuarios", moduleId: "configuracoes", routeId: "usuarios-cadastrar", label: "Cadastrar usuário", href: "#/usuarios/cadastrar", view: "cadastrar", permission: "users.create", requiredPermissions: ["users.create", "users.assign_profiles"] },
  { id: "perfis", moduleId: "configuracoes", routeId: "perfis-cadastrar", label: "Cadastrar perfil", href: "#/perfis/cadastrar", view: "cadastrar", permission: "profiles.create" },
);

destinations.push({
  id: "alterar-senha", moduleId: "alterar-senha", routeId: "alterar-senha",
  label: "Alterar minha senha", href: "#/alterar-senha",
});

export function resolveDestination(hash) {
  const href = ["#/pacientes", "#/usuarios", "#/perfis"].includes(hash) ? `${hash}/consultar` : hash;
  return destinations.find((item) => item.href === href) ?? destinations[0];
}

export function findDestination(destinationId) {
  const routeId = ["pacientes", "usuarios", "perfis"].includes(destinationId) ? `${destinationId}-consultar` : destinationId;
  return destinations.find((item) => item.routeId === routeId);
}


export function navigationForUser(user) {
  const permissions = Array.isArray(user?.permissions) ? user.permissions : [];
  const can = (code) => permissions.includes(code);
  const hasPermissionSet = (sets) => sets.some((set) => set.every(can));

  function filterItems(items) {
    return items.flatMap((item) => {
      if (item.disabled) return [item];
      if (item.children?.length) {
        const children = filterItems(item.children);
        const hasAuthorizedChild = children.some((child) => !child.disabled);
        return hasAuthorizedChild ? [{ ...item, children }] : [];
      }
      if (item.requiredPermissionSets && !hasPermissionSet(item.requiredPermissionSets)) return [];
      if (!item.permission || can(item.permission)) return [item];
      // Keep the activation route discoverable to a structural administrator
      // while the CEP permission migration is pending. The route shows a
      // dependency notice; the API remains protected by backend permissions.
      if (item.id === "integracao" && user?.is_admin === true) return [item];
      const createPermissions = item.createPermissions ?? (item.createPermission ? [item.createPermission] : []);
      if (createPermissions.length > 0 && createPermissions.every(can)) {
        return [{
          ...item,
          routeId: item.createRouteId,
          href: item.createHref,
          view: item.createView,
        }];
      }
      return [];
    });
  }

  return filterItems(navigationItems);
}

export function permissionForDestination(destination) {
  if (!destination) return null;
  if (destination.id === "integracao") return "integrations.cep.view";
  if (destination.view === "cadastrar") {
    return `${destination.id === "pacientes" ? "patients" : destination.id === "usuarios" ? "users" : "profiles"}.create`;
  }
  if (["pacientes", "usuarios", "perfis"].includes(destination.id)) {
    return `${destination.id === "pacientes" ? "patients" : destination.id === "usuarios" ? "users" : "profiles"}.view`;
  }
  return null;
}

export function canAccessDestination(destination, user) {
  const permissions = Array.isArray(user?.permissions) ? user.permissions : [];
  if (isAdminAwaitingCepPermission(destination, user)) return true;
  if (destination?.requiredPermissionSets) {
    return destination.requiredPermissionSets.some((set) => set.every((code) => permissions.includes(code)));
  }
  const permission = permissionForDestination(destination);
  const required = destination?.requiredPermissions ?? (permission === null ? [] : [permission]);
  return required.every((code) => permissions.includes(code));
}
