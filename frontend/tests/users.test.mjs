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
    for (const html of [renderHeader(named), renderDashboard(named)]) {
      assert.match(html, /THALES COSTA QUEIROGA/);
      assert.doesNotMatch(html, /THALES(?:<|!)/);
    }
    const legacy = { full_name: null, username: "THALES" };
    assert.match(renderHeader(legacy), /<strong>THALES<\/strong>/);
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
  assert.equal(findDestination("alterar-senha").href, "#/alterar-senha");
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
  const items = navigationForUser({ is_admin: true, permissions: [
    "users.view", "profiles.create", "patients.view", "integrations.cep.view",
  ] });
  assert.ok(!items.some((item) => item.id === "usuarios"));
  const settings = items.find((item) => item.id === "configuracoes");
  assert.deepEqual(settings.children.map((item) => item.label), ["Usuários", "Perfis", "Integração"]);
  assert.equal(settings.children[0].href, "#/usuarios/consultar");
  assert.equal(settings.children[0].children, undefined);
  assert.equal(settings.children[1].href, "#/perfis/cadastrar");
  assert.equal(settings.children[2].href, "#/configuracoes/integracao");
  assert.ok(!settings.disabled);
});

test("view and create permissions are independent in navigation", () => {
  assert.equal(navigationForUser({ permissions: ["patients.view"] })
    .find((item) => item.id === "atendimento").children[0].href, "#/pacientes/consultar");
  assert.equal(navigationForUser({ permissions: ["patients.create"] })
    .find((item) => item.id === "atendimento").children[0].href, "#/pacientes/cadastrar");
  assert.equal(navigationForUser({ permissions: ["users.create", "users.assign_profiles"] })
    .find((item) => item.id === "configuracoes").children[0].href, "#/usuarios/cadastrar");
  assert.equal(navigationForUser({ permissions: ["users.create"] })
    .some((item) => item.id === "configuracoes"), false);
  assert.equal(navigationForUser({ permissions: ["profiles.view"] })
    .find((item) => item.id === "configuracoes").children[0].label, "Perfis");
  assert.deepEqual(navigationForUser({ permissions: ["profiles.view"] })
    .find((item) => item.id === "configuracoes").children.map((item) => item.label), ["Perfis"]);
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

test("desktop and mobile menu markup exposes the admin CEP activation route", async () => {
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
    assert.match(html, /aria-label="Abrir menu"/);
    assert.match(html, /aria-expanded="false"[^>]*aria-controls=/);
    assert.match(html, />Configurações<\/button>/);
    assert.match(html, />Integração<\/a>/);
    assert.match(css, /@media \(max-width: 760px\)/);
    assert.match(css, /\.menu--open \.menu__list/);
  } finally {
    await vite.close();
  }
});

test("module submenus hide each unauthorized view and create option", async () => {
  const vite = await createServer({ configFile: false, server: { middlewareMode: true }, cacheDir: "/tmp/clinica-vite-tests" });
  try {
    const [{ default: Patients }, { default: Users }, { default: Profiles }, { AuthContext }] = await Promise.all([
      vite.ssrLoadModule("/src/features/patients/PatientsFeature.jsx"),
      vite.ssrLoadModule("/src/features/users/UsersFeature.jsx"),
      vite.ssrLoadModule("/src/features/profiles/ProfilesFeature.jsx"),
      vite.ssrLoadModule("/src/contexts/AuthContext.js"),
    ]);
    const renderWith = (Component, props, permissions) => renderToStaticMarkup(
      createElement(AuthContext.Provider, {
        value: { hasPermission: (code) => permissions.includes(code) },
      }, createElement(Component, props)),
    );
    for (const [Component, props, viewCode, createCode] of [
      [Patients, { view: "cadastrar", onViewChange() {} }, "patients.view", "patients.create"],
      [Profiles, { view: "cadastrar", onViewChange() {} }, "profiles.view", "profiles.create"],
    ]) {
      const createOnly = renderWith(Component, props, [createCode]);
      assert.match(createOnly, />Cadastrar(?: paciente| usuário| perfil)?</);
      assert.doesNotMatch(createOnly, />Consultar(?: pacientes| usuários| perfis)?</);
      const viewOnly = renderWith(Component, { ...props, view: "consultar" }, [viewCode]);
      assert.match(viewOnly, />Consultar(?: pacientes| usuários| perfis)?</);
      assert.doesNotMatch(viewOnly, />Cadastrar(?: paciente| usuário| perfil)?</);
    }
    const usersCreate = renderWith(Users, { view: "cadastrar", onViewChange() {} }, ["users.create", "users.assign_profiles"]);
    assert.match(usersCreate, />Cadastrar</);
    assert.doesNotMatch(usersCreate, />Consultar</);
    const usersView = renderWith(Users, { view: "consultar", onViewChange() {} }, ["users.view"]);
    assert.match(usersView, />Consultar</);
    assert.doesNotMatch(usersView, />Cadastrar</);
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
  assert.equal(canAccessDestination(usersCreate, { permissions: ["users.create", "users.assign_profiles"] }), true);
  assert.equal(canAccessDestination(usersList, { is_admin: true, permissions: [] }), false);
  assert.equal(canAccessDestination(resolveDestination("#/alterar-senha"), {}), true);
});

test("main navigation keeps the requested hierarchy and disabled modules", async () => {
  const { navigationItems } = await import("../src/routes/navigation.js?menu-tree");
  assert.deepEqual(navigationItems.map((item) => item.label), [
    "Início", "Atendimento", "Financeiro", "Relatório", "Configurações",
  ]);
  const atendimento = navigationItems.find((item) => item.id === "atendimento");
  assert.deepEqual(atendimento.children.map((item) => item.label), ["Pacientes", "Agendamento", "Atendimento"]);
  assert.equal(atendimento.children[0].href, "#/pacientes/consultar");
  assert.equal(atendimento.children[0].children, undefined);
  assert.equal(atendimento.children[1].disabled, true);
  assert.equal(atendimento.children[2].disabled, true);
  assert.equal(navigationItems.find((item) => item.id === "financeiro").disabled, true);
  assert.equal(navigationItems.find((item) => item.id === "relatorios").disabled, true);
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
