const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const config = require('./config');

if (!config.databaseUrl) {
  throw new Error('Configura DATABASE_URL con la conexión PostgreSQL del proveedor.');
}

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: { rejectUnauthorized: true },
  max: Number(process.env.DB_POOL_SIZE || 5),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on('error', (error) => {
  console.error('Error inesperado en el pool de PostgreSQL.', error);
});

function postgresPlaceholders(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

async function query(sql, parameters = []) {
  const client = await pool.connect();
  try {
    await client.query('SET search_path TO geodrone, public');
    return await client.query(postgresPlaceholders(sql), parameters);
  } finally {
    client.release();
  }
}

async function one(sql, parameters = []) {
  const result = await query(sql, parameters);
  return result.rows[0] || null;
}

async function many(sql, parameters = []) {
  const result = await query(sql, parameters);
  return result.rows;
}

async function execute(sql, parameters = []) {
  const result = await query(sql, parameters);
  return { rows: result.rows, rowCount: result.rowCount };
}

async function initialize() {
  const client = await pool.connect();
  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS geodrone');
    await client.query("SET search_path TO geodrone, public");
    const schema = fs.readFileSync(path.join(__dirname, '..', 'migrations', '001_initial.sql'), 'utf8');
    await client.query(schema);
  } finally {
    client.release();
  }
}

module.exports = { execute, initialize, many, one, pool, query };
