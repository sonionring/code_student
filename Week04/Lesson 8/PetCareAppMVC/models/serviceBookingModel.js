const connection = require('../config/db');

function createPendingBooking(ownerId, petId, serviceId, bookingDate, callback) {
  connection.getConnection((connectionError, transactionConnection) => {
    if (connectionError) return callback(connectionError);

    transactionConnection.beginTransaction((transactionError) => {
      if (transactionError) {
        transactionConnection.release();
        return callback(transactionError);
      }

      const finish = (error, result) => {
        transactionConnection.release();
        callback(error, result);
      };

      const rollback = (error, result) => {
        transactionConnection.rollback((rollbackError) => {
          if (rollbackError) {
            console.error('Failed to roll back service booking transaction:', rollbackError);
            if (error) {
              error.rollbackError = rollbackError;
            } else {
              error = rollbackError;
            }
          }
          finish(error, result);
        });
      };

      const bookingSql = `
        INSERT INTO service_bookings (pet_id, service_id, booking_status, booked_price, booking_date)
        SELECT pets.id, services.id, 'pending', services.price, ?
        FROM pets
        JOIN services ON services.id = ? AND services.is_active = 1
        WHERE pets.id = ? AND pets.owner_id = ?
      `;

      transactionConnection.query(
        bookingSql,
        [bookingDate, serviceId, petId, ownerId],
        (bookingError, bookingResult) => {
          if (bookingError) return rollback(bookingError);
          if (bookingResult.affectedRows === 0) return rollback(null, null);
          if (bookingResult.affectedRows !== 1) {
            return rollback(new Error('Expected exactly one service booking to be created.'));
          }

          const bookingId = bookingResult.insertId;
          const paymentSql = `
            INSERT INTO payments (booking_id, amount, payment_status)
            SELECT id, booked_price, 'pending'
            FROM service_bookings
            WHERE id = ?
          `;

          transactionConnection.query(paymentSql, [bookingId], (paymentError, paymentResult) => {
            if (paymentError) return rollback(paymentError);
            if (paymentResult.affectedRows !== 1) {
              return rollback(new Error('Expected exactly one pending payment to be created.'));
            }

            transactionConnection.commit((commitError) => {
              if (commitError) return rollback(commitError);
              finish(null, { bookingId, paymentId: paymentResult.insertId });
            });
          });
        }
      );
    });
  });
}

function getBookingsByOwner(ownerId, callback) {
  const sql = `
    SELECT
      service_bookings.id AS booking_id,
      DATE_FORMAT(service_bookings.booking_date, '%Y-%m-%d') AS booking_date,
      pets.name AS pet_name,
      services.name AS service_name,
      service_bookings.booked_price,
      service_bookings.booking_status,
      payments.payment_status,
      payments.payment_reference,
      service_bookings.created_at
    FROM service_bookings
    JOIN pets ON pets.id = service_bookings.pet_id
    JOIN services ON services.id = service_bookings.service_id
    LEFT JOIN payments ON payments.booking_id = service_bookings.id
    WHERE pets.owner_id = ?
    ORDER BY service_bookings.created_at DESC, service_bookings.id DESC
  `;
  connection.query(sql, [ownerId], callback);
}

module.exports = {
  createPendingBooking,
  getBookingsByOwner
};
