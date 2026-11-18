import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { apiBirthDate, displayBirthDate, maskBirthDate, validatePasswordConfirmation, validateUserFullName } from "../src/features/users/state/userForm.js";
import { canAccessDestination, findDestination, isAdminAwaitingCepPermission, permissionForDestination, resolveDestination, navigationForUser } from "../src/routes/navigation.js";
import { userEditCapabilities } from "../src/features/users/state/userEditCapabilities.js";

// Run with node --test tests/*.test.mjs; no extra dependencies.
test("user edit permissions are independent", () => {
  const cases = [
    [["users.update"], ["canOpenEdit", "canUpdateData"]],
    [["users.assign_profiles"], ["canOpenEdit", "canAssignProfiles"]],
    [["users.reset_password"], ["canOpenEdit", "canResetPassword"]],
    [["users.assign_profiles", "users.reset_password"], ["canOpenEdit", "canAssignProfiles", "canResetPassword"]],
    [["users.change_status"], ["canChangeStatus"]],
    [["users.update", "users.change_status"], ["canOpenEdit", "canUpdateData", "canChangeStatus"]],
    [[], []],
  ];
  for (const [permissions, expected] of cases) {
    const result = userEditCapabilities((code) => permissions.includes(code));
    for (const key of ["canOpenEdit", "canUpdateData", "canAssignProfiles", "canResetPassword", "canChangeStatus"]) {
      assert.equal(result[key], expected.includes(key), `${permissions.join(",")} ${key}`);
    }
  }
});

test("user full name requires two words and accepts particles and extra spaces", () => {
  for (const value of ["JOÃO", " MARIA ", "   ", "JOÃO -"]) {
    assert.throws(() => validateUserFullName(value), /nome e sobrenome/);
  }
  for (const value of ["JOÃO SILVA", "MARIA SOUZA", " João  da Silva ", "ANA MARIA COSTA", "A B"]) {
    validateUserFullName(value);
  }
});

test("new user form has no status control", async () => {
  const vite = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    cacheDir: "/tmp/clinica-vite-tests",
  });
  try {
    const { default: UserCreate } = await vite.ssrLoadModule("/src/features/users/UserFormFeature.jsx");
    const html = renderToStaticMarkup(createElement(UserCreate, { onSaved() {}, onCancel() {} }));
    assert.doesNotMatch(html, /name="is_active"|id="user-active"|>Status</);
    assert.doesNotMatch(html, /name="is_admin"/);
    assert.match(html, /Perfil de usuário/);
    assert.match(html, /Carregando perfis/);
    assert.match(html, /name="password"/);
    assert.match(html, /placeholder="DD\/MM\/AAAA"/);
    assert.match(html, /placeholder="Mínimo de 12 caracteres\."/);
    assert.doesNotMatch(html, /id="user-birth-date-hint"|id="user-password-hint"/);
    const { default: PasswordForm } = await vite.ssrLoadModule("/src/components/PasswordForm/PasswordForm.jsx");
    const passwordHtml = renderToStaticMarkup(createElement(PasswordForm, {
      showCurrentPassword: true,
      onSubmit() {},
      onCancel() {},
    }));
    assert.match(passwordHtml, /placeholder="Mínimo de 12 caracteres\."/);
    assert.doesNotMatch(passwordHtml, /<p class="users__hint">Use uma nova senha/);
  } finally {
    await vite.close();
  }
});

test("header and dashboard prefer full name and fall back to legacy username", async () => {
  const vite = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    cacheDir: "/tmp/clinica-vite-tests",
  });
  try {
    const [{ default: Header }, { default: Dashboard }, { ThemeContext }, { AuthContext }] = await Promise.all([
      vite.ssrLoadModule("/src/components/Header/Header.jsx"),
      vite.ssrLoadModule("/src/pages/Dashboard/Dashboard.jsx"),
      vite.ssrLoadModule("/src/contexts/ThemeContext.js"),
      vite.ssrLoadModule("/src/contexts/AuthContext.js"),
    ]);
    const renderHeader = (user) => renderToStaticMarkup(createElement(
      ThemeContext.Provider, { value: { theme: "light", toggleTheme() {}, themeUpdating: false } },
      createElement(Header, { user, onLogout() {} }),
    ));
    const renderDashboard = (user) => renderToStaticMarkup(createElement(
      AuthContext.Provider,
      { value: { refreshSession() {} } },
      createElement(Dashboard, { user }),
    ));
    const named = { full_name: "THALES COSTA QUEIROGA", username: "THALES" };
    const header = renderHeader(named);
    assert.match(header, /aria-label="Minha conta"/);
    assert.match(header, />Sair<\/button>/);
    assert.match(header, /href="#\/minha-conta">[\s\S]*?Meu perfil<\/a>/);
    assert.match(header, /href="#\/alterar-senha">[\s\S]*?Alterar senha<\/a>/);
    for (const html of [header, renderDashboard(named)]) {
      assert.match(html, /THALES COSTA QUEIROGA/);
      assert.doesNotMatch(html, /THALES(?:<|!)/);
    }
    const legacy = { full_name: null, username: "THALES" };
    assert.match(renderHeader(legacy), />THALES<\/strong>/);
    assert.match(renderDashboard(legacy), /Olá, THALES!/);
  } finally {
    await vite.close();
  }
});

test("Brazilian dates round-trip without timezone conversion", () => {
  for (const [display, api] of [["29/02/2000", "2000-02-29"], ["02/01/1980", "1980-01-02"], ["01/01/0001", "0001-01-01"]]) {
    assert.equal(apiBirthDate(display), api);
    assert.equal(displayBirthDate(api), display);
  }
  assert.equal(displayBirthDate(null), "");
});

test("invalid, non-Brazilian and future dates are rejected", () => {
  for (const value of ["29/02/1900", "31/04/2000", "01/13/2000", "00/01/2000", "01/01/0000", "1980-01-02", "1/1/1980", "01/01/9999", ""]) {
    assert.throws(() => apiBirthDate(value));
  }
});

test("confirmation and character-count policy match the API without trimming", () => {
  assert.throws(() => validatePasswordConfirmation("12345678901", "12345678901"));
  assert.throws(() => validatePasswordConfirmation("123456789012", "123456789013"));
  assert.throws(() => validatePasswordConfirmation("😀".repeat(6), "😀".repeat(6)));
  validatePasswordConfirmation("123456789012", "123456789012");
  validatePasswordConfirmation(" 12345678901", " 12345678901");
});

test("users and password hashes resolve to real views; patient routes remain intact", () => {
  assert.equal(resolveDestination("#/usuarios").routeId, "usuarios-consultar");
  assert.equal(resolveDestination("#/usuarios/cadastrar").view, "cadastrar");
  for (const hash of ["#/usuarios", "#/usuarios/consultar", "#/usuarios/cadastrar"]) {
    assert.equal(resolveDestination(hash).id, "usuarios");
    assert.equal(resolveDestination(hash).moduleId, "configuracoes");
  }
  assert.equal(findDestination("usuarios-cadastrar").href, "#/usuarios/cadastrar");
  assert.equal(findDestination("usuarios").href, "#/usuarios/consultar");
  assert.equal(resolveDestination("#/alterar-senha").id, "alterar-senha");
  assert.equal(resolveDestination("#/alterar-senha").moduleId, "minha-conta");
  assert.equal(findDestination("alterar-senha").href, "#/alterar-senha");
  assert.equal(resolveDestination("#/minha-conta").id, "meu-perfil");
  assert.equal(resolveDestination("#/minha-conta").moduleId, "minha-conta");
  assert.equal(resolveDestination("#/configuracoes/integracao").id, "integracao");
  assert.equal(resolveDestination("#/configuracoes/integracao").moduleId, "configuracoes");
  assert.equal(findDestination("integracao-cep").href, "#/configuracoes/integracao");
  assert.equal(resolveDestination("#/pacientes").routeId, "pacientes-consultar");
  assert.equal(resolveDestination("#/fake").id, "inicio");
});

test("navigation exposes permitted module options and the admin activation route", () => {
  for (const user of [null, {}, { is_admin: "true" }]) {
    assert.ok(!navigationForUser(user).some((item) => item.id === "configuracoes"));
  }
  const pendingAdminSettings = navigationForUser({ is_admin: true, permissions: [] })
    .find((item) => item.id === "configuracoes");
  assert.deepEqual(pendingAdminSettings.children.map((item) => item.label), ["Integração"]);
  const allSettings = navigationForUser({ is_admin: true, permissions: [
    "users.view", "users.create", "users.assign_profiles",
    "profiles.view", "profiles.create", "patients.view", "integrations.cep.view",
  ] });
  assert.ok(!allSettings.some((item) => item.id === "usuarios"));
  const full = allSettings.find((item) => item.id === "configuracoes");
  assert.deepEqual(full.children.map((item) => item.label), [
    "Consultar colaboradores", "Cadastrar colaborador",
    "Consultar perfis", "Cadastrar perfil", "Integração",
  ]);
  assert.deepEqual(full.children.map((item) => item.href), [
    "#/usuarios/consultar", "#/usuarios/cadastrar",
    "#/perfis/consultar", "#/perfis/cadastrar",
    "#/configuracoes/integracao",
  ]);
  assert.equal(full.children[0].children, undefined);
  assert.ok(!full.disabled);
  const partial = navigationForUser({ is_admin: true, permissions: [
    "users.view", "profiles.create", "patients.view", "integrations.cep.view",
  ] }).find((item) => item.id === "configuracoes");
  assert.deepEqual(partial.children.map((item) => item.label), [
    "Consultar colaboradores", "Integração",
  ]);
});

test("view permission is required for both consult and create options", () => {
  assert.equal(navigationForUser({ permissions: ["patients.view"] })
    .find((item) => item.id === "pacientes").children[0].href, "#/pacientes/consultar");
  assert.equal(navigationForUser({ permissions: ["patients.create"] })
    .find((item) => item.id === "pacientes").children[0].href, "#/pacientes/cadastrar");

  const settingsFor = (permissions) => navigationForUser({ permissions })
    .find((item) => item.id === "configuracoes");
  assert.equal(settingsFor(["users.create", "users.assign_profiles"]), undefined);
  assert.equal(settingsFor(["users.create"]), undefined);
  assert.equal(settingsFor(["profiles.create"]), undefined);
  assert.deepEqual(settingsFor(["users.view"]).children.map((item) => item.routeId), ["usuarios-consultar"]);
  assert.deepEqual(settingsFor(["profiles.view"]).children.map((item) => item.label), ["Consultar perfis"]);
  assert.deepEqual(
    settingsFor(["users.view", "users.create", "users.assign_profiles"]).children.map((item) => item.routeId),
    ["usuarios-consultar", "usuarios-cadastrar"],
  );
  assert.deepEqual(
    settingsFor(["profiles.view", "profiles.create"]).children.map((item) => item.routeId),
    ["perfis-consultar", "perfis-cadastrar"],
  );
});

test("integration navigation requires its own view permission", () => {
  const destination = resolveDestination("#/configuracoes/integracao");
  for (const permissions of [[], ["patients.view"], ["users.view"], ["profiles.view"]]) {
    const user = { permissions };
    assert.equal(canAccessDestination(destination, user), false, permissions.join(", "));
  }
  const permitted = { permissions: ["integrations.cep.view"] };
  assert.equal(canAccessDestination(destination, permitted), true);
  assert.ok(navigationForUser(permitted).find((item) => item.id === "configuracoes")
    ?.children.some((item) => item.id === "integracao"));
  for (const permission of ["integrations.cep.configure", "integrations.cep.manage", "integrations.cep.lookup"]) {
    assert.equal(canAccessDestination(destination, { permissions: [permission] }), false);
  }
  const pendingAdmin = { is_admin: true, permissions: [] };
  assert.equal(isAdminAwaitingCepPermission(destination, pendingAdmin), true);
  assert.equal(canAccessDestination(destination, pendingAdmin), true);
  assert.ok(navigationForUser(pendingAdmin).find((item) => item.id === "configuracoes")
    ?.children.some((item) => item.id === "integracao"));
  assert.equal(isAdminAwaitingCepPermission(destination, { is_admin: "true", permissions: [] }), false);
  assert.equal(isAdminAwaitingCepPermission(destination, permitted), false);
});

test("menu markup exposes permitted routes without a mobile toggle", async () => {
  const vite = await createServer({ configFile: false, server: { middlewareMode: true }, cacheDir: "/tmp/clinica-vite-tests" });
  try {
    const [{ default: Menu }, css] = await Promise.all([
      vite.ssrLoadModule("/src/components/Menu/Menu.jsx"),
      readFile(new URL("../src/components/Menu/Menu.css", import.meta.url), "utf8"),
    ]);
    const items = navigationForUser({ is_admin: true, permissions: [] });
    const html = renderToStaticMarkup(createElement(Menu, {
      items,
      currentDestination: resolveDestination("#/configuracoes/integracao"),
    }));

    assert.match(html, /aria-label="Navegação principal"/);
    assert.doesNotMatch(html, /menu__toggle|Abrir menu/);
    assert.match(html, /aria-label="Configurações"/);
    assert.match(html, />Configurações<\/button>/);
    assert.match(html, /class="menu__submenu-panel"[^>]*hidden/);
    assert.match(html, /class="menu__submenu"[^>]*hidden/);
    assert.match(html, />Integração<\/a>/);
    assert.match(css, /@media \(max-width: 760px\)/);
    assert.match(css, /\.menu__list > \.menu__item > \.menu__link/);
    assert.match(css, /\.menu__submenu\s*\{[^}]*width: 15rem/s);
    assert.match(css, /\.menu__submenu-panel \.menu__link/);
  } finally {
    await vite.close();
  }
});

test("module shells keep views without internal navigation links", async () => {
  const vite = await createServer({ configFile: false, server: { middlewareMode: true }, cacheDir: "/tmp/clinica-vite-tests" });
  try {
    const [{ default: Patients }, { default: Users }, { default: Profiles }, { AuthContext }] = await Promise.all([
      vite.ssrLoadModule("/src/features/patients/PatientsFeature.jsx"),
      vite.ssrLoadModule("/src/features/users/UsersFeature.jsx"),
      vite.ssrLoadModule("/src/features/profiles/ProfilesFeature.jsx"),
      vite.ssrLoadModule("/src/contexts/AuthContext.js"),
    ]);
    const permissions = [
      "patients.view", "patients.create", "users.view", "users.create",
      "users.assign_profiles", "profiles.view", "profiles.create",
    ];
    const renderWith = (Component, view) => renderToStaticMarkup(
      createElement(AuthContext.Provider, {
        value: {
          hasPermission: (code) => permissions.includes(code),
          reconcileUser() {},
          refreshSession() {},
        },
      }, createElement(Component, { view, onViewChange() {} })),
    );
    for (const Component of [Patients, Users, Profiles]) {
      for (const view of ["consultar", "cadastrar"]) {
        const html = renderWith(Component, view);
        assert.doesNotMatch(html, /class="module-sidebar/);
        assert.doesNotMatch(html, />Consultar<\/a>/);
        assert.doesNotMatch(html, />Cadastrar<\/a>/);
      }
    }
  } finally { await vite.close(); }
});

test("login uses the authoritative /auth/me user before completing", async () => {
  const vite = await createServer({ configFile: false, server: { middlewareMode: true }, cacheDir: "/tmp/clinica-vite-tests" });
  try {
    const { loginWithSession } = await vite.ssrLoadModule("/src/contexts/authState.js?authoritative-login");
    const calls = [];
    const user = {
      id: 2, username: "EQUIPE", is_admin: false,
      permissions: ["patients.view", "profiles.view", "users.view"],
    };
    const result = await loginWithSession("equipe", "senha", {
      async login() { calls.push("login"); return { user: { id: 2, is_admin: true } }; },
      async getSession() { calls.push("me"); return user; },
    });
    assert.deepEqual(calls, ["login", "me"]);
    assert.deepEqual(result, user);
    assert.deepEqual(result.permissions, ["patients.view", "profiles.view", "users.view"]);

    await assert.rejects(
      loginWithSession("equipe", "senha", {
        async login() { return { user: { id: 2, is_admin: true } }; },
        async getSession() { return null; },
      }),
      /Não foi possível validar a sessão após o login/,
    );
  } finally { await vite.close(); }
});

test("query tables omit the actions column when no row action is allowed", async () => {
  const vite = await createServer({ configFile: false, server: { middlewareMode: true }, cacheDir: "/tmp/clinica-vite-tests" });
  try {
    const [{ default: PatientList }, { default: UserList }, { default: ProfileList }] = await Promise.all([
      vite.ssrLoadModule("/src/features/patients/PatientListFeature.jsx"),
      vite.ssrLoadModule("/src/features/users/UserListFeature.jsx"),
      vite.ssrLoadModule("/src/features/profiles/ProfileListFeature.jsx"),
    ]);
    const patient = { id: 1, full_name: "Ana Silva", is_active: true };
    const user = { id: 1, username: "ANA", full_name: "Ana Silva", is_active: true, profiles: [] };
    const profile = { id: 1, name: "Equipe", is_active: true };
    const render = (Component, props) => renderToStaticMarkup(createElement(Component, props));
    for (const [Component, props] of [
      [PatientList, { patients: [patient], loading: false, total: 1, perPage: 20, canEdit: false }],
      [UserList, { onFailure() {}, initialUsers: [user], initialLoading: false, canEdit: false }],
      [ProfileList, { onEdit() {}, initialProfiles: [profile], initialLoading: false, canEdit: false }],
    ]) {
      const html = render(Component, props);
      assert.doesNotMatch(html, />Ações</);
    }
    for (const [Component, props] of [
      [PatientList, { patients: [patient], loading: false, total: 1, perPage: 20, canEdit: true }],
      [UserList, { onFailure() {}, initialUsers: [user], initialLoading: false, canEdit: true }],
      [ProfileList, { onEdit() {}, initialProfiles: [profile], initialLoading: false, canEdit: true }],
    ]) {
      const html = render(Component, props);
      assert.match(html, />Ações</);
      assert.match(html, />Editar</);
    }
  } finally { await vite.close(); }
});

test("direct destinations require module permissions while password remains personal", () => {
  const patientsList = resolveDestination("#/pacientes/consultar");
  const patientsCreate = resolveDestination("#/pacientes/cadastrar");
  const usersList = resolveDestination("#/usuarios/consultar");
  const usersCreate = resolveDestination("#/usuarios/cadastrar");
  const profilesList = resolveDestination("#/perfis/consultar");
  const profilesCreate = resolveDestination("#/perfis/cadastrar");
  assert.equal(permissionForDestination(patientsList), "patients.view");
  assert.equal(permissionForDestination(patientsCreate), "patients.create");
  assert.equal(permissionForDestination(usersList), "users.view");
  assert.equal(permissionForDestination(usersCreate), "users.create");
  assert.equal(permissionForDestination(profilesList), "profiles.view");
  assert.equal(permissionForDestination(profilesCreate), "profiles.create");
  assert.equal(permissionForDestination(resolveDestination("#/alterar-senha")), null);
  assert.equal(canAccessDestination(patientsList, { permissions: ["patients.create"] }), false);
  assert.equal(canAccessDestination(patientsCreate, { permissions: ["patients.create"] }), true);
  assert.equal(canAccessDestination(usersCreate, { permissions: ["users.create"] }), false);
  assert.equal(canAccessDestination(usersCreate, { permissions: ["users.assign_profiles"] }), false);
  assert.equal(canAccessDestination(usersCreate, { permissions: ["users.create", "users.assign_profiles"] }), false);
  assert.equal(canAccessDestination(usersCreate, { permissions: ["users.view", "users.create", "users.assign_profiles"] }), true);
  assert.equal(canAccessDestination(profilesCreate, { permissions: ["profiles.create"] }), false);
  assert.equal(canAccessDestination(profilesCreate, { permissions: ["profiles.view", "profiles.create"] }), true);
  assert.equal(canAccessDestination(usersList, { is_admin: true, permissions: [] }), false);
  assert.equal(canAccessDestination(resolveDestination("#/alterar-senha"), {}), true);
});

test("main navigation exposes active modules and keeps operations in submenus", async () => {
  const { navigationItems } = await import("../src/routes/navigation.js?menu-tree");
  assert.deepEqual(navigationItems.map((item) => item.label), [
    "Início", "Pacientes", "Configurações",
  ]);
  const patients = navigationItems.find((item) => item.id === "pacientes");
  assert.deepEqual(patients.children.map((item) => item.label), ["Consultar pacientes", "Cadastrar paciente"]);
  assert.deepEqual(patients.children.map((item) => item.href), ["#/pacientes/consultar", "#/pacientes/cadastrar"]);
  const settings = navigationItems.find((item) => item.id === "configuracoes");
  assert.deepEqual(settings.children.map((item) => item.label), [
    "Consultar colaboradores", "Cadastrar colaborador",
    "Consultar perfis", "Cadastrar perfil", "Integração",
  ]);
  assert.deepEqual(settings.children.map((item) => item.href), [
    "#/usuarios/consultar", "#/usuarios/cadastrar",
    "#/perfis/consultar", "#/perfis/cadastrar",
    "#/configuracoes/integracao",
  ]);
  const submenuIcons = navigationItems.flatMap((item) => item.children ?? []).map((item) => item.icon);
  assert.ok(submenuIcons.every(Boolean));
  assert.equal(new Set(submenuIcons).size, submenuIcons.length);
  assert.equal(navigationItems.some((item) => ["agenda", "atendimento", "financeiro", "relatorios"].includes(item.id)), false);
  assert.equal(navigationItems.some((item) => item.id === "minha-conta"), false);
});

test("my account shows identity and assigned profile data from the session", async () => {
  const vite = await createServer({ configFile: false, server: { middlewareMode: true }, cacheDir: "/tmp/clinica-vite-tests" });
  try {
    const { default: MyAccount } = await vite.ssrLoadModule("/src/pages/MyAccount/MyAccount.jsx");
    const html = renderToStaticMarkup(createElement(MyAccount, {
      user: {
        full_name: "Ana Silva",
        username: "ana.silva",
        profiles: [{ name: "Recepção" }, { name: "Gestão" }],
        is_admin: false,
      },
    }));
    assert.match(html, /<h1 id="my-account-title">Meu perfil<\/h1>/);
    assert.match(html, /Ana Silva/);
    assert.match(html, /ana\.silva/);
    assert.match(html, /Recepção, Gestão/);
    assert.match(html, />Não<\/dd>/);
  } finally {
    await vite.close();
  }
});

test("user API methods preserve CSRF, credentials and exact password/status contracts", async () => {
  const api = await import("../src/services/api.js?users-contract");
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (path, options) => {
    calls.push({ path, ...options });
    return { ok: true, status: 200, json: async () => path.endsWith("/auth/me")
      ? { csrf_token: "csrf-example", user: { id: 1, is_admin: true } } : { user: { id: 2 }, users: [] } };
  };
  try {
    const createPayload = {
      full_name: "Test User", birth_date: "2000-02-29", email: "test@example.com",
      username: "test", password: "example-password", profile_ids: [2],
    };
    const updatePayload = { username: "test", birth_date: "2000-02-29" };
    await api.createUser(createPayload);
    await api.updateUser(2, updatePayload);
    await api.updateUserStatus(2, false);
    await api.resetUserPassword(2, "new-example-password");
    await api.changeOwnPassword("old-example-password", "new-example-password");
    await api.getUsers();
    await api.getUser(2);
    assert.equal(calls[0].path, "/api/v1/auth/me");
    assert.equal(Object.hasOwn(JSON.parse(calls[1].body), "is_active"), false);
    assert.deepEqual(calls.slice(1, 6).map((call) => [call.path, call.method, JSON.parse(call.body)]), [
      ["/api/v1/users", "POST", createPayload],
      ["/api/v1/users/2", "PATCH", updatePayload],
      ["/api/v1/users/2/status", "PATCH", { is_active: false }],
      ["/api/v1/users/2/password", "PATCH", { new_password: "new-example-password" }],
      ["/api/v1/auth/me/password", "PATCH", { current_password: "old-example-password", new_password: "new-example-password" }],
    ]);
    for (const call of calls) assert.equal(call.credentials, "same-origin");
    for (const call of calls.slice(1, 6)) assert.equal(call.headers["X-CSRF-Token"], "csrf-example");
    for (const call of calls.slice(6)) assert.equal(call.cache, "no-store");
  } finally { globalThis.fetch = original; }
});

test("401 notifies auth and 403 preserves backend errors and CSRF recovery", async () => {
  const api = await import("../src/services/api.js?users-errors");
  const original = globalThis.fetch;
  let unauthorized = 0;
  const stop = api.onUnauthorized(() => { unauthorized += 1; });
  try {
    for (const [status, message, csrf] of [[401, "Não autenticado.", false], [403, "Acesso restrito a administradores.", false], [403, "Token CSRF inválido.", true], [409, "Não é permitido remover o último administrador ativo.", false]]) {
      globalThis.fetch = async () => ({ ok: false, status, json: async () => ({ error: message }) });
      await assert.rejects(api.getUsers(), (failure) => failure.status === status && failure.message === message && failure.isCsrf === csrf);
    }
    assert.equal(unauthorized, 1);
  } finally { stop(); globalThis.fetch = original; }
});

test("status update failures from the user list are reported accessibly", async () => {
  const vite = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false },
    cacheDir: "/tmp/clinica-vite-tests",
  });
  const originalFetch = globalThis.fetch;
  const calls = [];
  const failures = [];
  globalThis.fetch = async (path, options = {}) => {
    calls.push({ path, options });
    if (path.endsWith("/auth/me")) {
      return { ok: true, status: 200, json: async () => ({ csrf_token: "status-csrf", user: { id: 1 } }) };
    }
    return { ok: false, status: 409, json: async () => ({ error: "Não é permitido remover o último administrador ativo." }) };
  };
  try {
    const [{ updateStatusFromList }, { default: UserList }] = await Promise.all([
      vite.ssrLoadModule("/src/features/users/hooks/useUserList.js"),
      vite.ssrLoadModule("/src/features/users/components/UserList.jsx"),
    ]);
    const user = {
      id: 7, full_name: "Ana Silva", username: "ana", email: "ana@example.com",
      is_active: true, profiles: [],
    };
    const statusError = await updateStatusFromList(user, {
      onStatusUpdated() {},
      onFailure(failure) { failures.push(failure); },
    });
    assert.equal(calls.at(-1).path, "/api/v1/users/7/status");
    assert.equal(statusError, "Não é permitido remover o último administrador ativo.");
    assert.equal(failures.length, 1);
    assert.equal(failures[0].status, 409);

    const html = renderToStaticMarkup(createElement(UserList, {
      canChangeStatus: true,
      list: {
        appliedSearch: "", changeStatus() {}, error: "", loading: false, onSearchChange() {},
        search: "", searchInput: { current: null }, statusError, updating: false,
        updatingStatusId: null, visibleUsers: [user],
      },
    }));
    assert.match(html, /role="alert"/);
    assert.match(html, /Não é permitido remover o último administrador ativo\./);
  } finally {
    globalThis.fetch = originalFetch;
    await vite.close();
  }
});

test("user edit status is sent with the single profile update contract", async () => {
  const api = await import("../src/services/api.js?user-edit-status");
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (path, options) => {
    calls.push({ path, options });
    return { ok: true, status: 200, json: async () => ({ csrf_token: "csrf", user: { id: 2, is_active: false } }) };
  };
  try {
    await api.updateUser(2, { full_name: "Changed", is_active: false, profile_ids: [2] });
    const writes = calls.filter((call) => call.path === "/api/v1/users/2");
    assert.equal(writes.length, 1);
    assert.deepEqual(JSON.parse(writes[0].options.body), { full_name: "Changed", is_active: false, profile_ids: [2] });
  } finally { globalThis.fetch = original; }
});


test("numeric date input inserts Brazilian separators for mobile keyboards", () => {
  assert.equal(maskBirthDate("29022000"), "29/02/2000");
  assert.equal(maskBirthDate("29/02/2000"), "29/02/2000");
  assert.equal(maskBirthDate("290"), "29/0");
  assert.equal(maskBirthDate("29"), "29");
  assert.equal(maskBirthDate(""), "");
});
