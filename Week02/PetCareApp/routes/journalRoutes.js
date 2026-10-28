const express = require('express');
const { isLoggedIn } = require('../middleware/auth');
const JournalController = require('../controllers/journalController');

const router = express.Router();

router.get('/journals', isLoggedIn, JournalController.listJournals);
router.get('/journals/new', isLoggedIn, JournalController.showNewJournal);
router.post('/journals/new', isLoggedIn, JournalController.createJournal);
router.get('/journals/edit/:id', isLoggedIn, JournalController.showEditJournal);
router.post('/journals/edit/:id', isLoggedIn, JournalController.updateJournal);
router.get('/journals/delete/:id', isLoggedIn, JournalController.deleteJournal);
router.get('/journals/search', isLoggedIn, JournalController.searchJournals);

module.exports = router;
