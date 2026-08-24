import { Router } from 'express';
import { getInvoiceByBookingId, getInvoiceById } from './invoiceController';
import { authenticate } from '../../middlewares/auth';

const router = Router();

router.get('/booking/:bookingId', authenticate, getInvoiceByBookingId);
router.get('/:id', authenticate, getInvoiceById);

export default router;
