const test = require('node:test');
const assert = require('node:assert/strict');
const petModel = require('../models/petModel');
const serviceModel = require('../models/serviceModel');
const serviceBookingModel = require('../models/serviceBookingModel');
const serviceController = require('../controllers/serviceController');

function localDate(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function mockMethod(object, name, implementation) {
  const original = object[name];
  object[name] = implementation;
  return () => {
    object[name] = original;
  };
}

function makeRequest(body = {}, query = {}, ownerId = 4) {
  const flashes = [];
  const req = {
    session: { user: { id: ownerId } },
    body,
    query,
    flash(type, message) {
      if (message !== undefined) flashes.push({ type, message });
      return [];
    }
  };
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(bodyText) {
      this.body = bodyText;
      return this;
    },
    render(view, locals) {
      this.view = view;
      this.locals = locals;
      return this;
    },
    redirect(path) {
      this.redirectPath = path;
      return this;
    }
  };
  return { req, res, flashes };
}

test('rejects invalid IDs and dates before calling the booking model', () => {
  let bookingCalls = 0;
  const restore = mockMethod(serviceBookingModel, 'createPendingBooking', () => {
    bookingCalls += 1;
  });

  try {
    const invalidForms = [
      { petId: '', serviceId: '1', bookingDate: localDate(1) },
      { petId: '-1', serviceId: '1', bookingDate: localDate(1) },
      { petId: '5', serviceId: '0', bookingDate: localDate(1) },
      { petId: '5', serviceId: 'invalid', bookingDate: localDate(1) },
      { petId: '5', serviceId: '1', bookingDate: '' },
      { petId: '5', serviceId: '1', bookingDate: '9999-02-30' },
      { petId: '5', serviceId: '1', bookingDate: localDate(-1) }
    ];

    for (const body of invalidForms) {
      const { req, res, flashes } = makeRequest(body);
      serviceController.createBooking(req, res);
      assert.equal(res.redirectPath, '/services');
      assert.deepEqual(flashes, [{
        type: 'error',
        message: 'Choose a pet, service, and valid booking date.'
      }]);
    }

    assert.equal(bookingCalls, 0);
  } finally {
    restore();
  }
});

test('accepts today and future dates and redirects only after a committed booking', () => {
  const calls = [];
  const restore = mockMethod(serviceBookingModel, 'createPendingBooking', (ownerId, petId, serviceId, date, callback) => {
    calls.push({ ownerId, petId, serviceId, date });
    callback(null, { bookingId: 12, paymentId: 34 });
  });

  try {
    for (const date of [localDate(0), localDate(1)]) {
      const { req, res, flashes } = makeRequest({
        petId: '5',
        serviceId: '1',
        bookingDate: date,
        ownerId: '999'
      });
      serviceController.createBooking(req, res);
      assert.equal(res.redirectPath, '/bookings');
      assert.deepEqual(flashes, [{
        type: 'success',
        message: 'Booking created. Payment is pending; no payment has been processed.'
      }]);
    }

    assert.deepEqual(calls, [
      { ownerId: 4, petId: 5, serviceId: 1, date: localDate(0) },
      { ownerId: 4, petId: 5, serviceId: 1, date: localDate(1) }
    ]);
  } finally {
    restore();
  }
});

test('uses the unavailable and database-error responses without reporting success', () => {
  const restore = mockMethod(serviceBookingModel, 'createPendingBooking', (ownerId, petId, serviceId, date, callback) => {
    callback(null, null);
  });

  try {
    const unavailable = makeRequest({ petId: '5', serviceId: '1', bookingDate: localDate(1) });
    serviceController.createBooking(unavailable.req, unavailable.res);
    assert.equal(unavailable.res.redirectPath, '/services');
    assert.deepEqual(unavailable.flashes, [{
      type: 'error',
      message: 'That pet or service is unavailable for booking.'
    }]);
  } finally {
    restore();
  }

  const originalError = console.error;
  const databaseError = new Error('test database failure');
  const restoreError = mockMethod(serviceBookingModel, 'createPendingBooking', (ownerId, petId, serviceId, date, callback) => {
    callback(databaseError);
  });
  console.error = () => {};

  try {
    const failed = makeRequest({ petId: '5', serviceId: '1', bookingDate: localDate(1) });
    serviceController.createBooking(failed.req, failed.res);
    assert.equal(failed.res.redirectPath, '/services?petId=5');
    assert.deepEqual(failed.flashes, [{
      type: 'error',
      message: 'Unable to create the booking. Please try again.'
    }]);
  } finally {
    restoreError();
    console.error = originalError;
  }
});

test('preselects only an owned pet and supplies all service view locals', () => {
  const restorePets = mockMethod(petModel, 'getPetsByOwner', (ownerId, callback) => {
    assert.equal(ownerId, 4);
    callback(null, [{ id: 5, name: 'Mira', species: 'Cat' }]);
  });
  const restoreServices = mockMethod(serviceModel, 'getActiveServices', callback => {
    callback(null, [{ id: 1, name: 'Basic Bath', price: '25.00' }]);
  });

  try {
    const { req, res } = makeRequest({}, { petId: '5' });
    serviceController.listServices(req, res);
    assert.equal(res.view, 'services');
    assert.equal(res.locals.selectedPetId, '5');
    assert.match(res.locals.today, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(res.locals.pets, [{ id: 5, name: 'Mira', species: 'Cat' }]);
    assert.deepEqual(res.locals.services, [{ id: 1, name: 'Basic Bath', price: '25.00' }]);
    assert.deepEqual(res.locals.messages, []);
    assert.deepEqual(res.locals.errors, []);
    assert.equal(res.locals.session, req.session);

    const unowned = makeRequest({}, { petId: '99' });
    serviceController.listServices(unowned.req, unowned.res);
    assert.equal(unowned.res.locals.selectedPetId, '');
  } finally {
    restoreServices();
    restorePets();
  }
});

test('renders booking history for the authenticated owner with required locals', () => {
  const bookings = [{
    booking_id: 7,
    booking_date: '2026-11-12',
    pet_name: 'Mira',
    service_name: 'Basic Bath',
    booked_price: '25.00',
    booking_status: 'pending',
    payment_status: null
  }];
  const restore = mockMethod(serviceBookingModel, 'getBookingsByOwner', (ownerId, callback) => {
    assert.equal(ownerId, 4);
    callback(null, bookings);
  });

  try {
    const { req, res } = makeRequest();
    serviceController.listBookings(req, res);
    assert.equal(res.view, 'bookings');
    assert.deepEqual(res.locals.bookings, bookings);
    assert.deepEqual(res.locals.messages, []);
    assert.deepEqual(res.locals.errors, []);
    assert.equal(res.locals.session, req.session);
  } finally {
    restore();
  }
});

test('returns explicit server errors when loading pets, services, or history fails', () => {
  const originalError = console.error;
  console.error = () => {};

  const restorePets = mockMethod(petModel, 'getPetsByOwner', (ownerId, callback) => {
    callback(new Error('pet query failed'));
  });
  try {
    const petsResponse = makeRequest();
    serviceController.listServices(petsResponse.req, petsResponse.res);
    assert.equal(petsResponse.res.statusCode, 500);
    assert.equal(petsResponse.res.body, 'Unable to load pets.');
  } finally {
    restorePets();
  }

  const restorePetsSuccess = mockMethod(petModel, 'getPetsByOwner', (ownerId, callback) => callback(null, []));
  const restoreServices = mockMethod(serviceModel, 'getActiveServices', callback => callback(new Error('service query failed')));
  try {
    const servicesResponse = makeRequest();
    serviceController.listServices(servicesResponse.req, servicesResponse.res);
    assert.equal(servicesResponse.res.statusCode, 500);
    assert.equal(servicesResponse.res.body, 'Unable to load services.');
  } finally {
    restoreServices();
    restorePetsSuccess();
  }

  const restoreHistory = mockMethod(serviceBookingModel, 'getBookingsByOwner', (ownerId, callback) => callback(new Error('history query failed')));
  try {
    const historyResponse = makeRequest();
    serviceController.listBookings(historyResponse.req, historyResponse.res);
    assert.equal(historyResponse.res.statusCode, 500);
    assert.equal(historyResponse.res.body, 'Unable to load booking history.');
  } finally {
    restoreHistory();
    console.error = originalError;
  }
});
