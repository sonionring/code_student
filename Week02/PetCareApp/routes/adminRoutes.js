const express = require('express');
const { isAdmin } = require('../middleware/auth');
const AdminController = require('../controllers/adminController');

const router = express.Router();

router.get('/admin/dashboard', isAdmin, AdminController.showDashboard);
router.get('/admin/users', isAdmin, AdminController.listUsers);
router.get('/admin/users/:id', isAdmin, AdminController.showUserDetails);
router.get('/admin/users/delete/:id', isAdmin, AdminController.deleteUser);

module.exports = router;
