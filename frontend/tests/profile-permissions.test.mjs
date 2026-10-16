import assert from "node:assert/strict";
import test from "node:test";
import { createElement, useRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

import {
  groupedPermissions,
  permissionIdsFromProfile,
  togglePermissionId,
} from "../src/features/profiles/state/permissionCatalog.js";

test("groups the catalog using API IDs and friendly labels", () => {
  const catalog = [
    { id: 31, code: "profiles.update", description: "Alterar perfis" },
    { id: 7, code: "patients.view", description: "Consultar pacientes" },
    { id: 12, code: "users.create", description: "Cadastrar usuários" },
    { id: 41, code: "integrations.cep.view", description: "Consultar integração" },
    { id: 42, code: "integrations.cep.configure", description: "Configurar integração" },
  ];
  const groups = groupedPermissions(catalog);
  assert.deepEqual(groups.map((group) => group.label), ["Pacientes", "Usuários", "Perfis", "Integração de CEP"]);
  assert.deepEqual(groups[0].permissions[0], {
    id: 7, code: "patients.view", description: "Consultar pacientes", label: "Consultar pacientes",
  });
  assert.equal(groups[1].permissions[0].id, 12);
  assert.equal(groups[2].permissions[0].id, 31);
  assert.deepEqual(groups[3].permissions.map(({ id, code }) => [id, code]), [
    [41, "integrations.cep.view"], [42, "integrations.cep.configure"],
  ]);
});

test("supports multiple selection and profile permission IDs from the API", () => {
  assert.deepEqual(togglePermissionId([], 4, true), [4]);
  assert.deepEqual(togglePermissionId([4], 9, true), [4, 9]);
  assert.deepEqual(togglePermissionId([4, 9], 4, false), [9]);
  assert.deepEqual(permissionIdsFromProfile({ permission_ids: [9, 4] }), [9, 4]);
  assert.deepEqual(permissionIdsFromProfile({ permissions: [{ id: 9 }, { id: 4 }] }), []);
  assert.deepEqual(permissionIdsFromProfile({}), []);
});

test("permission catalog API and profile writes preserve permission_ids", async () => {
  const api = await import("../src/services/api.js?profile-permissions");
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (path, options = {}) => {
    calls.push({ path, options });
    if (path.endsWith("/auth/me")) {
      return { ok: true, status: 200, json: async () => ({ csrf_token: "csrf", user: {} }) };
    }
    if (path.endsWith("/profiles/permissions")) {
      return { ok: true, status: 200, json: async () => ({ permissions: [{ id: 8, code: "users.view" }] }) };
    }
    return { ok: true, status: 200, json: async () => ({ profile: { id: 3 } }) };
  };
  try {
    assert.deepEqual(await api.getPermissionCatalog(), { permissions: [{ id: 8, code: "users.view" }] });
    await api.createProfile({ name: "Equipe", permission_ids: [8] });
    await api.updateProfile(3, { permission_ids: [] });
    assert.deepEqual(JSON.parse(calls.at(-2).options.body), { name: "Equipe", permission_ids: [8] });
    assert.deepEqual(JSON.parse(calls.at(-1).options.body), { permission_ids: [] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("profile creation confirms success and only redirects when view permission exists", async () => {
  const vite = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false },
    cacheDir: "/tmp/clinica-vite-tests",
  });
  try {
    const [{ default: useProfiles }, { AuthContext }] = await Promise.all([
      vite.ssrLoadModule("/src/features/profiles/hooks/useProfiles.js"),
      vite.ssrLoadModule("/src/contexts/AuthContext.js"),
    ]);

    for (const { permissions, expectedNavigation } of [
      { permissions: ["profiles.create", "profiles.view"], expectedNavigation: ["consultar"] },
      { permissions: ["profiles.create"], expectedNavigation: [] },
    ]) {
      const navigation = [];
      function SaveHarness() {
        const handled = useRef(false);
        const profiles = useProfiles({
          view: "cadastrar",
          onViewChange: (view) => navigation.push(view),
        });
        if (!handled.current) {
          handled.current = true;
          profiles.handleSaved();
        }
        return createElement("p", { role: "status" }, profiles.message);
      }
      const html = renderToStaticMarkup(createElement(AuthContext.Provider, {
        value: { hasPermission: (code) => permissions.includes(code) },
      }, createElement(SaveHarness)));

      assert.deepEqual(navigation, expectedNavigation);
      assert.match(html, /Perfil cadastrado com sucesso\./);
    }
  } finally {
    await vite.close();
  }
});
