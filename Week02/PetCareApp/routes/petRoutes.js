const express = require('express');
const upload = require('../config/upload');
const { isLoggedIn } = require('../middleware/auth');
const PetController = require('../controllers/petController');

const router = express.Router();

router.get('/pets/new', isLoggedIn, PetController.showNewPet);
router.post('/pets', upload.single('pet_image'), isLoggedIn, PetController.createPet);

module.exports = router;
