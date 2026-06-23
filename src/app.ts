import express from 'express';
import cookieParser from 'cookie-parser';
import authRouter from './api/auth';
import { responseMiddleware } from './middlewares/response';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(responseMiddleware);

// Routes
app.use('/api/auth', authRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});