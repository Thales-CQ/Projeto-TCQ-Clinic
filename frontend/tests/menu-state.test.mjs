import assert from "node:assert/strict";
import test from "node:test";
import { toggleMenuPath } from "../src/components/Menu/menuState.js";

test("opening a root submenu closes its open sibling", () => {
  const settings = toggleMenuPath([], [], "configuracoes");
  assert.deepEqual(settings, ["configuracoes"]);
  assert.deepEqual(toggleMenuPath(settings, [], "minha-conta"), ["minha-conta"]);
});

test("clicking an open root submenu closes it, including its descendants", () => {
  assert.deepEqual(toggleMenuPath(["configuracoes", "usuarios"], [], "configuracoes"), []);
  assert.deepEqual(toggleMenuPath(["minha-conta"], [], "minha-conta"), []);
});

test("nested submenus remain within one path and siblings replace each other", () => {
  const settings = ["configuracoes"];
  assert.deepEqual(toggleMenuPath(settings, settings, "usuarios"), ["configuracoes", "usuarios"]);
  assert.deepEqual(toggleMenuPath(["configuracoes", "usuarios"], settings, "perfis"), ["configuracoes", "perfis"]);
  assert.deepEqual(toggleMenuPath(["configuracoes", "usuarios"], ["configuracoes"], "usuarios"), settings);
});
