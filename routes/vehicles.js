const router = require('express').Router();
const db = require('../config/db');

const FUELS = ['essence', 'diesel', 'gpl', 'electrique'];

function validate(body) {
  const name = (body.name || '').trim();
  const plate = (body.plate || '').trim();
  const fuel_type = body.fuel_type || 'diesel';
  const tank_capacity =
    body.tank_capacity === '' || body.tank_capacity == null ? null : Number(body.tank_capacity);

  if (!name) return { error: 'Name is required' };
  if (!plate) return { error: 'Plate number is required' };
  if (!FUELS.includes(fuel_type)) return { error: 'Invalid fuel type' };
  if (tank_capacity !== null && !(tank_capacity > 0)) {
    return { error: 'Tank capacity must be a positive number' };
  }
  return { data: { name, plate, fuel_type, tank_capacity } };
}

// List vehicles with their totals
router.get('/', async (req, res) => {
  const [rows] = await db.query(`
    SELECT v.*,
           COALESCE(SUM(f.liters), 0)     AS total_liters,
           COALESCE(SUM(f.total_cost), 0) AS total_cost,
           COUNT(f.id)                    AS entries_count
    FROM vehicles v
    LEFT JOIN fuel_entries f ON f.vehicle_id = v.id
    GROUP BY v.id
    ORDER BY v.name
  `);
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const [rows] = await db.query('SELECT * FROM vehicles WHERE id = ?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ message: 'Vehicle not found' });
  res.json(rows[0]);
});

router.post('/', async (req, res) => {
  const { data, error } = validate(req.body);
  if (error) return res.status(400).json({ message: error });

  const [result] = await db.query('INSERT INTO vehicles SET ?', [data]);
  const [rows] = await db.query('SELECT * FROM vehicles WHERE id = ?', [result.insertId]);
  res.status(201).json(rows[0]);
});

router.put('/:id', async (req, res) => {
  const { data, error } = validate(req.body);
  if (error) return res.status(400).json({ message: error });

  await db.query('UPDATE vehicles SET ? WHERE id = ?', [data, req.params.id]);
  const [rows] = await db.query('SELECT * FROM vehicles WHERE id = ?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ message: 'Vehicle not found' });
  res.json(rows[0]);
});

// Also deletes the vehicle's fuel entries (ON DELETE CASCADE)
router.delete('/:id', async (req, res) => {
  const [result] = await db.query('DELETE FROM vehicles WHERE id = ?', [req.params.id]);
  if (!result.affectedRows) return res.status(404).json({ message: 'Vehicle not found' });
  res.status(204).end();
});

module.exports = router;