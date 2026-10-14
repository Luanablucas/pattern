require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL no arquivo .env');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8');
    await pool.query(sql);
    console.log('Banco inicializado com sucesso.');
  } finally {
    await pool.end();
  }
}
main().catch((err) => { console.error(err.message); process.exitCode = 1; });
