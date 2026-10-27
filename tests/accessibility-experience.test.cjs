"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {join} = require("node:path");
const vm = require("node:vm");
const root = join(__dirname, "..");
const read = path => readFileSync(join(root, path), "utf8");

test("a página oferece salto para o conteúdo, navegação identificável e diálogos nomeados", () => {
  const view = read("views/app.ejs");
  assert.match(view, /class="skip-link" href="#main-content"/);
  assert.match(view, /<main id="main-content" class="main-content" tabindex="-1">/);
  for (const page of ["app", "tasks", "focus", "calendar", "habits", "goals", "intelligence", "review", "insights"]) {
    assert.match(view, new RegExp(`page === '${page}' \\? 'aria-current="page"'`));
  }
  for (const label of ["taskDialogTitle", "eventDialogTitle", "habitDialogTitle", "routineDialogTitle", "categoryDialogTitle", "goalDialogTitle", "confirmTitle", "logoutConfirmTitle"]) {
    assert.match(view, new RegExp(`aria-labelledby="${label}"`));
    assert.match(view, new RegExp(`id="${label}"`));
  }
  assert.match(view, /id="toast"[^>]+aria-live="polite"[^>]+aria-atomic="true"/);
});

test("o visual mantém foco visível e respeita movimento reduzido", () => {
  const style = read("public/css/style.css");
  const theme = read("public/css/theme.css");
  assert.match(style, /\.skip-link:focus\{transform:translateY\(0\)\}/);
  assert.match(style, /prefers-reduced-motion:reduce/);
  assert.match(style, /\.nav-link\{min-height:44px\}/);
  assert.match(theme, /data-theme="dark".*:focus-visible\{outline:3px solid #e5ceff/);
  assert.match(style, /--muted: #6b6478/);
});

test("o menu móvel alcança a página ativa e permite navegar pelas setas", () => {
  let handler;
  const makeLink = rect => ({
    rect,
    focusCalled: false,
    getBoundingClientRect() { return this.rect; },
    focus() { this.focusCalled = true; },
    closest(selector) { return selector === "a.nav-link" ? this : null; }
  });
  const links = [makeLink({left:10,right:85,width:75}), makeLink({left:430,right:520,width:90})];
  const nav = {
    scrollLeft: 0,
    querySelectorAll: () => links,
    querySelector: () => links[1],
    getBoundingClientRect: () => ({left:0,right:320,width:320}),
    addEventListener: (name, fn) => { if(name === "keydown") handler = fn; }
  };
  vm.runInNewContext(read("public/js/accessibility.js"), {
    document:{querySelector:()=>nav},
    window:{matchMedia:()=>({matches:true})}
  });
  assert.ok(nav.scrollLeft > 0);
  let prevented = false;
  handler({target:links[0], key:"ArrowRight", preventDefault(){prevented = true;}});
  assert.equal(prevented, true);
  assert.equal(links[1].focusCalled, true);
  prevented = false;
  handler({target:links[0], key:"ArrowRight", altKey:true, preventDefault(){prevented = true;}});
  assert.equal(prevented, false);
});

test("exclusão de rotina usa confirmação consistente e preserva hábitos", () => {
  const script = read("public/js/app.js");
  assert.doesNotMatch(script, /window\.confirm\(/);
  assert.match(script, /askDelete\(\{kind: 'routine'/);
  assert.match(script, /item\.kind==='routine'\)url=`\/api\/routines\/\$\{item\.id\}`/);
  assert.match(script, /Rotina excluída; hábitos preservados/);
});

test("filtros e atalhos de duração expõem estado pressionado", () => {
  assert.match(read("public/js/app.js"), /function syncTaskFilterAccessibility\(\)/);
  assert.match(read("public/js/focus.js"), /button\.setAttribute\("aria-pressed", String\(selected\)\)/);
});
