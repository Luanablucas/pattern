"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..");

function element() {
  return {
    hidden: false,
    disabled: false,
    value: "",
    textContent: "",
    innerHTML: "",
    elements: { name: { value: "" } },
    classList: { toggle() {} },
    addEventListener() {},
    querySelector() { return { disabled: false }; }
  };
}

test("Minha conta carrega perfil e sessoes sem colidir com o JavaScript principal", async () => {
  const els = Object.fromEntries([
    "accountStatus", "accountNameForm", "accountEmailForm", "accountPasswordForm",
    "accountEmail", "accountVerification", "resendVerification", "pendingEmail",
    "accountSessions", "revokeOtherSessions", "accountExportForm", "accountDeleteDialog", "accountDeleteForm",
    "accountDeleteError", "accountDeleteStart", "accountDeleteClose", "accountDeleteCancel", "accountDeleteConfirm"
  ].map(id => [id, element()]));
  const requests = [];
  const context = vm.createContext({
    document: { getElementById: id => els[id] || null },
    window: { location: { assign() { throw new Error("redirecionamento inesperado"); } } },
    fetch: async url => {
      requests.push(url);
      const data = url === "/api/account" ?
        { name: "Pessoa Teste", email: "pessoa@exemplo.com", emailVerifiedAt: null, pendingEmail: null } :
        [{ id: "id", userAgent: "Navegador de teste", createdAt: "2026-10-21T10:00:00.000Z", current: true }];
      return { status: 200, ok: true, json: async () => data };
    },
    console,
    Date
  });
  vm.runInContext('const $ = () => "funcao global do app"; async function api() { return "app"; }', context);
  vm.runInContext(fs.readFileSync(path.join(root, "public/js/account.js"), "utf8"), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requests.sort(), ["/api/account", "/api/account/sessions"]);
  assert.equal(els.accountEmail.textContent, "pessoa@exemplo.com");
  assert.match(els.accountSessions.innerHTML, /Navegador de teste/);
  assert.equal(els.accountStatus.textContent, "Sua conta está atualizada.");
  assert.equal(vm.runInContext("$()", context), "funcao global do app");
});

test("logout pede confirmacao antes de fazer a requisicao de saida", () => {
  const html = fs.readFileSync(path.join(root, "views/app.ejs"), "utf8");
  const script = fs.readFileSync(path.join(root, "public/js/app.js"), "utf8");
  assert.match(html, /<dialog id="logoutConfirmDialog"[^>]*aria-labelledby="logoutConfirmTitle"/);
  assert.match(html, /id="logoutConfirm"/);
  assert.match(html, /data-close="logoutConfirmDialog"/);
  const open = script.indexOf('if (target.id === "logoutBtn")');
  const confirm = script.indexOf('if (target.id === "logoutConfirm")');
  assert.ok(open > 0 && confirm > open);
  assert.match(script.slice(open, confirm), /\.showModal\(\)/);
  assert.doesNotMatch(script.slice(open, confirm), /api\("\/api\/auth\/logout"/);
  assert.match(script.slice(confirm, confirm + 400), /api\("\/api\/auth\/logout"/);
});
