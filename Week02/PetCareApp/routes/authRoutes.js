const express = require('express');
const upload = require('../config/upload');
const AuthController = require('../controllers/authController');

const router = express.Router();

router.get('/signup', AuthController.showSignUp);
router.post('/signup', upload.single('pet_image'), AuthController.signUp);
router.get('/login', AuthController.showLogin);
router.post('/login', AuthController.login);
router.get('/logout', AuthController.logout);

module.exports = router;
