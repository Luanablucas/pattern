"use strict";
const {createHash} = require("node:crypto");
const {readFileSync} = require("node:fs");
const path = require("node:path");

const publicDir = path.resolve(__dirname, "../../public");

function assetUrl(url) {
  if (typeof url !== "string" || !/^\/static\/(?:css|js)\/[\w./-]+\.(?:css|js)$/.test(url)) {
    throw new Error("Caminho de arquivo estático inválido.");
  }
  const filename = path.resolve(publicDir, url.slice("/static/".length));
  if (!filename.startsWith(`${publicDir}${path.sep}`)) {
    throw new Error("Caminho de arquivo estático inválido.");
  }
  const revision = createHash("sha256").update(readFileSync(filename)).digest("hex").slice(0, 12);
  return `${url}?v=${revision}`;
}

module.exports = {assetUrl};
