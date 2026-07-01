import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import authRouter from './api/auth';
import saloonRouter from './api/saloon';
import feedRouter from './api/feed';
import { responseMiddleware } from './middlewares/response';
import { Role } from './generated/prisma/enums';
import AppError from './models/AppError';
import AppResponse from './models/AppResponse';

const app = express();
app.use(
  cors({
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',')
      : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000', 'http://localhost:3001'],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());
app.use(responseMiddleware);

// Routes
app.use('/api/auth', authRouter);
app.use('/api/saloons', saloonRouter);
app.use('/api/feed', feedRouter);


// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  const statusCode = err instanceof AppError ? err.status : 500;
  const message = err.message || 'Internal Server Error';
  res.json(new AppResponse(message, {}, statusCode));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});