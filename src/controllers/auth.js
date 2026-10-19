"use strict";
const {z}=require("zod");
const bcrypt=require("bcryptjs");
const {randomUUID}=require("node:crypto");
const {safeText}=require("../validation/common");
const {validate}=require("../middleware/api");
const {issueCookie,cookieOptions}=require("../middleware/auth");

module.exports = function createAuthController(db) {
const register = async (req, res) => {
    const body = validate(
      z
        .object({
          name: safeText(80),
          email: z
            .string()
            .trim()
            .email()
            .max(254)
            .transform((v) => v.toLowerCase()),
          password: z
            .string()
            .min(8, "A senha precisa ter 8 caracteres ou mais.")
            .max(72),
        })
        .strict(),
      req,
      res,
    );
    if (!body) return;
    const user = { id: randomUUID(), name: body.name, email: body.email };
    const hash = await bcrypt.hash(body.password, 12);
    try {
      await db.query(
        "INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,$4)",
        [user.id, user.name, user.email, hash],
      );
      await db.query(`INSERT INTO event_categories(id,user_id,name,color,legacy_key)
        SELECT gen_random_uuid(),$1,v.name,v.color,v.key
        FROM (VALUES ('study','Estudos','#8e77d2'),('work','Trabalho','#73a1cf'),
          ('personal','Pessoal','#d68bab'),('health','Saúde','#75aa96'),
          ('other','Outros','#d5a26b')) AS v(key,name,color)
        ON CONFLICT DO NOTHING`,[user.id]);
    } catch (err) {
      if (err.code === "23505")
        return res
          .status(409)
          .json({ error: "Este e-mail já está cadastrado." });
      throw err;
    }
    issueCookie(res, user);
    res.status(201).json({ ok: true });
  };
const login = async (req, res) => {
    const body = validate(
      z
        .object({
          email: z
            .string()
            .trim()
            .email()
            .transform((v) => v.toLowerCase()),
          password: z.string(),
        })
        .strict(),
      req,
      res,
    );
    if (!body) return;
    const { rows } = await db.query(
      "SELECT id,name,password_hash FROM users WHERE email=$1",
      [body.email],
    );
    const valid =
      rows[0] && (await bcrypt.compare(body.password, rows[0].password_hash));
    if (!valid)
      return res.status(401).json({ error: "E-mail ou senha incorretos." });
    issueCookie(res, rows[0]);
    res.json({ ok: true });
  };
const logout = (req, res) => {
  res.clearCookie("pattern_token", {
    path: "/",
    sameSite: cookieOptions.sameSite,
    secure: cookieOptions.secure,
    httpOnly: true,
  });
  res.json({ ok: true });
};
return {register,login,logout};
};
