import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import authRouter from './api/auth';
import saloonRouter from './api/saloon';
import feedRouter from './api/feed';
import categoryRouter from './api/category';
import subCategoryRouter from './api/sub-category';
import fileRouter from './api/file';
import staffRouter from './api/staff';
import serviceRouter from './api/service';
import packageRouter from './api/package';
import adminsRouter from './api/admins';
import offerRouter from './api/offer';
import attendanceRouter from './api/attendance';
import customerRouter from './api/customer';
import { responseMiddleware } from './middlewares/response';
import { Role } from './generated/prisma/enums';
import AppError from './models/AppError';
import AppResponse from './models/AppResponse';
import { CORS_ORIGIN, PORT } from './configs/env';

const app = express();
app.use(
  cors({
    origin: CORS_ORIGIN
      ? CORS_ORIGIN.split(',')
      : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000', 'http://localhost:3001'],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());
app.use(responseMiddleware);

// Routes
app.use('/api/auth', authRouter);
app.use('/api/customer', customerRouter);
app.use('/api/saloons', saloonRouter);
app.use('/api/feed', feedRouter);
app.use('/api/categories', categoryRouter);
app.use('/api/sub-categories', subCategoryRouter);
app.use('/api/files', fileRouter);
app.use('/api/staff', staffRouter); //todo:remove this after making to staffs in admin side
app.use('/api/staffs', staffRouter);
app.use('/api/services', serviceRouter);
app.use('/api/packages', packageRouter);
app.use('/api/admins', adminsRouter);
app.use('/api/offers', offerRouter);
app.use('/api/attendance', attendanceRouter);



// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  const statusCode = err instanceof AppError ? err.status : 500;
  const message = err.message || 'Internal Server Error';
  res.json(new AppResponse(message, {}, statusCode));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});