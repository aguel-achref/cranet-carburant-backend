const router = require('express').Router();
const db = require('../config/db');

function validate(b) {
  const vehicle_id = Number(b.vehicle_id);
  const liters = Number(b.liters);
  const price_per_liter = Number(b.price_per_liter);
  const odometer = b.odometer === '' || b.odometer == null ? null : Number(b.odometer);
  const notes = (b.notes || '').trim().slice(0, 255) || null;

  if (!Number.isInteger(vehicle_id) || vehicle_id <= 0) return { error: 'Vehicle is required' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.entry_date || '')) return { error: 'Valid date is required' };
  if (!(liters > 0)) return { error: 'Liters must be greater than 0' };
  if (!(price_per_liter > 0)) return { error: 'Price per liter must be greater than 0' };
  if (odometer !== null && (!Number.isInteger(odometer) || odometer < 0)) {
    return { error: 'Odometer must be a positive whole number' };
  }

  return {
    data: { vehicle_id, entry_date: b.entry_date, liters, price_per_liter, odometer, notes },
  };
}

const SELECT_ENTRY = `
  SELECT f.*, v.name AS vehicle_name, v.plate
  FROM fuel_entries f
  JOIN vehicles v ON v.id = f.vehicle_id
`;

// GET /api/fuel?vehicle_id=1&from=2026-10-01&to=2026-10-31
router.get('/', async (req, res) => {
  const { vehicle_id, from, to } = req.query;
  const where = [];
  const params = [];

  if (vehicle_id) { where.push('f.vehicle_id = ?'); params.push(vehicle_id); }
  if (from) { where.push('f.entry_date >= ?'); params.push(from); }
  if (to) { where.push('f.entry_date <= ?'); params.push(to); }

  const sql =
    SELECT_ENTRY +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY f.entry_date DESC, f.id DESC';

  const [rows] = await db.query(sql, params);
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { data, error } = validate(req.body);
  if (error) return res.status(400).json({ message: error });

  const [result] = await db.query('INSERT INTO fuel_entries SET ?', [data]);
  const [rows] = await db.query(`${SELECT_ENTRY} WHERE f.id = ?`, [result.insertId]);
  res.status(201).json(rows[0]);
});

router.put('/:id', async (req, res) => {
  const { data, error } = validate(req.body);
  if (error) return res.status(400).json({ message: error });

  await db.query('UPDATE fuel_entries SET ? WHERE id = ?', [data, req.params.id]);
  const [rows] = await db.query(`${SELECT_ENTRY} WHERE f.id = ?`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ message: 'Entry not found' });
  res.json(rows[0]);
});

router.delete('/:id', async (req, res) => {
  const [result] = await db.query('DELETE FROM fuel_entries WHERE id = ?', [req.params.id]);
  if (!result.affectedRows) return res.status(404).json({ message: 'Entry not found' });
  res.status(204).end();
});

module.exports = router;