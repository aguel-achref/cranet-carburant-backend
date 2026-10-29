const router = require('express').Router();
const db = require('../config/db');

const round = (n, d = 2) => Number(Number(n).toFixed(d));
const diffDays = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

async function loadAll() {
  const [vehicles] = await db.query('SELECT id, name, plate, fuel_type FROM vehicles ORDER BY name');
  const [entries] = await db.query(
    'SELECT vehicle_id, entry_date, liters, total_cost, odometer FROM fuel_entries ORDER BY entry_date, id'
  );
  return { vehicles, entries };
}

/*
 * Consumption method: fuel bought at fill-up N is burned between fill-up N and N+1.
 * So the average uses all fill-ups EXCEPT the last one, divided by the days between
 * the first and the last fill-up. It needs at least 2 fill-ups on different days.
 * L/100km uses the same idea with the odometer.
 */
function computeVehicleStats(vehicle, entries) {
  const total_liters = entries.reduce((s, e) => s + e.liters, 0);
  const total_cost = entries.reduce((s, e) => s + e.total_cost, 0);

  const stats = {
    vehicle_id: vehicle.id,
    name: vehicle.name,
    plate: vehicle.plate,
    fuel_type: vehicle.fuel_type,
    entries_count: entries.length,
    total_liters: round(total_liters),
    total_cost: round(total_cost, 3),
    first_date: entries.length ? entries[0].entry_date : null,
    last_date: entries.length ? entries[entries.length - 1].entry_date : null,
    avg_daily_liters: null,
    avg_daily_cost: null,
    avg_weekly_liters: null,
    avg_weekly_cost: null,
    l_per_100km: null,
    cost_per_km: null,
  };

  if (entries.length >= 2) {
    const first = entries[0];
    const last = entries[entries.length - 1];
    const days = diffDays(first.entry_date, last.entry_date);
    if (days > 0) {
      const liters = total_liters - last.liters;
      const cost = total_cost - last.total_cost;
      stats.avg_daily_liters = round(liters / days);
      stats.avg_daily_cost = round(cost / days, 3);
      stats.avg_weekly_liters = round((liters / days) * 7);
      stats.avg_weekly_cost = round((cost / days) * 7, 3);
    }
  }

  const withOdo = entries
    .filter((e) => e.odometer != null)
    .sort((a, b) => a.odometer - b.odometer);
  if (withOdo.length >= 2) {
    const km = withOdo[withOdo.length - 1].odometer - withOdo[0].odometer;
    if (km > 0) {
      const used = withOdo.slice(1);
      const liters = used.reduce((s, e) => s + e.liters, 0);
      const cost = used.reduce((s, e) => s + e.total_cost, 0);
      stats.l_per_100km = round((liters / km) * 100);
      stats.cost_per_km = round(cost / km, 3);
    }
  }

  return stats;
}

async function allVehicleStats() {
  const { vehicles, entries } = await loadAll();
  return vehicles.map((v) =>
    computeVehicleStats(v, entries.filter((e) => e.vehicle_id === v.id))
  );
}

// Global totals + current week / month cost
router.get('/summary', async (req, res) => {
  const [[totals]] = await db.query(`
    SELECT COUNT(*) AS entries_count,
           COALESCE(SUM(liters), 0)     AS total_liters,
           COALESCE(SUM(total_cost), 0) AS total_cost,
           COALESCE(SUM(CASE WHEN YEARWEEK(entry_date, 1) = YEARWEEK(CURDATE(), 1)
                             THEN total_cost END), 0) AS week_cost,
           COALESCE(SUM(CASE WHEN DATE_FORMAT(entry_date, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')
                             THEN total_cost END), 0) AS month_cost
    FROM fuel_entries
  `);
  const [[{ vehicles_count }]] = await db.query('SELECT COUNT(*) AS vehicles_count FROM vehicles');
  res.json({ ...totals, vehicles_count });
});

router.get('/by-vehicle', async (req, res) => {
  res.json(await allVehicleStats());
});

// GET /api/stats/daily?days=30&vehicle_id=1
router.get('/daily', async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
  const params = [days];
  let extra = '';
  if (req.query.vehicle_id) { extra = ' AND vehicle_id = ?'; params.push(req.query.vehicle_id); }

  const [rows] = await db.query(
    `SELECT entry_date AS date, SUM(liters) AS liters, SUM(total_cost) AS cost
     FROM fuel_entries
     WHERE entry_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)${extra}
     GROUP BY entry_date
     ORDER BY entry_date`,
    params
  );
  res.json(rows);
});

// GET /api/stats/weekly?weeks=12&vehicle_id=1  (weeks start on Monday)
router.get('/weekly', async (req, res) => {
  const weeks = Math.min(Math.max(parseInt(req.query.weeks, 10) || 12, 1), 104);
  const params = [weeks];
  let extra = '';
  if (req.query.vehicle_id) { extra = ' AND vehicle_id = ?'; params.push(req.query.vehicle_id); }

  const [rows] = await db.query(
    `SELECT YEARWEEK(entry_date, 1) AS year_week,
            MIN(DATE_SUB(entry_date, INTERVAL WEEKDAY(entry_date) DAY)) AS week_start,
            SUM(liters) AS liters,
            SUM(total_cost) AS cost
     FROM fuel_entries
     WHERE entry_date >= DATE_SUB(CURDATE(), INTERVAL ? WEEK)${extra}
     GROUP BY year_week
     ORDER BY year_week`,
    params
  );
  res.json(rows);
});

// Forecast based on each vehicle's average consumption
router.get('/estimation', async (req, res) => {
  const stats = await allVehicleStats();
  const withEstimate = stats.filter((s) => s.avg_daily_liters !== null);

  const vehicles = withEstimate.map((s) => ({
    vehicle_id: s.vehicle_id,
    name: s.name,
    plate: s.plate,
    avg_daily_liters: s.avg_daily_liters,
    avg_daily_cost: s.avg_daily_cost,
    next_7_days_liters: round(s.avg_daily_liters * 7),
    next_7_days_cost: round(s.avg_daily_cost * 7, 3),
    next_30_days_liters: round(s.avg_daily_liters * 30),
    next_30_days_cost: round(s.avg_daily_cost * 30, 3),
  }));

  const sum = (key) => round(vehicles.reduce((t, v) => t + v[key], 0), 3);

  res.json({
    vehicles,
    fleet: {
      avg_daily_cost: sum('avg_daily_cost'),
      next_7_days_cost: sum('next_7_days_cost'),
      next_30_days_cost: sum('next_30_days_cost'),
      vehicles_with_estimate: vehicles.length,
      vehicles_without_estimate: stats.length - vehicles.length,
    },
  });
});

module.exports = router;