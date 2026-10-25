const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({
  connectionString: config.db.url,
  ssl: { rejectUnauthorized: false }, // Neon (and most managed PG hosts) need this
});

function normalizePhone(phone) {
  return String(phone).replace(/\D/g, '');
}

/** Leads with status 'pending' (or NULL) — the ones outreach hasn't touched yet. */
async function getPendingLeads() {
  const { rows } = await pool.query(
    `SELECT * FROM leads WHERE status = 'pending' OR status IS NULL ORDER BY created_at ASC`
  );
  return rows;
}

async function findLeadByPhone(phone) {
  const { rows } = await pool.query(`SELECT * FROM leads WHERE phone = $1 LIMIT 1`, [
    normalizePhone(phone),
  ]);
  return rows[0] || null;
}

/** Used when an inbound message arrives from a number not yet in the table. */
async function createLead(fields) {
  const { name, phone, area, inquiry_source, status } = fields;
  const { rows } = await pool.query(
    `INSERT INTO leads (name, phone, area, inquiry_source, status)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (phone) DO UPDATE SET name = COALESCE(leads.name, EXCLUDED.name)
     RETURNING *`,
    [name || null, normalizePhone(phone), area || null, inquiry_source || null, status || 'replied']
  );
  return rows[0];
}

/**
 * All leads, each with a preview of their most recent conversation message,
 * newest activity first. Powers the test-console contact list.
 */
async function getAllLeads() {
  const { rows } = await pool.query(
    `SELECT l.*,
            c.message AS last_message,
            c.direction AS last_direction,
            c.created_at AS last_message_at
     FROM leads l
     LEFT JOIN LATERAL (
       SELECT message, direction, created_at
       FROM conversations
       WHERE phone = l.phone
       ORDER BY created_at DESC
       LIMIT 1
     ) c ON true
     ORDER BY COALESCE(c.created_at, l.created_at) DESC`
  );
  return rows;
}

const UPDATABLE_COLUMNS = [
  'name', 'area', 'inquiry_source', 'property_interest', 'notes',
  'status', 'conversation_stage', 'last_contacted', 'last_inbound',
];

async function updateLead(id, fields) {
  const entries = Object.entries(fields).filter(([col]) => UPDATABLE_COLUMNS.includes(col));
  if (!entries.length) return;
  const setClause = entries.map(([col], i) => `${col} = $${i + 2}`).join(', ');
  const values = entries.map(([, val]) => val);
  await pool.query(`UPDATE leads SET ${setClause} WHERE id = $1`, [id, ...values]);
}

async function appendConversationLog(phone, direction, message) {
  await pool.query(
    `INSERT INTO conversations (phone, direction, message) VALUES ($1, $2, $3)`,
    [normalizePhone(phone), direction, message]
  );
}

/** Last `limit` messages for a phone number, oldest first. */
async function getConversationHistory(phone, limit = 20) {
  const { rows } = await pool.query(
    `SELECT phone, direction, message, created_at
     FROM conversations WHERE phone = $1
     ORDER BY created_at DESC LIMIT $2`,
    [normalizePhone(phone), limit]
  );
  return rows.reverse();
}

/**
 * Searches available listings for the agent's search_properties tool.
 * All filters are optional and combine with AND; area/type use partial,
 * case-insensitive matching since leads describe areas loosely.
 */
async function searchProperties({ area, property_type, min_price, max_price, min_bedrooms } = {}) {
  const conditions = [`status = 'available'`];
  const values = [];

  if (area) {
    values.push(`%${area}%`);
    conditions.push(`area ILIKE $${values.length}`);
  }
  if (property_type) {
    values.push(`%${property_type}%`);
    conditions.push(`property_type ILIKE $${values.length}`);
  }
  if (min_price != null) {
    values.push(min_price);
    conditions.push(`price >= $${values.length}`);
  }
  if (max_price != null) {
    values.push(max_price);
    conditions.push(`price <= $${values.length}`);
  }
  if (min_bedrooms != null) {
    values.push(min_bedrooms);
    conditions.push(`bedrooms >= $${values.length}`);
  }

  const { rows } = await pool.query(
    `SELECT title, area, property_type, price, bedrooms, size_sqft, description, listing_url
     FROM properties
     WHERE ${conditions.join(' AND ')}
     ORDER BY price ASC NULLS LAST
     LIMIT 5`,
    values
  );
  return rows;
}

module.exports = {
  getPendingLeads,
  getAllLeads,
  findLeadByPhone,
  createLead,
  updateLead,
  appendConversationLog,
  getConversationHistory,
  searchProperties,
};
