"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {assetUrl} = require("../src/utils/assets");

const sourceFile = path.join(__dirname, "../public/js/auth.js");

test("gera versões estáveis com base no conteúdo do arquivo", () => {
  const content = fs.readFileSync(sourceFile);
  const expected = require("node:crypto").createHash("sha256").update(content).digest("hex").slice(0, 12);
  assert.equal(assetUrl("/static/js/auth.js"), `/static/js/auth.js?v=${expected}`);
  assert.equal(assetUrl("/static/js/auth.js"), assetUrl("/static/js/auth.js"));
});

test("rejeita caminhos inválidos ou fora da pasta pública", () => {
  for (const input of ["/env", "/static/js/../../.env", "https://exemplo.com/app.js", "/static/js/app.js?old=true", null]) {
    assert.throws(() => assetUrl(input));
  }
});

test("o hash acompanha alterações sem precisar reiniciar o Node.js", () => {
  const temporary = path.join(__dirname, "../public/js/.asset-version-test.js");
  try {
    fs.writeFileSync(temporary, "const v=1;\n");
    const first = assetUrl("/static/js/.asset-version-test.js");
    fs.writeFileSync(temporary, "const v=2;\n");
    const second = assetUrl("/static/js/.asset-version-test.js");
    assert.notEqual(first, second);
  } finally {
    fs.rmSync(temporary, {force:true});
  }
});

test("as views não têm versões manuais de arquivos estáticos", () => {
  for (const name of ["app.ejs", "auth.ejs"]) {
    const view = fs.readFileSync(path.join(__dirname, "../views", name), "utf8");
    assert.doesNotMatch(view, /(?:src|href)="\/static\//);
    assert.match(view, /assetUrl\(/);
  }
});
