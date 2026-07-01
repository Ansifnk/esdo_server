import { Router } from 'express';
import { feedSuperAdmin } from './controller';

const router = Router();

router.post('/super-admin', feedSuperAdmin);

export default router;
