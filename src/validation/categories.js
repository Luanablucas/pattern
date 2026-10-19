"use strict";
const { z } = require("zod");
const { safeText } = require("./common");
const categoryName = safeText(40);
const categoryColor = z.string().regex(/^#[0-9a-fA-F]{6}$/,'Cor inválida.');
const categorySchema = z.object({name:categoryName,color:categoryColor}).strict();
const categoryFields = `id,name,color,legacy_key AS "legacyKey"`;

module.exports={categorySchema,categoryFields};
