const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const configPath = require.resolve('../config/db');
const modelPath = require.resolve('../models/serviceBookingModel');

function makePool(options = {}) {
  const events = [];
  const queries = [];
  const transactionConnection = {
    beginTransaction(callback) {
      events.push('begin');
      callback(options.beginError || null);
    },
    query(sql, params, callback) {
      const type = sql.includes('INSERT INTO payments') ? 'payment' : 'booking';
      events.push(type);
      queries.push({ type, sql, params });
      if (options[`${type}Error`]) return callback(options[`${type}Error`]);
      if (type === 'booking') {
        return callback(null, {
          affectedRows: options.unavailable ? 0 : 1,
          insertId: 42
        });
      }
      return callback(null, {
        affectedRows: options.paymentAffectedRows === undefined ? 1 : options.paymentAffectedRows,
        insertId: 77
      });
    },
    commit(callback) {
      events.push('commit');
      callback(options.commitError || null);
    },
    rollback(callback) {
      events.push('rollback');
      callback(options.rollbackError || null);
    },
    release() {
      events.push('release');
    }
  };

  const pool = {
    getConnection(callback) {
      events.push('acquire');
      callback(options.connectionError || null, transactionConnection);
    },
    query(sql, params, callback) {
      events.push('history');
      queries.push({ type: 'history', sql, params });
      callback(null, options.historyRows || []);
    }
  };

  return { pool, events, queries };
}

async function withFakePool(pool, run) {
  const originalConfig = require.cache[configPath];
  const originalModel = require.cache[modelPath];
  const fakeConfig = new Module(configPath, module);
  fakeConfig.filename = configPath;
  fakeConfig.loaded = true;
  fakeConfig.exports = pool;
  require.cache[configPath] = fakeConfig;
  delete require.cache[modelPath];

  try {
    return await run(require(modelPath));
  } finally {
    if (originalConfig) require.cache[configPath] = originalConfig;
    else delete require.cache[configPath];
    if (originalModel) require.cache[modelPath] = originalModel;
    else delete require.cache[modelPath];
  }
}

function createBooking(model) {
  return new Promise(resolve => {
    model.createPendingBooking(4, 5, 1, '2026-11-12', (error, result) => resolve({ error, result }));
  });
}

test('commits booking and pending payment through the same acquired connection', async () => {
  const fake = makePool();

  await withFakePool(fake.pool, async model => {
    const result = await createBooking(model);
    assert.ifError(result.error);
    assert.deepEqual(result.result, { bookingId: 42, paymentId: 77 });
    assert.deepEqual(fake.events, ['acquire', 'begin', 'booking', 'payment', 'commit', 'release']);
    assert.deepEqual(fake.queries[0].params, ['2026-11-12', 1, 5, 4]);
    assert.match(fake.queries[0].sql, /services\.is_active = 1/);
    assert.match(fake.queries[0].sql, /pets\.id = \? AND pets\.owner_id = \?/);
    assert.match(fake.queries[0].sql, /services\.price/);
    assert.match(fake.queries[0].sql, /'pending'/);
    assert.match(fake.queries[1].sql, /SELECT id, booked_price, 'pending'/);
  });
});

test('rolls back and reports unavailable pets or inactive services without inserting payment', async () => {
  const fake = makePool({ unavailable: true });

  await withFakePool(fake.pool, async model => {
    const result = await createBooking(model);
    assert.ifError(result.error);
    assert.equal(result.result, null);
    assert.deepEqual(fake.events, ['acquire', 'begin', 'booking', 'rollback', 'release']);
  });
});

test('rolls back booking and payment failures and releases the connection', async t => {
  for (const [failure, expectedEvents] of [
    ['bookingError', ['acquire', 'begin', 'booking', 'rollback', 'release']],
    ['paymentError', ['acquire', 'begin', 'booking', 'payment', 'rollback', 'release']],
    ['commitError', ['acquire', 'begin', 'booking', 'payment', 'commit', 'rollback', 'release']]
  ]) {
    await t.test(failure, async () => {
      const fake = makePool({ [failure]: new Error(failure) });
      await withFakePool(fake.pool, async model => {
        const result = await createBooking(model);
        assert(result.error);
        assert.equal(result.result, undefined);
        assert.deepEqual(fake.events, expectedEvents);
      });
    });
  }
});

test('releases a connection if transaction start fails', async () => {
  const fake = makePool({ beginError: new Error('begin failed') });

  await withFakePool(fake.pool, async model => {
    const result = await createBooking(model);
    assert(result.error);
    assert.deepEqual(fake.events, ['acquire', 'begin', 'release']);
  });
});

test('surfaces rollback failures instead of returning an unavailable or successful result', async () => {
  const fake = makePool({
    unavailable: true,
    rollbackError: new Error('rollback failed')
  });
  const originalError = console.error;
  console.error = () => {};

  try {
    await withFakePool(fake.pool, async model => {
      const result = await createBooking(model);
      assert(result.error);
      assert.equal(result.error.message, 'rollback failed');
      assert.equal(result.result, null);
      assert.deepEqual(fake.events, ['acquire', 'begin', 'booking', 'rollback', 'release']);
    });
  } finally {
    console.error = originalError;
  }
});

test('filters booking history by owner and returns the view rows', async () => {
  const rows = [{
    booking_id: 7,
    booking_date: '2026-11-12',
    pet_name: 'Mira',
    service_name: 'Basic Bath',
    booked_price: '25.00',
    booking_status: 'pending',
    payment_status: null
  }];
  const fake = makePool({ historyRows: rows });

  await withFakePool(fake.pool, async model => {
    const result = await new Promise((resolve, reject) => {
      model.getBookingsByOwner(4, (error, bookings) => error ? reject(error) : resolve(bookings));
    });
    assert.deepEqual(result, rows);
    assert.deepEqual(fake.queries[0].params, [4]);
    assert.match(fake.queries[0].sql, /LEFT JOIN payments/);
    assert.match(fake.queries[0].sql, /pets\.owner_id = \?/);
    assert.match(fake.queries[0].sql, /ORDER BY service_bookings\.created_at DESC, service_bookings\.id DESC/);
  });
});
