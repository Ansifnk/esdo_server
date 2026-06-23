import express from 'express';
import cookieParser from 'cookie-parser';
import authRouter from './api/auth';
import { responseMiddleware } from './middlewares/response';
import { Role } from './generated/prisma/enums';
import AppError from './models/AppError';
import AppResponse from './models/AppResponse';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(responseMiddleware);

// Routes
app.use('/api/auth', authRouter);


// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const message = err.message || 'Internal Server Error';
  res.json(new AppResponse(message, {}, statusCode));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});