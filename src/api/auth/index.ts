import { Router } from 'express';
import { registerUser, loginUser, registerAdmin, loginAdmin, getMe } from './controller';
import { authenticate } from '../../middlewares/auth';

const router = Router();

router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/admin/register', registerAdmin);
router.post('/admin/login', loginAdmin);
router.get('/me', authenticate, getMe);

export default router;