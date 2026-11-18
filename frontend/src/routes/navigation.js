export const navigationItems = [
  {
    id: "inicio", label: "Início", icon: "home", href: "#/inicio",
  },
  {
    id: "pacientes", label: "Pacientes", icon: "patients",
    children: [
      {
        id: "pacientes-consultar", routeId: "pacientes-consultar", pageId: "pacientes",
        label: "Consultar pacientes", icon: "search", href: "#/pacientes/consultar", view: "consultar",
        permission: "patients.view",
      },
      {
        id: "pacientes-cadastrar", routeId: "pacientes-cadastrar", pageId: "pacientes",
        label: "Cadastrar paciente", icon: "userPlus", href: "#/pacientes/cadastrar", view: "cadastrar",
        permission: "patients.create",
      },
    ],
  },
  {
    id: "configuracoes", label: "Configurações", icon: "settings",
    children: [
      {
        id: "usuarios-consultar", routeId: "usuarios-consultar", pageId: "usuarios",
        label: "Consultar colaboradores", icon: "users", href: "#/usuarios/consultar", view: "consultar",
        permission: "users.view",
      },
      {
        id: "usuarios-cadastrar", routeId: "usuarios-cadastrar", pageId: "usuarios",
        label: "Cadastrar colaborador", icon: "account", href: "#/usuarios/cadastrar", view: "cadastrar",
        permission: "users.create",
        requiredPermissions: ["users.view", "users.create", "users.assign_profiles"],
      },
      {
        id: "perfis-consultar", routeId: "perfis-consultar", pageId: "perfis",
        label: "Consultar perfis", icon: "profile", href: "#/perfis/consultar", view: "consultar",
        permission: "profiles.view",
      },
      {
        id: "perfis-cadastrar", routeId: "perfis-cadastrar", pageId: "perfis",
        label: "Cadastrar perfil", icon: "shield", href: "#/perfis/cadastrar", view: "cadastrar",
        permission: "profiles.create",
        requiredPermissions: ["profiles.view", "profiles.create"],
      },
      {
        id: "integracao", routeId: "integracao-cep", pageId: "integracao",
        label: "Integração", icon: "plug", href: "#/configuracoes/integracao",
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

// Personal account destinations remain hash-addressable without appearing in the main menu.
destinations.push(
  { id: "meu-perfil", moduleId: "minha-conta", routeId: "meu-perfil", label: "Meu perfil", href: "#/minha-conta", view: "perfil" },
  { id: "alterar-senha", moduleId: "minha-conta", routeId: "alterar-senha", label: "Alterar senha", href: "#/alterar-senha", view: "senha" },
);

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
      if (item.requiredPermissions && !item.requiredPermissions.every(can)) return [];
      if (!item.permission || can(item.permission)) return [item];
      // Keep the activation route discoverable to a structural administrator
      // while the CEP permission migration is pending. The route shows a
      // dependency notice; the API remains protected by backend permissions.
      if (item.id === "integracao" && user?.is_admin === true) return [item];
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
