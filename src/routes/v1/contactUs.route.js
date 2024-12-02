const express = require('express');
const { adminAuth, userAuth } = require('../../middlewares');
const validate = require('../../middlewares/validate');
const { contactValidation } = require('../../validations');
const { ContactUsController } = require('../../controllers');

const router = express.Router();

router.get('/list', adminAuth(), ContactUsController.getChatList);

router.get('/:contactId/conversation', adminAuth(), ContactUsController.getConversation);

router
    .route('/')
    .post(userAuth('createContact'), validate(contactValidation.createContact), ContactUsController.createContact)
    .get(adminAuth('getContacts'), validate(contactValidation.getContacts), ContactUsController.getContacts);

router
    .route('/:contactId')
    .get(adminAuth('getContact'), validate(contactValidation.getContact), ContactUsController.getContact)
    .patch(adminAuth('updateContact'), validate(contactValidation.updateContact), ContactUsController.updateContact)
    .delete(adminAuth('deleteContact'), validate(contactValidation.deleteContact), ContactUsController.deleteContact);

router
    .route('/:contactId/reply')
    .post(adminAuth('replyToContact'), validate(contactValidation.replyToContact), ContactUsController.replyToContact);

module.exports = router;